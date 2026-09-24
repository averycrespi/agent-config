import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadScriptConfig, MAX_LIMITS } from "./config.ts";
import {
  collectProviders,
  methodAvailable,
  type ScriptSession,
  validName,
  type RegisteredProvider,
} from "./provider.ts";
import { createBridge } from "./bridge.ts";
import { runScript, type RunResult } from "./runtime.ts";
import { jsonSnapshot, MAX_ARGS_BYTES } from "./value.ts";
export { registerScriptProvider } from "./provider.ts";
export { jsonSnapshot as snapshotScriptJson } from "./value.ts";
export type {
  JsonValue,
  ScriptProvider,
  ScriptMethod,
  MethodContext,
  MethodResult,
  ScriptSession,
  ScriptExecutionContext,
} from "./provider.ts";
export type { RunResult, Trace } from "./runtime.ts";
export { MAX_LIMITS } from "./config.ts";
export type ScriptLimits = {
  maxCalls: number;
  maxConcurrency: number;
  timeoutMs: number;
};
export type ScriptOptions = {
  source: string;
  /** Optional JSON data binding, transported over IPC, never compiled as source. */
  args?: unknown;
  providers: string[];
  /** Optional caller-owned session metadata, snapshotted before async setup. */
  session?: ScriptSession;
  /** Omission uses host policy; an explicit empty ceiling allows only pure computation. */
  capabilityCeiling?: string[];
  limits: ScriptLimits;
  signal: AbortSignal;
  deadlineMs: number;
};
type Bus = Pick<ExtensionAPI, "events">;
const names = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 32 &&
  v.every(validName) &&
  new Set(v).size === v.length;
const failure = (code: string): RunResult => ({
  status: "failed",
  code,
  traces: [],
  partialExecution: false,
  effectsMayPersist: false,
  outcomeUnknown: false,
});
function select(
  pi: Bus,
  requested: string[],
  allowed: string[],
  ceiling?: string[],
): RegisteredProvider[] {
  if (!names(requested) || (ceiling !== undefined && !names(ceiling)))
    throw new Error("invalid_selection");
  if (
    requested.some(
      (p) => !allowed.includes(p) || (ceiling && !ceiling.includes(p)),
    )
  )
    throw new Error("capability_denied");
  const registered = collectProviders(pi);
  return requested.map((name) => {
    const provider = registered.find((p) => p.namespace === name);
    let available = false;
    try {
      available = provider?.available() === true;
    } catch {
      /* Do not disclose provider errors. */
    }
    if (!provider || !available) throw new Error("capability_unavailable");
    return provider;
  });
}

/** Discover only permitted APIs; returned schemas are copies without handlers/credentials. */
export async function describeScriptProviders(
  pi: Bus,
  cwd: string,
  providers: string[],
  capabilityCeiling?: string[],
  signal?: AbortSignal,
) {
  const config = await loadScriptConfig(cwd, [], signal);
  signal?.throwIfAborted();
  if (!config.valid) throw new Error("invalid_config");
  if (!names(providers)) throw new Error("invalid_selection");
  const selected = providers.length
    ? providers
    : collectProviders(pi)
        .filter(
          (p) =>
            config.allowedProviders.includes(p.namespace) &&
            (capabilityCeiling === undefined ||
              capabilityCeiling.includes(p.namespace)),
        )
        .map((p) => p.namespace);
  return select(pi, selected, config.allowedProviders, capabilityCeiling).map(
    (p) => ({
      namespace: p.namespace,
      methods: [...p.methods].map(([name, m]) => ({
        name,
        description: m.description,
        ...(m.available ? { available: methodAvailable(m) } : {}),
        inputSchema: structuredClone(m.inputSchema),
        ...(m.errorCodes ? { errorCodes: [...m.errorCodes] } : {}),
      })),
    }),
  );
}

