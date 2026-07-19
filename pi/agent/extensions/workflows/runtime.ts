import { spawn as nodeSpawn, type Serializable } from "node:child_process";
import {
  createSubagentActivityTracker,
  formatSpawnFailure,
  runSubagent,
  validateOutputSchema,
  type Capability,
  type ModelTier,
  type ThinkingLevel,
} from "../subagents/api.ts";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  type WorkflowAgentPolicyOptions,
  type WorkflowAgentRequest,
  type WorkflowAgentResponse,
  type WorkflowAgentState,
  type WorkflowLogEntry,
  type WorkflowRunResult,
  type WorkflowErrorCode,
  type WorkflowFailureDetails,
  type WorkflowRecoveryRecord,
  type WorkflowRunDiagnostic,
  type WorkflowRuntimeOptions,
  type WorkflowSnapshot,
} from "./types.ts";
import type { ParsedWorkflow } from "./types.ts";
import { safeStringify } from "./safe-stringify.ts";
import {
  buildSandboxSource,
  MAX_WORKFLOW_LOG_ENTRIES,
  MAX_WORKFLOW_LOG_MESSAGE_CHARS,
  MAX_WORKFLOW_PHASE_CHARS,
  MAX_WORKFLOW_PHASE_ENTRIES,
} from "./sandbox-source.ts";

export const _runSubagent = { fn: runSubagent };
export const _spawnSandbox = { fn: nodeSpawn };

export class WorkflowRuntimeError extends Error {
  readonly code: WorkflowErrorCode;
  readonly details?: unknown;
  readonly diagnostic: WorkflowRunDiagnostic;

  constructor(
    code: WorkflowErrorCode,
    message: string,
    diagnostic: WorkflowRunDiagnostic,
    details?: unknown,
  ) {
    super(message);
    this.name = "WorkflowRuntimeError";
    this.code = code;
    this.details = details;
    this.diagnostic = diagnostic;
  }
}

interface SandboxProcess {
  on(event: "message", listener: (message: unknown) => void): SandboxProcess;
  on(event: "error", listener: (error: Error) => void): SandboxProcess;
  on(event: "exit", listener: (code: number | null) => void): SandboxProcess;
  postMessage(message: unknown): void;
  terminate(): Promise<void>;
}

function createSandboxProcess(
  source: string,
  workerData: unknown,
): SandboxProcess {
  const requiredFlags = [
    "--permission",
    "--disallow-code-generation-from-strings",
  ];
  for (const flag of requiredFlags) {
    if (!process.allowedNodeEnvironmentFlags.has(flag)) {
      throw new Error(`workflow sandbox requires Node support for ${flag}`);
    }
  }

  const child = _spawnSandbox.fn(
    process.execPath,
    [...requiredFlags, "--input-type=module", "-"],
    {
      env: {},
      serialization: "advanced",
      stdio: ["pipe", "ignore", "ignore", "ipc"],
      windowsHide: true,
    },
  );
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(source);
  child.on("message", (message) => {
    if (
      message &&
      typeof message === "object" &&
      (message as { type?: unknown }).type === "sandbox-ready"
    ) {
      child.send({ type: "workflow-init", workerData });
    }
  });

  const sandbox: SandboxProcess = {
    on(event, listener): SandboxProcess {
      child.on(event, listener as never);
      return sandbox;
    },
    postMessage(message): void {
      if (!child.connected) throw new Error("workflow sandbox IPC is closed");
      child.send(message as Serializable);
    },
    async terminate(): Promise<void> {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
  return sandbox;
}

function preview(value: unknown, max = 240): string {
  const text = safeStringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function budgetError(): Error & { code: "workflow_budget_exceeded" } {
  const error = new Error("workflow token budget exceeded") as Error & {
    code: "workflow_budget_exceeded";
  };
  error.code = "workflow_budget_exceeded";
  return error;
}

function isBudgetAbort(signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true &&
    typeof signal.reason === "object" &&
    signal.reason !== null &&
    (signal.reason as { code?: unknown }).code === "workflow_budget_exceeded"
  );
}

function composeSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  }
  return controller.signal;
}

