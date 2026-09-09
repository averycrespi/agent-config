import { spawn, type ChildProcess } from "node:child_process";
import {
  isGatewayError,
  MAX_RESPONSE_BYTES,
  sanitizeGatewayText,
  type GatewayAccess,
} from "../mcp-gateway/api.ts";
import { buildSandboxSource } from "./sandbox-source.ts";
import { DEFAULT_CONFIG, MAX_LIMITS, type CodeConfig } from "./config.ts";

export const _spawn = { fn: spawn };
export type Trace = {
  id: number;
  tool: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  dispatched: boolean;
  startedMs: number;
  durationMs: number;
  code?: string;
  reason?: string;
  invocationId?: string;
  outcomeUnknown?: boolean;
};
export type RunResult = {
  status: "success" | "failed" | "cancelled" | "timeout";
  code?: string;
  json?: string;
  traces: Trace[];
  partialExecution: boolean;
  effectsMayPersist: boolean;
  outcomeUnknown: boolean;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const safe = (s: string) => sanitizeGatewayText(s).slice(0, 160);

export function runCode(
  source: string,
  gateway: GatewayAccess,
  config: CodeConfig = DEFAULT_CONFIG,
  signal?: AbortSignal,
): Promise<RunResult> {
  const empty = (code: string): RunResult => ({
    status: "failed",
    code,
    traces: [],
    partialExecution: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
  });
  if (
    !config.valid ||
    (Object.keys(MAX_LIMITS) as Array<keyof typeof MAX_LIMITS>).some(
      (k) =>
        !Number.isSafeInteger(config[k]) ||
        config[k] < 1 ||
        config[k] > MAX_LIMITS[k],
    )
  )
    return Promise.resolve(empty("invalid_config"));
  if (
    typeof source !== "string" ||
    !source.trim() ||
    Buffer.byteLength(source) > 256 * 1024
  )
    return Promise.resolve(empty("invalid_source"));
  // --allow-net availability distinguishes permission implementations that deny network.
  if (
    ![
      "--permission",
      "--allow-net",
      "--disallow-code-generation-from-strings",
    ].every((flag) => process.allowedNodeEnvironmentFlags.has(flag))
  )
    return Promise.resolve(empty("isolation_unavailable"));
  if (signal?.aborted)
    return Promise.resolve({ ...empty("cancelled"), status: "cancelled" });
  return new Promise((resolve) => {
    const start = Date.now();
    const controller = new AbortController();
    const traces: Trace[] = [];
    const queue: Array<{
      trace: Trace;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    let active = 0;
    let lastId = 0;
    let child: ChildProcess | undefined;
    let terminal:
      | { status: RunResult["status"]; code?: string; json?: string }
      | undefined;
    let settled = false;
    const timer = setTimeout(
      () => finish("timeout", "deadline_exceeded"),
      config.timeoutMs,
    );
    const abort = () => finish("cancelled", "cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    function settle() {
      if (settled || !terminal) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const dispatched = traces.some((t) => t.dispatched);
      resolve({
        ...terminal,
        traces: structuredClone(traces),
        effectsMayPersist: dispatched,
        partialExecution: dispatched && terminal.status !== "success",
        outcomeUnknown: traces.some((t) => t.outcomeUnknown === true),
      });
    }
    function finish(status: RunResult["status"], code?: string, json?: string) {
      if (terminal) return;
      if (
        status === "success" &&
        traces.some((t) => t.state === "queued" || t.state === "running")
      ) {
        status = "failed";
        code = "unfinished_calls";
      }
      if (status === "success" && traces.some((t) => t.state === "failed")) {
        status = "failed";
        code = "nested_call_failed";
      }
      terminal = { status, code, json };
      for (const t of traces)
        if (t.state === "queued" || t.state === "running") {
          t.state = "cancelled";
          t.code = "cancelled";
          t.outcomeUnknown = t.dispatched;
          t.durationMs = Date.now() - start - t.startedMs;
        }
      queue.length = 0;
      controller.abort();
      if (child && child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      else settle();
    }
    function send(message: unknown) {
      if (terminal || !child?.connected) return;
      child.send(JSON.stringify(message), (error) => {
        if (error) finish("failed", "ipc_error");
      });
    }
    function pump() {
      while (!terminal && active < config.maxConcurrency && queue.length) {
        const { trace, name, args } = queue.shift()!;
        active++;
        trace.state = "running";
        void gateway
          .call(name, args, controller.signal, () => {
            controller.signal.throwIfAborted();
            trace.dispatched = true;
            trace.tool = safe(name);
          })
          .then(
            (value) => {
              if (terminal) return;
              trace.state = value.isError ? "failed" : "succeeded";
              if (value.isError) trace.code = "provider_error";
              send({ id: trace.id, ok: true, value });
            },
            (error) => {
              if (terminal) return;
              trace.state = "failed";
              trace.code = isGatewayError(error)
                ? safe(error.code)
                : "bridge_error";
              if (isGatewayError(error)) {
                trace.reason = error.reason;
                trace.invocationId = error.invocationId;
                trace.outcomeUnknown = error.outcomeUnknown;
              } else trace.outcomeUnknown = trace.dispatched;
              // Remote guidance and exception messages may contain intermediate payloads.
              send({
                id: trace.id,
                ok: false,
                error: {
                  code: trace.code,
                  reason: trace.reason,
                  invocationId: trace.invocationId,
                  outcomeUnknown: trace.outcomeUnknown,
                },
              });
            },
          )
          .finally(() => {
            if (terminal) return;
            trace.durationMs = Date.now() - start - trace.startedMs;
            active--;
            pump();
          });
      }
    }
    function receive(raw: unknown) {
      if (terminal) return;
      if (
        typeof raw !== "string" ||
        Buffer.byteLength(raw) > MAX_RESPONSE_BYTES
      ) {
        finish("failed", "ipc_limit");
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        finish("failed", "invalid_ipc");
        return;
      }
      if (!record(message)) {
        finish("failed", "invalid_ipc");
        return;
      }
      if (
        message.type === "result" &&
        Object.keys(message).length === 2 &&
        typeof message.json === "string"
      ) {
        try {
          JSON.parse(message.json);
        } catch {
          finish("failed", "invalid_result");
          return;
        }
        finish("success", undefined, message.json);
        return;
      }
      if (
        message.type === "failure" &&
        Object.keys(message).length === 2 &&
        ["script_error", "invalid_result"].includes(String(message.code))
      ) {
        finish("failed", message.code as string);
        return;
      }
      if (
        message.type !== "call" ||
        Object.keys(message).sort().join() !== "args,id,name,type" ||
        !Number.isSafeInteger(message.id) ||
        message.id !== lastId + 1 ||
        typeof message.name !== "string" ||
        !message.name ||
        message.name.length > 512 ||
        !record(message.args)
      ) {
        finish("failed", "invalid_ipc");
        return;
      }
      if (traces.length >= config.maxCalls) {
        finish("failed", "call_limit");
        return;
      }
      lastId = message.id as number;
      const trace: Trace = {
        id: lastId,
        tool: "(not dispatched)",
        state: "queued",
        dispatched: false,
        startedMs: Date.now() - start,
        durationMs: 0,
      };
      traces.push(trace);
      queue.push({ trace, name: message.name, args: message.args });
      pump();
    }
    try {
      child = _spawn.fn(
        process.execPath,
        [
          "--permission",
          "--disallow-code-generation-from-strings",
          "--input-type=module",
          "-",
        ],
        {
          env: {},
          stdio: ["pipe", "ignore", "ignore", "ipc"],
          serialization: "json",
          windowsHide: true,
        },
      );
      child.on("message", receive);
      child.on("error", () => finish("failed", "sandbox_error"));
      child.on("close", () => {
        if (!terminal) finish("failed", "sandbox_exit");
        settle();
      });
      child.stdin?.on("error", () => finish("failed", "sandbox_error"));
      child.stdin?.end(buildSandboxSource(source, config.maxConcurrency));
      if (signal?.aborted) abort();
    } catch {
      finish("failed", "sandbox_error");
      settle();
    }
  });
}