/** Validate and pin background authority without starting a child. Single-use, no renewal. */
export async function prepareScript(
  pi: Bus,
  cwd: string,
  options: ScriptOptions,
) {
  const started = Date.now();
  if (
    !options ||
    !Number.isSafeInteger(options.deadlineMs) ||
    !options.signal ||
    !options.limits ||
    (Object.keys(MAX_LIMITS) as Array<keyof ScriptLimits>).some(
      (k) =>
        !Number.isSafeInteger(options.limits[k]) ||
        options.limits[k] < 1 ||
        options.limits[k] > MAX_LIMITS[k],
    )
  )
    throw new Error("invalid_config");
  if (
    typeof options.source !== "string" ||
    !options.source.trim() ||
    Buffer.byteLength(options.source) > 262144
  )
    throw new Error("invalid_source");
  const source = options.source;
  const argsJson =
    options.args === undefined
      ? undefined
      : jsonSnapshot(options.args, MAX_ARGS_BYTES);
  const providers = [...options.providers];
  const capabilityCeiling = options.capabilityCeiling
    ? [...options.capabilityCeiling]
    : undefined;
  const requestedLimits = { ...options.limits };
  const execution = Object.freeze({
    cwd,
    ...(options.session
      ? { session: Object.freeze({ ...options.session }) }
      : {}),
  });
  const deadline = Math.min(
    options.deadlineMs,
    started + options.limits.timeoutMs,
  );
  const setup = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  ]);
  const config = await loadScriptConfig(cwd, [], setup);
  setup.throwIfAborted();
  if (!config.valid) throw new Error("invalid_config");
  const selected = select(
    pi,
    providers,
    config.allowedProviders,
    capabilityCeiling,
  );
  const deadlineMs = Math.min(deadline, started + config.timeoutMs);
  if (Date.now() >= deadlineMs) throw new Error("deadline_exceeded");
  const limits = {
    ...config,
    maxCalls: Math.min(config.maxCalls, requestedLimits.maxCalls),
    maxConcurrency: Math.min(
      config.maxConcurrency,
      requestedLimits.maxConcurrency,
    ),
    timeoutMs: Math.min(config.timeoutMs, requestedLimits.timeoutMs),
  };
  const bridge = createBridge(selected, execution);
  let used = false;
  return {
    deadlineMs,
    run(signal: AbortSignal) {
      if (used) throw new Error("prepared_execution_consumed");
      used = true;
      return runScript(
        source,
        bridge,
        limits,
        AbortSignal.any([
          signal,
          options.signal,
          ...selected.map((p) => p.signal),
        ]),
        deadlineMs,
        argsJson,
      );
    },
  };
}

/** Execute once. Caller owns scheduling, shutdown signal, and presentation; no replay. */
export async function executeScript(
  pi: Bus,
  cwd: string,
  options: ScriptOptions,
): Promise<RunResult> {
  if (
    !options ||
    !Number.isSafeInteger(options.deadlineMs) ||
    !options.signal ||
    typeof options.signal.addEventListener !== "function" ||
    !options.limits ||
    (Object.keys(MAX_LIMITS) as Array<keyof ScriptLimits>).some(
      (k) =>
        !Number.isSafeInteger(options.limits[k]) ||
        options.limits[k] < 1 ||
        options.limits[k] > MAX_LIMITS[k],
    )
  )
    return failure("invalid_config");
  const execution = Object.freeze({
    cwd,
    ...(options.session
      ? { session: Object.freeze({ ...options.session }) }
      : {}),
  });
  const started = Date.now();
  const deadline = Math.min(
    options.deadlineMs,
    started + options.limits.timeoutMs,
  );
  const timeout = new AbortController();
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  const timer = setTimeout(
    () => timeout.abort(),
    Math.max(0, deadline - Date.now()),
  );
  try {
    if (options.signal.aborted)
      return { ...failure("cancelled"), status: "cancelled" };
    if (Date.now() >= deadline)
      return { ...failure("deadline_exceeded"), status: "timeout" };
    const argsJson =
      options.args === undefined
        ? undefined
        : jsonSnapshot(options.args, MAX_ARGS_BYTES);
    const config = await loadScriptConfig(cwd, [], signal);
    if (signal.aborted)
      return options.signal.aborted
        ? { ...failure("cancelled"), status: "cancelled" }
        : { ...failure("deadline_exceeded"), status: "timeout" };
    if (!config.valid) return failure("invalid_config");
    const selected = select(
      pi,
      options.providers,
      config.allowedProviders,
      options.capabilityCeiling,
    );
    const combined = AbortSignal.any([
      signal,
      ...selected.map((p) => p.signal),
    ]);
    const result = await runScript(
      options.source,
      createBridge(selected, execution),
      {
        ...config,
        maxCalls: Math.min(config.maxCalls, options.limits.maxCalls),
        maxConcurrency: Math.min(
          config.maxConcurrency,
          options.limits.maxConcurrency,
        ),
        timeoutMs: Math.min(config.timeoutMs, options.limits.timeoutMs),
      },
      combined,
      Math.min(deadline, started + config.timeoutMs),
      argsJson,
    );
    return timeout.signal.aborted &&
      !options.signal.aborted &&
      result.status === "cancelled"
      ? { ...result, status: "timeout", code: "deadline_exceeded" }
      : result;
  } catch (error) {
    if (options.signal.aborted)
      return { ...failure("cancelled"), status: "cancelled" };
    if (timeout.signal.aborted)
      return { ...failure("deadline_exceeded"), status: "timeout" };
    const code =
      error instanceof Error &&
      [
        "invalid_selection",
        "capability_denied",
        "capability_unavailable",
        "provider_conflict",
      ].includes(error.message)
        ? error.message
        : "executor_unavailable";
    return failure(code);
  } finally {
    clearTimeout(timer);
  }
}