function abortError(): Error {
  const error = new Error("workflow aborted");
  error.name = "AbortError";
  return error;
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`workflow timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function missingResultError(): Error & { code: "workflow_missing_result" } {
  const error = new Error(
    "workflow run() must return a result; return null for an explicit empty result",
  ) as Error & { code: "workflow_missing_result" };
  error.code = "workflow_missing_result";
  return error;
}

function agentTimeoutMessage(timeoutMs: number): string {
  return `agent timed out after ${timeoutMs}ms`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeMaxConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_CONCURRENCY;
  }
  const parsed = Math.trunc(value);
  if (parsed <= 0 || parsed !== value) return DEFAULT_MAX_CONCURRENCY;
  return Math.min(parsed, MAX_CONCURRENCY);
}

function clampRetries(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Math.trunc(parsed), 2));
}

function failureDetails(
  code: WorkflowErrorCode,
  message: string,
  request: WorkflowAgentRequest,
  phase: string | undefined,
  logFile?: string,
): WorkflowFailureDetails {
  return {
    code,
    message,
    ...(phase ? { phase } : {}),
    agentId: request.id,
    ...(request.intent ? { intent: request.intent } : {}),
    ...(logFile ? { logFile } : {}),
    ...(request.effectiveTimeoutMs !== undefined
      ? { effectiveTimeoutMs: request.effectiveTimeoutMs }
      : {}),
  };
}

function failedResponse(
  code: WorkflowErrorCode,
  message: string,
  request: WorkflowAgentRequest,
  phase: string | undefined,
  logFile?: string,
): WorkflowAgentResponse {
  return {
    ok: false,
    text: null,
    error: message,
    errorCode: code,
    errorDetails: failureDetails(code, message, request, phase, logFile),
  };
}

function withFailureContext(
  response: WorkflowAgentResponse,
  request: WorkflowAgentRequest,
  phase: string | undefined,
): WorkflowAgentResponse {
  if (response.ok || !response.errorCode) return response;
  return {
    ...response,
    errorDetails: {
      code: response.errorCode,
      message: response.error ?? "agent failed",
      ...response.errorDetails,
      ...(phase && !response.errorDetails?.phase ? { phase } : {}),
      agentId: response.errorDetails?.agentId ?? request.id,
      intent: response.errorDetails?.intent ?? request.intent,
      logFile: response.errorDetails?.logFile ?? response.outcome?.logFile,
      ...((response.errorDetails?.effectiveTimeoutMs ??
        request.effectiveTimeoutMs) !== undefined
        ? {
            effectiveTimeoutMs:
              response.errorDetails?.effectiveTimeoutMs ??
              request.effectiveTimeoutMs,
          }
        : {}),
      ...((response.errorDetails?.diagnosticWarnings ??
        response.outcome?.diagnosticWarnings) !== undefined
        ? {
            diagnosticWarnings:
              response.errorDetails?.diagnosticWarnings ??
              response.outcome?.diagnosticWarnings,
          }
        : {}),
    },
  };
}

function isRetryableAgentFailure(response: WorkflowAgentResponse): boolean {
  if (response.ok) return false;
  return !new Set<WorkflowErrorCode>([
    "agent_policy_rejected",
    "subagent_aborted",
    "workflow_aborted",
    "workflow_timeout",
    "agent_timeout",
    "workflow_budget_exceeded",
    "workflow_run_cap_exceeded",
    "provider_schema_rejected",
  ]).has(response.errorCode ?? "subagent_failed");
}

function resolveAgentTimeoutMs(
  request: WorkflowAgentRequest,
  defaultTimeoutMs: number | undefined,
): number | undefined {
  const normalize = (value: unknown): number | undefined => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return undefined;
    return Math.trunc(parsed);
  };
  const fallback = normalize(defaultTimeoutMs);
  if (request.timeoutMs === undefined) return fallback;
  return normalize(request.timeoutMs) ?? fallback;
}

async function spawnAttemptWithTimeout(
  request: WorkflowAgentRequest,
  phase: string | undefined,
  spawnAgent: (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse>,
  timeoutMs: number | undefined,
): Promise<WorkflowAgentResponse> {
  if (timeoutMs === undefined) {
    return withFailureContext(await spawnAgent(request), request, phase);
  }

  if (request.signal?.aborted) {
    const budgetAborted = isBudgetAbort(request.signal);
    return failedResponse(
      budgetAborted ? "workflow_budget_exceeded" : "workflow_aborted",
      budgetAborted ? "workflow token budget exceeded" : "workflow aborted",
      request,
      phase,
    );
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  let forcedResponse: WorkflowAgentResponse | undefined;
  try {
    return await new Promise<WorkflowAgentResponse>((resolve, reject) => {
      const force = (response: WorkflowAgentResponse, reason: unknown) => {
        if (forcedResponse) return;
        forcedResponse = response;
        controller.abort(reason);
      };
      const abort = () => {
        const reason = request.signal?.reason ?? abortError();
        const budgetAborted = isBudgetAbort(request.signal);
        force(
          failedResponse(
            budgetAborted ? "workflow_budget_exceeded" : "workflow_aborted",
            budgetAborted
              ? "workflow token budget exceeded"
              : "workflow aborted",
            request,
            phase,
          ),
          reason,
        );
      };
      request.signal?.addEventListener("abort", abort, { once: true });
      removeAbortListener = () =>
        request.signal?.removeEventListener("abort", abort);

      timer = setTimeout(() => {
        const reason = new Error(agentTimeoutMessage(timeoutMs));
        force(
          failedResponse(
            "agent_timeout",
            agentTimeoutMessage(timeoutMs),
            request,
            phase,
          ),
          reason,
        );
      }, timeoutMs);

      spawnAgent({ ...request, signal: controller.signal }).then(
        (response) =>
          resolve(
            forcedResponse ?? withFailureContext(response, request, phase),
          ),
        (error) => {
          if (forcedResponse) resolve(forcedResponse);
          else reject(error);
        },
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener?.();
  }
}

async function spawnWithRetries(
  request: WorkflowAgentRequest,
  phase: string | undefined,
  spawnAgent: (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse>,
  defaultAgentTimeoutMs: number | undefined,
): Promise<WorkflowAgentResponse> {
  const maxAttempts = 1 + (request.retries ?? 0);
  const timeoutMs =
    request.effectiveTimeoutMs ??
    resolveAgentTimeoutMs(request, defaultAgentTimeoutMs);
  let lastResponse: WorkflowAgentResponse | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastResponse = await spawnAttemptWithTimeout(
        { ...request, attempt, effectiveTimeoutMs: timeoutMs },
        phase,
        spawnAgent,
        timeoutMs,
      );
    } catch (error) {
      lastResponse = failedResponse(
        "agent_spawn_exception",
        errorMessage(error),
        request,
        phase,
      );
    }
    if (lastResponse.ok || attempt === maxAttempts) {
      return { ...lastResponse, attempts: attempt };
    }
    if (!isRetryableAgentFailure(lastResponse)) {
      return { ...lastResponse, attempts: attempt };
    }
  }
  return (
    lastResponse ??
    failedResponse("subagent_failed", "agent failed", request, phase)
  );
}

function normalizedCause(
  error: unknown,
  terminationReason: "timeout" | "aborted" | "sandbox_error" | undefined,
  timeoutMs: number,
): WorkflowFailureDetails {
  const record =
    error && typeof error === "object"
      ? (error as { code?: unknown; details?: unknown; name?: unknown })
      : undefined;
  const candidate = typeof record?.code === "string" ? record.code : undefined;
  const known = new Set<WorkflowErrorCode>([
    "agent_policy_rejected",
    "agent_spawn_exception",
    "subagent_failed",
    "subagent_aborted",
    "provider_error",
    "provider_schema_rejected",
    "structured_output_not_called",
    "structured_output_incomplete",
    "structured_output_tool_error",
    "structured_output_malformed",
    "structured_output_invalid",
    "workflow_aborted",
    "workflow_timeout",
    "agent_timeout",
    "workflow_budget_exceeded",
    "workflow_run_cap_exceeded",
    "workflow_report_rejected",
    "workflow_missing_result",
    "workflow_script_error",
  ]);
  const code =
    terminationReason === "timeout"
      ? "workflow_timeout"
      : terminationReason === "aborted"
        ? "workflow_aborted"
        : candidate && known.has(candidate as WorkflowErrorCode)
          ? (candidate as WorkflowErrorCode)
          : record?.name === "TimeoutError"
            ? "workflow_timeout"
            : record?.name === "AbortError"
              ? "workflow_aborted"
              : "workflow_script_error";
  const message =
    error instanceof Error
      ? error.message
      : code === "workflow_timeout"
        ? `workflow timed out after ${timeoutMs}ms`
        : code === "workflow_aborted"
          ? "workflow aborted"
          : String(error);
  return {
    code,
    message: message.slice(0, 2_000),
    ...(record?.details !== undefined ? { details: record.details } : {}),
  };
}

function recoveryFailureMessage(
  response: WorkflowAgentResponse,
  effectiveTimeoutMs: number | undefined,
): string {
  const code = response.errorCode ?? "subagent_failed";
  if (code === "agent_timeout" && effectiveTimeoutMs !== undefined) {
    return agentTimeoutMessage(effectiveTimeoutMs);
  }
  const messages: Partial<Record<WorkflowErrorCode, string>> = {
    agent_policy_rejected: "agent request rejected by host policy",
    agent_spawn_exception: "agent spawn failed",
    subagent_failed: "subagent failed",
    subagent_aborted: "subagent aborted",
    provider_error: "subagent provider failed",
    provider_schema_rejected: "subagent provider rejected the output schema",
    structured_output_not_called: "structured output was not produced",
    structured_output_incomplete: "structured output did not finish",
    structured_output_tool_error: "structured output tool failed",
    structured_output_malformed: "structured output was malformed",
    structured_output_invalid: "structured output failed validation",
    workflow_aborted: "workflow canceled the agent",
    workflow_timeout: "workflow timed out",
    workflow_budget_exceeded: "workflow token budget exceeded",
    workflow_run_cap_exceeded: "workflow agent run cap exceeded",
  };
  return messages[code] ?? "agent failed";
}

function recoveryRecord(
  request: WorkflowAgentRequest,
  phase: string | undefined,
  startedAt: number,
  response: WorkflowAgentResponse,
): WorkflowRecoveryRecord | undefined {
  const finishedAt = Date.now();
  const base = {
    requestId: request.id,
    intent: request.intent.trim(),
    capabilities: [...request.capabilities],
    modelTier: request.modelTier,
    thinking: request.thinking,
    ...(phase ? { phase } : {}),
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    ...(request.effectiveTimeoutMs !== undefined
      ? { effectiveTimeoutMs: request.effectiveTimeoutMs }
      : {}),
    attempts: response.attempts ?? 1,
    ...(response.outcome?.logFile || response.errorDetails?.logFile
      ? { logFile: response.outcome?.logFile ?? response.errorDetails?.logFile }
      : {}),
  };
  if (response.ok) {
    return response.hasStructured
      ? { ...base, structuredValue: response.value }
      : undefined;
  }
  const code = response.errorCode ?? "subagent_failed";
  return {
    ...base,
    failure: {
      code,
      message: recoveryFailureMessage(response, request.effectiveTimeoutMs),
      ...(phase ? { phase } : {}),
      agentId: request.id,
      ...(request.intent ? { intent: request.intent } : {}),
      ...(response.outcome?.logFile || response.errorDetails?.logFile
        ? {
            logFile:
              response.outcome?.logFile ?? response.errorDetails?.logFile,
          }
        : {}),
      ...(request.effectiveTimeoutMs !== undefined
        ? { effectiveTimeoutMs: request.effectiveTimeoutMs }
        : {}),
      ...(response.outcome?.diagnosticWarnings !== undefined
        ? { diagnosticWarnings: response.outcome.diagnosticWarnings }
        : {}),
      ...(response.outcome?.structured && !response.outcome.structured.ok
        ? {
            details: {
              structured: {
                code: response.outcome.structured.code,
                diagnostics: response.outcome.structured.diagnostics,
                errors: response.outcome.structured.errors
                  ?.slice(0, 20)
                  .map((error) => error.slice(0, 500)),
              },
            },
          }
        : {}),
    },
  };
}

function emit(
  snapshot: WorkflowSnapshot,
  onUpdate?: (snapshot: WorkflowSnapshot) => void,
): void {
  onUpdate?.({
    ...snapshot,
    logs: [...snapshot.logs],
    agents: [...snapshot.agents],
    phases: [...snapshot.phases],
  });
}

export async function runWorkflow(
  parsed: ParsedWorkflow,
  options: WorkflowRuntimeOptions,
): Promise<WorkflowRunResult> {
  const startedAt = Date.now();
  const logs: WorkflowLogEntry[] = [];
  const agents: WorkflowAgentState[] = [];
  const phases: string[] = [];
  let agentFailureCount = 0;
  let loggedBranchFailureCount = 0;
  let settledBranchFailureCount = 0;
  let currentPhase: string | undefined;
  let result: unknown;
  let finished = false;
  let acceptingAgents = true;
  let terminalError: unknown;
  let terminationReason: "timeout" | "aborted" | "sandbox_error" | undefined;
  const inFlight = new Set<Promise<void>>();
  const settledResponses = new Map<number, WorkflowAgentResponse>();
  const recoveryRecords = new Map<number, WorkflowRecoveryRecord>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const agentTimeoutMs = options.agentTimeoutMs;
  const workflowAbort = new AbortController();
  const budgetAbort = new AbortController();
  const agentSignal = composeSignals(workflowAbort.signal, budgetAbort.signal);

  const snapshot = (): WorkflowSnapshot => ({
    meta: parsed.meta,
    phase: currentPhase,
    phases,
    logs,
    agents,
    agentFailureCount,
    loggedBranchFailureCount,
    settledBranchFailureCount,
    startedAt,
    ...(finished
      ? { finishedAt: Date.now(), resultPreview: preview(result) }
      : {}),
  });

  if (options.signal?.aborted) throw abortError();

  const worker = createSandboxProcess(
    buildSandboxSource(parsed.executableScript),
    {
      args: options.args,
      cwd: options.cwd,
      maxConcurrency: normalizeMaxConcurrency(options.maxConcurrency),
      budget: options.ledger?.snapshot() ?? {
        total: null,
        used: 0,
        launched: 0,
        maxAgents: null,
      },
    },
  );

  const unsubscribeLedger = options.ledger?.subscribe((budget) => {
    try {
      worker.postMessage({ type: "budget-update", budget });
    } catch {
      // The worker may already have completed while an agent is finalizing.
    }
    if (options.ledger?.isTokenExceeded() && !budgetAbort.signal.aborted) {
      budgetAbort.abort(budgetError());
    }
  });

  const timeout = setTimeout(() => {
    acceptingAgents = false;
    terminationReason ??= "timeout";
    workflowAbort.abort(timeoutError(timeoutMs));
    void worker.terminate();
  }, timeoutMs);

  const abort = () => {
    acceptingAgents = false;
    terminationReason ??= "aborted";
    workflowAbort.abort(abortError());
    void worker.terminate();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  emit(snapshot(), options.onUpdate);

  try {
    await new Promise<void>((resolve, reject) => {
      worker.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const event = message as { type?: string; [key: string]: unknown };
        if (event.type === "log") {
          if (logs.length < MAX_WORKFLOW_LOG_ENTRIES) {
            logs.push({
              level: event.level === "error" ? "error" : "info",
              message: String(event.message ?? "").slice(
                0,
                MAX_WORKFLOW_LOG_MESSAGE_CHARS,
              ),
              timestamp: Date.now(),
            });
            emit(snapshot(), options.onUpdate);
          }
        } else if (event.type === "branch-failure") {
          if (event.settled === true) settledBranchFailureCount += 1;
          else loggedBranchFailureCount += 1;
          emit(snapshot(), options.onUpdate);
        } else if (event.type === "phase") {
          if (phases.length < MAX_WORKFLOW_PHASE_ENTRIES) {
            currentPhase = String(event.name ?? "")
              .trim()
              .slice(0, MAX_WORKFLOW_PHASE_CHARS);
            if (currentPhase) phases.push(currentPhase);
            emit(snapshot(), options.onUpdate);
          }
        } else if (event.type === "agent") {
          if (!acceptingAgents) return;
          const request = event as {
            requestId?: unknown;
            prompt?: unknown;
            intent?: unknown;
            capabilities?: unknown;
            modelTier?: unknown;
            thinking?: unknown;
            output?: unknown;
            retries?: unknown;
            timeoutMs?: unknown;
          };
          const requestId = Number(request.requestId);
          if (!Number.isInteger(requestId)) return;
          const agentRequest: WorkflowAgentRequest = {
            id: requestId,
            prompt: String(request.prompt ?? ""),
            intent: typeof request.intent === "string" ? request.intent : "",
            capabilities: Array.isArray(request.capabilities)
              ? (request.capabilities as Capability[])
              : (["__missing__"] as unknown as Capability[]),
            modelTier:
              typeof request.modelTier === "string"
                ? (request.modelTier as ModelTier)
                : ("" as ModelTier),
            thinking:
              typeof request.thinking === "string"
                ? (request.thinking as ThinkingLevel)
                : ("" as ThinkingLevel),
            signal: agentSignal,
            retries: clampRetries(request.retries),
            ...(typeof request.timeoutMs === "number" ||
            typeof request.timeoutMs === "string"
              ? { timeoutMs: Number(request.timeoutMs) }
              : {}),
          };
          const phaseAtAdmission = currentPhase;
          agentRequest.effectiveTimeoutMs = resolveAgentTimeoutMs(
            agentRequest,
            agentTimeoutMs,
          );
          const admittedAt = Date.now();
          const outputError = validateStructuredOutput(request.output);
          if (outputError) {
            const validationRequest = agentRequest;
            const response = failedResponse(
              "agent_policy_rejected",
              outputError,
              validationRequest,
              phaseAtAdmission,
            );
            agentFailureCount += 1;
            settledResponses.set(requestId, response);
            const record = recoveryRecord(
              validationRequest,
              phaseAtAdmission,
              admittedAt,
              response,
            );
            if (record) recoveryRecords.set(requestId, record);
            worker.postMessage({
              type: "agent-response",
              requestId,
              response,
            });
            emit(snapshot(), options.onUpdate);
            return;
          }
          if (isStructuredOutputSpec(request.output)) {
            agentRequest.output = request.output;
          }
          const admitted = (async () => {
            let response: WorkflowAgentResponse;
            try {
              response = await spawnWithRetries(
                agentRequest,
                phaseAtAdmission,
                options.spawnAgent,
                agentTimeoutMs,
              );
            } catch (error) {
              response = failedResponse(
                "agent_spawn_exception",
                errorMessage(error),
                agentRequest,
                phaseAtAdmission,
              );
            }
            if (!response.ok) agentFailureCount += 1;
            settledResponses.set(requestId, response);
            const record = recoveryRecord(
              agentRequest,
              phaseAtAdmission,
              admittedAt,
              response,
            );
            if (record) recoveryRecords.set(requestId, record);
            try {
              worker.postMessage({
                type: "agent-response",
                requestId,
                response,
              });
            } catch {
              // Settlement is retained even if the sandbox has terminated.
            }
            emit(snapshot(), options.onUpdate);
          })();
          inFlight.add(admitted);
          void admitted.finally(() => inFlight.delete(admitted));
          emit(snapshot(), options.onUpdate);
        } else if (event.type === "result") {
          acceptingAgents = false;
          if (event.result === undefined) {
            workflowAbort.abort(missingResultError());
            reject(missingResultError());
            return;
          }
          result = event.result;
          finished = true;
          workflowAbort.abort(abortError());
          resolve();
        } else if (event.type === "script-error") {
          acceptingAgents = false;
          const serialized = event.error as {
            code?: unknown;
            message?: unknown;
            details?: unknown;
          };
          const error = new Error(
            typeof serialized?.message === "string"
              ? serialized.message
              : "workflow script failed",
          ) as Error & { code?: string; details?: unknown };
          if (typeof serialized?.code === "string")
            error.code = serialized.code;
          if (serialized?.details !== undefined)
            error.details = serialized.details;
          workflowAbort.abort(error);
          reject(error);
        }
      });
      worker.on("error", (error) => {
        acceptingAgents = false;
        terminationReason = terminationReason ?? "sandbox_error";
        workflowAbort.abort(error);
        reject(error);
      });
      worker.on("exit", (code) => {
        if (finished) return;
        acceptingAgents = false;
        if (terminationReason === "timeout") reject(timeoutError(timeoutMs));
        else if (terminationReason === "aborted" || options.signal?.aborted)
          reject(abortError());
        else reject(new Error(`workflow sandbox exited with code ${code}`));
      });
    });
  } catch (error) {
    terminalError = error;
  } finally {
    acceptingAgents = false;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    unsubscribeLedger?.();
    if (!workflowAbort.signal.aborted) workflowAbort.abort();
    await worker.terminate().catch(() => undefined);
    await Promise.allSettled([...inFlight]);
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  if (terminalError !== undefined) {
    const cause = normalizedCause(terminalError, terminationReason, timeoutMs);
    const responses = [...settledResponses.values()];
    const timedOut = responses.filter(
      (response) => response.errorCode === "agent_timeout",
    ).length;
    const canceled = responses.filter((response) =>
      new Set<WorkflowErrorCode>([
        "subagent_aborted",
        "workflow_aborted",
        "workflow_budget_exceeded",
      ]).has(response.errorCode ?? "subagent_failed"),
    ).length;
    const completed = responses.filter((response) => response.ok).length;
    const failed = responses.length - completed - timedOut - canceled;
    const finalSnapshot: WorkflowSnapshot = {
      ...snapshot(),
      finishedAt,
    };
    const diagnostic: WorkflowRunDiagnostic = {
      cause,
      counts: {
        completed,
        failed,
        timedOut,
        canceled,
        outstanding: 0,
      },
      snapshot: finalSnapshot,
      recoveryRecords: [...recoveryRecords.values()].sort(
        (a, b) => a.requestId - b.requestId,
      ),
      startedAt,
      finishedAt,
      durationMs,
    };
    emit(finalSnapshot, options.onUpdate);
    throw new WorkflowRuntimeError(
      cause.code,
      cause.message,
      diagnostic,
      cause.details,
    );
  }

  emit(snapshot(), options.onUpdate);
  return {
    ok: true,
    aborted: false,
    meta: parsed.meta,
    result,
    logs,
    agents,
    phases,
    agentFailureCount,
    loggedBranchFailureCount,
    settledBranchFailureCount,
    durationMs,
  };
}

function validateStructuredOutput(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isStructuredOutputSpec(value)) {
    return "output must contain an object schema";
  }
  const errors = validateOutputSchema(value.schema, "output.schema");
  return errors.length > 0 ? errors.join("; ") : undefined;
}

function isStructuredOutputSpec(value: unknown): value is {
  schema: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as { schema?: unknown };
  return Boolean(
    record.schema &&
    typeof record.schema === "object" &&
    !Array.isArray(record.schema),
  );
}

export function createWorkflowAgentSpawner(
  options: WorkflowAgentPolicyOptions,
): (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse> {
  return async (request) => {
    const outputError = validateStructuredOutput(request.output);
    if (outputError) {
      return failedResponse(
        "agent_policy_rejected",
        outputError,
        request,
        undefined,
      );
    }
    const denial = options.ledger?.reserve(request.id);
    if (denial) {
      const message =
        denial === "workflow_budget_exceeded"
          ? "workflow token budget exceeded"
          : "workflow agent run cap exceeded";
      return failedResponse(denial, message, request, undefined);
    }

    const state: WorkflowAgentState = {
      id: request.id,
      intent: request.intent.trim(),
      capabilities: [...request.capabilities],
      modelTier: request.modelTier,
      thinking: request.thinking,
      status: "running",
      effectiveTimeoutMs: request.effectiveTimeoutMs,
      explicitTimeoutMs: resolveAgentTimeoutMs(request, undefined),
      startedAt: Date.now(),
    };

    const tracker = createSubagentActivityTracker({
      toolCallId: `${options.logId}:agent-${request.id}`,
      roleLabel: "Workflow subagent",
      intent: state.intent,
      showActivity: false,
      hasUI: false,
      onUpdate: () => {
        state.activity = {
          ...tracker.state,
          capabilities: [...request.capabilities],
          modelTier: request.modelTier,
          thinking: request.thinking,
          resolved: state.status !== "running",
        };
        options.onAgentUpdate?.({ ...state });
      },
    });

    function refreshActivity(): void {
      state.activity = {
        ...tracker.state,
        capabilities: [...request.capabilities],
        modelTier: request.modelTier,
        thinking: request.thinking,
        resolved: state.status !== "running",
      };
      options.onAgentUpdate?.({ ...state });
    }

    refreshActivity();

    const outcome = await _runSubagent.fn({
      intent: request.intent,
      prompt: request.prompt,
      capabilities: request.capabilities,
      modelTier: request.modelTier,
      thinking: request.thinking,
      output: request.output,
      logId: `${options.logId}:agent-${request.id}`,
      cwd: options.cwd,
      signal: request.signal ?? options.signal,
      modelRegistry: options.modelRegistry,
      onEvent: (event) => {
        tracker.handleEvent(event);
        options.ledger?.recordTokens(
          request.id,
          request.attempt ?? 1,
          tracker.state.totalTokens,
        );
      },
    });

    state.finishedAt = Date.now();
    tracker.finish(outcome);
    options.ledger?.recordTokens(
      request.id,
      request.attempt ?? 1,
      tracker.state.totalTokens,
    );
    if (outcome.ok) {
      state.status = "done";
      state.diagnosticWarnings = outcome.diagnosticWarnings;
      state.resultPreview = preview(
        outcome.structured?.ok ? outcome.structured.value : outcome.stdout,
      );
      refreshActivity();
      if (outcome.structured?.ok) {
        return {
          ok: true,
          text: outcome.stdout,
          hasStructured: true,
          value: outcome.structured.value,
          outcome,
        };
      }
      return { ok: true, text: outcome.stdout, outcome };
    }
    state.status = outcome.aborted ? "aborted" : "error";
    state.errorMessage = formatSpawnFailure(outcome);
    state.logFile = outcome.logFile;
    state.diagnosticWarnings = outcome.diagnosticWarnings;
    const code: WorkflowErrorCode = outcome.aborted
      ? isBudgetAbort(request.signal)
        ? "workflow_budget_exceeded"
        : "subagent_aborted"
      : outcome.errorMessage?.startsWith("subagent policy validation failed:")
        ? "agent_policy_rejected"
        : (outcome.errorCode ?? outcome.structured?.code ?? "subagent_failed");
    state.errorCode = code;
    refreshActivity();
    return {
      ok: false,
      text: null,
      error: state.errorMessage,
      errorCode: code,
      errorDetails: {
        ...failureDetails(
          code,
          state.errorMessage,
          request,
          undefined,
          outcome.logFile,
        ),
        diagnosticWarnings: outcome.diagnosticWarnings,
      },
      outcome,
    };
  };
}
