import { Worker } from "node:worker_threads";
import {
  createSubagentActivityTracker,
  formatSpawnFailure,
  spawnSubagent,
} from "../subagents/api.ts";
import {
  DEFAULT_AGENT_TYPE,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
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
import { buildWorkerSource } from "./worker-source.ts";

export const _spawnSubagent = { fn: spawnSubagent };
export const _worker = {
  create: (source: string, workerData: unknown) =>
    new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
      workerData,
    }),
};

function preview(value: unknown, max = 240): string {
  const text = safeStringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
  ]).has(response.errorCode ?? "subagent_failed");
}

async function spawnWithRetries(
  request: WorkflowAgentRequest,
  phase: string | undefined,
  spawnAgent: (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse>,
): Promise<WorkflowAgentResponse> {
  const maxAttempts = 1 + (request.retries ?? 0);
  let lastResponse: WorkflowAgentResponse | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastResponse = withFailureContext(
        await spawnAgent(request),
        request,
        phase,
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
  let failureCount = 0;
  let currentPhase: string | undefined;
  let result: unknown;
  let finished = false;
  let terminationReason: "timeout" | "aborted" | "worker_error" | undefined;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workflowAbort = new AbortController();

  const snapshot = (): WorkflowSnapshot => ({
    meta: parsed.meta,
    phase: currentPhase,
    phases,
    logs,
    agents,
    failureCount,
    startedAt,
    ...(finished
      ? { finishedAt: Date.now(), resultPreview: preview(result) }
      : {}),
  });

  if (options.signal?.aborted) throw abortError();

  const worker = _worker.create(buildWorkerSource(parsed.executableScript), {
    args: options.args,
    cwd: options.cwd,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
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
          logs.push({
            level: event.level === "error" ? "error" : "info",
            message: String(event.message ?? ""),
            timestamp: Date.now(),
          });
          if (event.level === "error") failureCount += 1;
          emit(snapshot(), options.onUpdate);
        } else if (event.type === "phase") {
          currentPhase = String(event.name ?? "").trim();
          if (currentPhase) phases.push(currentPhase);
          emit(snapshot(), options.onUpdate);
        } else if (event.type === "agent") {
          const request = event as {
            requestId?: unknown;
            prompt?: unknown;
            agent?: unknown;
            intent?: unknown;
            output?: unknown;
            retries?: unknown;
          };
          const requestId = Number(request.requestId);
          if (!Number.isInteger(requestId)) return;
          const agentRequest: WorkflowAgentRequest = {
            id: requestId,
            prompt: String(request.prompt ?? ""),
            signal: workflowAbort.signal,
            ...(typeof request.agent === "string"
              ? { agent: request.agent }
              : {}),
            ...(typeof request.intent === "string"
              ? { intent: request.intent }
              : {}),
            ...(isStructuredOutputSpec(request.output)
              ? { output: request.output }
              : {}),
            retries: clampRetries(request.retries),
          };
          void spawnWithRetries(
            agentRequest,
            currentPhase,
            options.spawnAgent,
          ).then((response) => {
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
        }
      });
      worker.on("error", (error) => {
        terminationReason = terminationReason ?? "worker_error";
        workflowAbort.abort(error);
        reject(error);
      });
      worker.on("exit", (code) => {
        if (finished) return;
        if (terminationReason === "timeout") reject(timeoutError(timeoutMs));
        else if (terminationReason === "aborted" || options.signal?.aborted)
          reject(abortError());
        else reject(new Error(`workflow worker exited with code ${code}`));
      });
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
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
    failureCount,
    durationMs,
  };
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
      toolAllowlist: agent.tools,
      extensionAllowlist: agent.extensions,
      model: agent.model ?? options.model,
      thinking: agent.thinking ?? options.thinking,
      systemPrompt: agent.systemPrompt,
      inheritSession: "none",
      disableSkills: agent.disableSkills,
      disablePromptTemplates: agent.disablePromptTemplates,
      logId: `${options.logId}:agent-${request.id}`,
      cwd: options.cwd,
      signal: request.signal ?? options.signal,
      onEvent: (event) => tracker.handleEvent(event),
    });

    state.finishedAt = Date.now();
    tracker.finish(outcome);
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
      ? "subagent_aborted"
      : (outcome.structured?.code ?? "subagent_failed");
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
