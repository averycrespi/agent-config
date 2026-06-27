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
  type WorkflowRuntimeOptions,
  type WorkflowSnapshot,
} from "./types.ts";
import type { ParsedWorkflow } from "./types.ts";
import { buildWorkerSource } from "./worker-source.ts";

export const _spawnSubagent = { fn: spawnSubagent };
export const _worker = {
  create: (source: string, workerData: unknown) =>
    new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
      workerData,
    }),
};

function preview(value: unknown, max = 240): string {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, null, 2) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function abortError(): Error {
  const error = new Error("workflow aborted");
  error.name = "AbortError";
  return error;
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
    void worker.terminate();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const abort = () => {
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
          };
          const requestId = Number(request.requestId);
          if (!Number.isInteger(requestId)) return;
          const agentRequest: WorkflowAgentRequest = {
            id: requestId,
            prompt: String(request.prompt ?? ""),
            ...(typeof request.agent === "string"
              ? { agent: request.agent }
              : {}),
            ...(typeof request.intent === "string"
              ? { intent: request.intent }
              : {}),
          };
          void options.spawnAgent(agentRequest).then((response) => {
            worker.postMessage({ type: "agent-response", requestId, response });
            emit(snapshot(), options.onUpdate);
          });
          emit(snapshot(), options.onUpdate);
        } else if (event.type === "result") {
          result = event.result;
          finished = true;
          resolve();
        }
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (finished) return;
        if (options.signal?.aborted) reject(abortError());
        else reject(new Error(`workflow worker exited with code ${code}`));
      });
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
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

export function createWorkflowAgentSpawner(
  options: WorkflowAgentPolicyOptions,
): (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse> {
  const agentMap = new Map(options.agents.map((agent) => [agent.name, agent]));
  return async (request) => {
    const requestedType = request.agent?.trim() || DEFAULT_AGENT_TYPE;
    if (!READ_MOSTLY_AGENT_TYPES.has(requestedType)) {
      return {
        ok: false,
        text: null,
        error: `agent type ${JSON.stringify(requestedType)} is not allowed in workflows`,
      };
    }
    const agent = agentMap.get(requestedType);
    if (!agent)
      return {
        ok: false,
        text: null,
        error: `unknown agent type ${JSON.stringify(requestedType)}`,
      };

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
      signal: options.signal,
      onEvent: (event) => tracker.handleEvent(event),
    });

    state.finishedAt = Date.now();
    tracker.finish(outcome);
    if (outcome.ok) {
      state.status = "done";
      state.resultPreview = preview(outcome.stdout);
      refreshActivity();
      return { ok: true, text: outcome.stdout, outcome };
    }
    state.status = outcome.aborted ? "aborted" : "error";
    state.errorMessage = formatSpawnFailure(outcome);
    state.logFile = outcome.logFile;
    refreshActivity();
    return { ok: false, text: null, error: state.errorMessage, outcome };
  };
}
