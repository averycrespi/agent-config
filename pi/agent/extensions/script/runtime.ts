import { spawn, type ChildProcess } from "node:child_process";
import { AdmissionError, type ScriptBridge } from "./bridge.ts";
import { MAX_IPC_BYTES, MAX_OUTPUT_BYTES, jsonSnapshot } from "./value.ts";
import { buildSandboxSource } from "./sandbox-source.ts";
import { DEFAULT_CONFIG, MAX_LIMITS, type ScriptConfig } from "./config.ts";

export const _spawn = { fn: spawn };
export type Trace = {
  id: number;
  tool: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  dispatched: boolean;
  startedMs: number;
  durationMs: number;
  code?: string;
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
export function runScript(
  source: string,
  bridge: ScriptBridge,
  config: ScriptConfig = DEFAULT_CONFIG,
  signal?: AbortSignal,
  deadlineMs?: number,
  argsJson?: string,
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
    (deadlineMs !== undefined && !Number.isSafeInteger(deadlineMs)) ||
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
    const deadline = Math.min(start + config.timeoutMs, deadlineMs ?? Infinity);
    const controller = new AbortController();
    const traces: Trace[] = [];
    const queue: Array<{
      trace: Trace;
      name: string;
      args: unknown[];
    }> = [];
    let active = 0;
    let lastId = 0;
    let awaitingArgs = argsJson !== undefined;
    let child: ChildProcess | undefined;
    let terminal:
      | { status: RunResult["status"]; code?: string; json?: string }
      | undefined;
    let settled = false;
    const timer = setTimeout(
      () => finish("timeout", "deadline_exceeded"),
      Math.max(0, deadline - start),
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
      try {
        const json = JSON.stringify(message);
        if (Buffer.byteLength(json) > MAX_IPC_BYTES) {
          finish("failed", "ipc_limit");
          return;
        }
        child.send(json, (error) => {
          if (error) finish("failed", "ipc_error");
        });
      } catch {
        finish("failed", "ipc_error");
      }
    }
    function expired() {
      if (Date.now() < deadline) return false;
      finish("timeout", "deadline_exceeded");
      return true;
    }
    function pump() {
      if (expired()) return;
      while (!terminal && active < config.maxConcurrency && queue.length) {
        const { trace, name, args } = queue.shift()!;
        active++;
        trace.state = "running";
        void bridge
          .call(name, args, controller.signal, deadline, () => {
            expired();
            controller.signal.throwIfAborted();
            trace.dispatched = true;
            trace.tool = name;
          })
          .then(
            (value) => {
              if (terminal) return;
              trace.state = value.isError ? "failed" : "succeeded";
              if (value.isError) trace.code = value.error ?? "provider_error";
              trace.outcomeUnknown = value.outcomeUnknown === true;
              send(
                value.error
                  ? {
                      id: trace.id,
                      ok: false,
                      error: {
                        code: value.error,
                        outcomeUnknown: trace.outcomeUnknown,
                      },
                    }
                  : { id: trace.id, ok: true, value: value.value },
              );
            },
            (error) => {
              if (terminal) return;
              trace.state = "failed";
              trace.code =
                !trace.dispatched && error instanceof AdmissionError
                  ? error.code
                  : "provider_error";
              trace.outcomeUnknown = trace.dispatched;
              // Remote guidance and exception messages may contain intermediate payloads.
              send({
                id: trace.id,
                ok: false,
                error: {
                  code: trace.code,
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
      if (terminal || expired()) return;
      if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_IPC_BYTES) {
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
        awaitingArgs &&
        message.type === "ready" &&
        Object.keys(message).length === 1
      ) {
        awaitingArgs = false;
        send({ type: "arguments", json: argsJson });
        return;
      }
      if (
        message.type === "result" &&
        Object.keys(message).length === 2 &&
        typeof message.json === "string"
      ) {
        try {
          if (Buffer.byteLength(message.json) > MAX_OUTPUT_BYTES) {
            finish("failed", "output_limit");
            return;
          }
          jsonSnapshot(JSON.parse(message.json), MAX_OUTPUT_BYTES);
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
        !Array.isArray(message.args)
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
      if (expired()) return;
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
      child.stdin?.end(
        buildSandboxSource(
          source,
          config.maxConcurrency,
          bridge.bindings,
          argsJson !== undefined,
        ),
      );
      if (signal?.aborted) abort();
    } catch {
      finish("failed", "sandbox_error");
      settle();
    }
  });
}
