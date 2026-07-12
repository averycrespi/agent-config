import { spawn as nodeSpawn, type Serializable } from "node:child_process";
import {
  createSubagentActivityTracker,
  formatSpawnFailure,
  spawnSubagent,
  validateOutputSchema,
} from "../subagents/api.ts";
import {
  DEFAULT_AGENT_TYPE,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  READ_MOSTLY_AGENT_TYPES,
  type WorkflowAgentPolicyOptions,
  type WorkflowAgentRequest,
  type WorkflowAgentResponse,
  type WorkflowAgentState,
  type WorkflowLogEntry,
  type WorkflowRunResult,
  type WorkflowErrorCode,
  type WorkflowFailureDetails,
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

export const _spawnSubagent = { fn: spawnSubagent };
export const _spawnSandbox = { fn: nodeSpawn };

const READ_ONLY_WORKFLOW_TOOLS = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "mcp_search",
  "mcp_describe",
  "mcp_call",
  "web_search",
  "web_fetch",
]);

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
  const timeoutMs = resolveAgentTimeoutMs(request, defaultAgentTimeoutMs);
  let lastResponse: WorkflowAgentResponse | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastResponse = await spawnAttemptWithTimeout(
        { ...request, attempt },
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
  let terminationReason: "timeout" | "aborted" | "sandbox_error" | undefined;
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
    terminationReason = "timeout";
    workflowAbort.abort(timeoutError(timeoutMs));
    void worker.terminate();
  }, timeoutMs);

  const abort = () => {
    terminationReason = "aborted";
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
          const request = event as {
            requestId?: unknown;
            prompt?: unknown;
            agent?: unknown;
            intent?: unknown;
            output?: unknown;
            model?: unknown;
            retries?: unknown;
            timeoutMs?: unknown;
          };
          const requestId = Number(request.requestId);
          if (!Number.isInteger(requestId)) return;
          const agentRequest: WorkflowAgentRequest = {
            id: requestId,
            prompt: String(request.prompt ?? ""),
            signal: agentSignal,
            ...(typeof request.agent === "string"
              ? { agent: request.agent }
              : {}),
            ...(typeof request.intent === "string"
              ? { intent: request.intent }
              : {}),
            ...(typeof request.model === "string"
              ? { model: request.model }
              : {}),
            retries: clampRetries(request.retries),
            ...(typeof request.timeoutMs === "number" ||
            typeof request.timeoutMs === "string"
              ? { timeoutMs: Number(request.timeoutMs) }
              : {}),
          };
          const outputError = validateStructuredOutput(request.output);
          if (outputError) {
            const validationRequest = {
              ...agentRequest,
              intent:
                agentRequest.intent?.trim() ||
                agentRequest.agent?.trim() ||
                DEFAULT_AGENT_TYPE,
            };
            agentFailureCount += 1;
            worker.postMessage({
              type: "agent-response",
              requestId,
              response: failedResponse(
                "agent_policy_rejected",
                outputError,
                validationRequest,
                currentPhase,
              ),
            });
            emit(snapshot(), options.onUpdate);
            return;
          }
          if (isStructuredOutputSpec(request.output)) {
            agentRequest.output = request.output;
          }
          void spawnWithRetries(
            agentRequest,
            currentPhase,
            options.spawnAgent,
            agentTimeoutMs,
          ).then((response) => {
            if (!response.ok) agentFailureCount += 1;
            try {
              worker.postMessage({
                type: "agent-response",
                requestId,
                response,
              });
            } catch {
              return;
            }
            emit(snapshot(), options.onUpdate);
          });
          emit(snapshot(), options.onUpdate);
        } else if (event.type === "result") {
          result = event.result;
          finished = true;
          resolve();
        } else if (event.type === "script-error") {
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
          reject(error);
        }
      });
      worker.on("error", (error) => {
        terminationReason = terminationReason ?? "sandbox_error";
        workflowAbort.abort(error);
        reject(error);
      });
      worker.on("exit", (code) => {
        if (finished) return;
        if (terminationReason === "timeout") reject(timeoutError(timeoutMs));
        else if (terminationReason === "aborted" || options.signal?.aborted)
          reject(abortError());
        else reject(new Error(`workflow sandbox exited with code ${code}`));
      });
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    unsubscribeLedger?.();
    if (!workflowAbort.signal.aborted) workflowAbort.abort();
    void worker.terminate();
  }

  const durationMs = Date.now() - startedAt;
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
  const agentMap = new Map(options.agents.map((agent) => [agent.name, agent]));
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
    const requestedType = request.agent?.trim() || DEFAULT_AGENT_TYPE;
    if (!READ_MOSTLY_AGENT_TYPES.has(requestedType)) {
      const message = `agent type ${JSON.stringify(requestedType)} is not allowed in workflows`;
      return {
        ok: false,
        text: null,
        error: message,
        errorCode: "agent_policy_rejected",
        errorDetails: failureDetails(
          "agent_policy_rejected",
          message,
          request,
          undefined,
        ),
      };
    }
    const agent = agentMap.get(requestedType);
    if (!agent) {
      const message = `unknown agent type ${JSON.stringify(requestedType)}`;
      return {
        ok: false,
        text: null,
        error: message,
        errorCode: "agent_policy_rejected",
        errorDetails: failureDetails(
          "agent_policy_rejected",
          message,
          request,
          undefined,
        ),
      };
    }

    let selectedModel = agent.model ?? options.model;
    if (request.model !== undefined) {
      const requestedTier = request.model.trim();
      if (requestedTier !== "small" && requestedTier !== "big") {
        const message = `model alias ${JSON.stringify(requestedTier)} is not allowed in workflows`;
        return failedResponse(
          "agent_policy_rejected",
          message,
          request,
          undefined,
        );
      }
      const tierModel = options.modelTiers?.[requestedTier]?.trim();
      if (!tierModel) {
        const message = `model alias ${JSON.stringify(requestedTier)} is not configured`;
        return failedResponse(
          "agent_policy_rejected",
          message,
          request,
          undefined,
        );
      }
      selectedModel = tierModel;
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
      agent: requestedType,
      intent: request.intent?.trim() || requestedType,
      prompt: request.prompt,
      status: "running",
      startedAt: Date.now(),
    };

    const tracker = createSubagentActivityTracker({
      toolCallId: `${options.logId}:agent-${request.id}`,
      roleLabel:
        agent.name.charAt(0).toUpperCase() + agent.name.slice(1) + " agent",
      intent: state.intent,
      showActivity: false,
      hasUI: false,
      onUpdate: () => {
        state.activity = {
          ...tracker.state,
          agentType: requestedType,
          resolved: state.status !== "running",
        };
        options.onAgentUpdate?.({ ...state });
      },
    });

    function refreshActivity(): void {
      state.activity = {
        ...tracker.state,
        agentType: requestedType,
        resolved: state.status !== "running",
      };
      options.onAgentUpdate?.({ ...state });
    }

    refreshActivity();

    const outcome = await _spawnSubagent.fn({
      prompt: request.prompt,
      output: request.output,
      toolAllowlist: agent.tools.filter((tool) =>
        READ_ONLY_WORKFLOW_TOOLS.has(tool),
      ),
      extensionAllowlist: agent.extensions,
      model: selectedModel,
      thinking: agent.thinking ?? options.thinking,
      env: agent.env,
      systemPrompt: agent.systemPrompt,
      inheritSession: "none",
      disableSkills: agent.disableSkills,
      disablePromptTemplates: agent.disablePromptTemplates,
      logId: `${options.logId}:agent-${request.id}`,
      cwd: options.cwd,
      signal: request.signal ?? options.signal,
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
    refreshActivity();
    const code: WorkflowErrorCode = outcome.aborted
      ? isBudgetAbort(request.signal)
        ? "workflow_budget_exceeded"
        : "subagent_aborted"
      : (outcome.errorCode ?? outcome.structured?.code ?? "subagent_failed");
    return {
      ok: false,
      text: null,
      error: state.errorMessage,
      errorCode: code,
      errorDetails: failureDetails(
        code,
        state.errorMessage,
        request,
        undefined,
        outcome.logFile,
      ),
      outcome,
    };
  };
}
