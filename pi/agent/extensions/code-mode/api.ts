import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { requestGatewayAccess } from "../mcp-gateway/api.ts";
import { loadCodeConfig, MAX_LIMITS, type CodeConfig } from "./config.ts";
import { runCode, type RunResult } from "./runtime.ts";

export type { RunResult, Trace } from "./runtime.ts";
export type CodeLimits = Pick<
  CodeConfig,
  "maxCalls" | "maxConcurrency" | "timeoutMs"
>;
export { MAX_LIMITS } from "./config.ts";

/** Resolve dependencies and current limits without launching a child. */
export async function getCodeLimits(
  pi: Pick<ExtensionAPI, "events">,
  cwd: string,
  signal?: AbortSignal,
): Promise<CodeLimits> {
  signal?.throwIfAborted();
  const config = await loadCodeConfig(cwd, [], signal);
  signal?.throwIfAborted();
  if (!config.valid) throw new Error("invalid_code_config");
  requestGatewayAccess(pi);
  return {
    maxCalls: config.maxCalls,
    maxConcurrency: config.maxConcurrency,
    timeoutMs: config.timeoutMs,
  };
}

/** Fresh execution, current gateway/config, with caller ceilings that can only tighten limits. */
export async function executeCode(
  pi: Pick<ExtensionAPI, "events">,
  cwd: string,
  source: string,
  limits: CodeLimits,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<RunResult> {
  const failed = (code: string): RunResult => ({
    status: "failed",
    code,
    traces: [],
    partialExecution: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
  });
  if (
    !Number.isSafeInteger(deadlineMs) ||
    (Object.keys(MAX_LIMITS) as Array<keyof CodeLimits>).some(
      (k) =>
        !Number.isSafeInteger(limits[k]) ||
        limits[k] < 1 ||
        limits[k] > MAX_LIMITS[k],
    )
  )
    return failed("invalid_config");
  const deadline = Math.min(deadlineMs, Date.now() + limits.timeoutMs);
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(0, deadline - Date.now()),
  );
  try {
    if (Date.now() >= deadline)
      return { ...failed("deadline_exceeded"), status: "timeout" };
    const current = await getCodeLimits(pi, cwd, combined);
    if (combined.aborted)
      return { ...failed("cancelled"), status: "cancelled" };
    const config: CodeConfig = {
      valid: true,
      maxCalls: Math.min(current.maxCalls, limits.maxCalls),
      maxConcurrency: Math.min(current.maxConcurrency, limits.maxConcurrency),
      timeoutMs: Math.min(current.timeoutMs, limits.timeoutMs),
    };
    const result = await runCode(
      source,
      requestGatewayAccess(pi),
      config,
      combined,
      deadline,
    );
    return controller.signal.aborted &&
      !signal.aborted &&
      result.status === "cancelled"
      ? { ...result, status: "timeout", code: "deadline_exceeded" }
      : result;
  } catch {
    if (signal.aborted) return { ...failed("cancelled"), status: "cancelled" };
    if (controller.signal.aborted)
      return { ...failed("deadline_exceeded"), status: "timeout" };
    return failed("executor_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/** Whole-observation safety, never inferred from guest JSON or tool annotations. */
export function isRepeatSafeFailure(result: RunResult): boolean {
  return (
    result.status === "failed" &&
    result.code === "nested_call_failed" &&
    !result.effectsMayPersist &&
    !result.outcomeUnknown &&
    !result.partialExecution &&
    result.traces.length > 0 &&
    result.traces.every(
      (t) =>
        t.state === "failed" &&
        t.repeatSafe === true &&
        !t.dispatched &&
        !t.outcomeUnknown,
    )
  );
}
