import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import {
  persistRetainedJson,
  type RetainedArtifactResult,
} from "../_shared/retained-artifacts.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import { stringEnum } from "../_shared/schema.ts";
import { loadWorkflowConfig, type WorkflowConfig } from "./config.ts";
import { parseWorkflowScript } from "./parser.ts";
import { createWorkflowRunLedger } from "./ledger.ts";
import {
  createWorkflowAgentSpawner,
  runWorkflow,
  WorkflowRuntimeError,
} from "./runtime.ts";
import { safeStringify } from "./safe-stringify.ts";
import { persistWorkflowScript } from "./script-artifacts.ts";
import {
  formatWorkflowInventory,
  inventoryWorkflows,
  resolveSavedWorkflow,
} from "./store.ts";
import type {
  ParsedWorkflow,
  WorkflowAgentState,
  WorkflowRunDiagnostic,
  WorkflowSnapshot,
} from "./types.ts";
import { renderWorkflowCall, renderWorkflowResult } from "./display.ts";
import {
  getBackgroundService,
  type ProgressUpdate,
} from "../background/api.ts";
import { prepareWorkflowOutcome, workflowOutcomeStatus } from "./background.ts";

const workflowParamsSchema = Type.Object(
  {
    action: stringEnum(
      [
        "run",
        "list",
        "validate",
        "executions",
        "inspect",
        "cancel",
        "dismiss",
      ] as const,
      {
        description: "Action to perform.",
      },
    ),
    execution: Type.Optional(stringEnum(["foreground", "background"] as const)),
    id: Type.Optional(
      Type.String({
        description: "Background execution ID for inspect/cancel/dismiss.",
      }),
    ),
    script: Type.Optional(
      Type.String({
        description:
          "Inline JavaScript workflow source. Accepted by run and validate instead of name.",
      }),
    ),
    name: Type.Optional(
      Type.String({
        description:
          "Saved workflow name. Accepted by run and validate instead of script.",
      }),
    ),
    args: Type.Optional(
      Type.Any({
        description:
          "Optional verbatim JSON value exposed to a run script as args.",
      }),
    ),
  },
  { additionalProperties: false },
);

type WorkflowParams = Static<typeof workflowParamsSchema>;

const text = (value: string) => [{ type: "text" as const, text: value }];

function formatFinal(
  result: Awaited<ReturnType<typeof runWorkflow>>,
  scriptFile: string,
  sourceFile?: string,
): string {
  const body = safeStringify(result.result);
  return [
    `Run script: ${scriptFile}`,
    ...(sourceFile ? [`Saved source: ${sourceFile}`] : []),
    `Workflow ${result.meta.name} completed in ${(result.durationMs / 1000).toFixed(1)}s.`,
    `Agent failures: ${result.agentFailureCount}`,
    `Branch failures: ${result.loggedBranchFailureCount} logged, ${result.settledBranchFailureCount} settled`,
    "",
    body ?? "null",
  ].join("\n");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `Error: ${error.message}`;
  return `Error: ${String(error)}`;
}

function formatAbnormalWorkflow(
  diagnostic: WorkflowRunDiagnostic,
  recoveryPath?: string,
  warning?: string,
): string[] {
  const { cause, counts } = diagnostic;
  return [
    `Error [${cause.code}]: ${cause.message}`,
    `Agents: ${counts.completed} completed, ${counts.failed} failed, ${counts.timedOut} timed out, ${counts.canceled} canceled, ${counts.outstanding} outstanding`,
    ...(recoveryPath ? [`Recovery artifact: ${recoveryPath}`] : []),
    ...(warning ? [`Warning: ${warning}`] : []),
  ];
}

function recoveryPrimaryFailure(diagnostic: WorkflowRunDiagnostic): {
  code: string;
  message: string;
} {
  const code = diagnostic.cause.code;
  const messages: Partial<Record<typeof code, string>> = {
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
    workflow_aborted: "workflow aborted",
    workflow_timeout: "workflow timed out",
    agent_timeout: "workflow agent timed out",
    workflow_budget_exceeded: "workflow token budget exceeded",
    workflow_run_cap_exceeded: "workflow agent run cap exceeded",
    workflow_report_rejected: "workflow report rejected",
    workflow_missing_result: "workflow run() did not return a result",
    workflow_script_error: "workflow script failed",
  };
  return { code, message: messages[code] ?? "workflow failed" };
}

function recoveryEnvelope(
  meta: ParsedWorkflow["meta"],
  diagnostic: WorkflowRunDiagnostic,
  states: WorkflowAgentState[],
): Record<string, unknown> {
  const statesById = new Map(states.map((state) => [state.id, state]));
  const calls = diagnostic.recoveryRecords.map((record) => {
    const state = statesById.get(record.requestId);
    return {
      ...record,
      intent: state?.intent ?? record.intent,
      effectiveTimeoutMs:
        state?.effectiveTimeoutMs ?? record.effectiveTimeoutMs,
      usage: state?.activity
        ? {
            totalTokens: state.activity.totalTokens,
            toolUseCount: state.activity.toolUseCount,
          }
        : { totalTokens: 0, toolUseCount: 0 },
    };
  });
  return {
    schemaVersion: 2,
    workflow: {
      name: meta.name,
      description: meta.description,
      finalPhase: diagnostic.snapshot.phase,
      startedAt: diagnostic.startedAt,
      finishedAt: diagnostic.finishedAt,
      durationMs: diagnostic.durationMs,
    },
    primaryFailure: recoveryPrimaryFailure(diagnostic),
    counts: diagnostic.counts,
    usage: {
      totalTokens: states.reduce(
        (sum, state) => sum + (state.activity?.totalTokens ?? 0),
        0,
      ),
      settledCalls: calls.length,
    },
    calls,
  };
}

function validateCombination(params: WorkflowParams): string[] {
  const errors: string[] = [];
  const control = ["executions", "inspect", "cancel", "dismiss"].includes(
    params.action,
  );
  if (params.execution !== undefined && params.action !== "run")
    errors.push("execution is only accepted by run.");
  if (control) {
    if (
      params.script !== undefined ||
      params.name !== undefined ||
      params.args !== undefined
    )
      errors.push("Execution controls do not accept script, name, or args.");
    if (params.action !== "executions" && !params.id)
      errors.push("Execution control requires id.");
  }
  if (
    params.id !== undefined &&
    !["inspect", "cancel", "dismiss"].includes(params.action)
  )
    errors.push("id is only accepted by inspect/cancel/dismiss.");
  const hasScript = params.script !== undefined;
  const hasName = params.name !== undefined;
  if (params.action === "run" || params.action === "validate") {
    if (hasScript === hasName)
      errors.push(`${params.action} requires exactly one of script or name.`);
  }
  if (params.action === "validate" && params.args !== undefined)
    errors.push("args is not accepted by validate.");
  if (params.action === "list") {
    if (hasScript) errors.push("script is not accepted by list.");
    if (hasName) errors.push("name is not accepted by list.");
    if (params.args !== undefined) errors.push("args is not accepted by list.");
  }
  return errors;
}

type LoadWorkflowConfig = (
  cwd: string,
  warnings?: string[],
) => Promise<WorkflowConfig>;

type WorkflowToolDependencies = {
  persistScript: typeof persistWorkflowScript;
  persistRecovery: (
    toolCallId: string,
    value: unknown,
  ) => Promise<RetainedArtifactResult>;
  inventory: typeof inventoryWorkflows;
  resolveSaved: typeof resolveSavedWorkflow;
};

export function registerWorkflowTool(
  pi: ExtensionAPI,
  loadConfig: LoadWorkflowConfig = loadWorkflowConfig,
  overrides: Partial<WorkflowToolDependencies> = {},
): void {
  const dependencies: WorkflowToolDependencies = {
    persistScript: persistWorkflowScript,
    persistRecovery: (toolCallId, value) =>
      persistRetainedJson("workflow-recovery", toolCallId, value),
    inventory: inventoryWorkflows,
    resolveSaved: resolveSavedWorkflow,
    ...overrides,
  };

  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description: `List, validate, or run deterministic JavaScript workflows that orchestrate isolated read-mostly subagents.

Use action \"list\" for current reusable definitions, action \"validate\" with exactly one of script/name without execution, or action \"run\" with exactly one of script/name and optional args.
Scripts must start with literal metadata: export const meta = { name: \"...\", description: \"...\" }, followed by export async function run() { ... }.
run() must return its final value: return results, or return await report(results, { gate: () => verdict }). report() is an async gate, not an output emitter; return null for an intentional empty result.
Use the globals agent(prompt, { intent, capabilities, profile, output?, retries?, timeoutMs? }), verify(claim, { intent, capabilities, profile, context?, retries?, timeoutMs? }), report(value, { gate: () => verdict }), budget, parallel(thunks), parallelSettled(thunks), pipeline(items, ...stages), phase(name), log(message), args, and cwd.
Concurrency is bounded by configuration. Every agent and verifier call explicitly declares execution policy; write-filesystem and exec-shell are rejected. The immutable budget mirror is advisory; host-side run and token caps are authoritative.
Omit timeoutMs normally to use configured agentTimeoutMs (default 10 minutes). An explicit timeoutMs overrides the per-attempt agent/verify deadline, not the whole-run workflowTimeoutMs (default 1 hour), which still bounds all work.
Do not use imports, require, filesystem/network/timer APIs, Date.now, new Date, or Math.random.
Execution defaults to foreground. Use execution: background for authorized independent work; one workflow owns and awaits all its children. Background must be loaded. Use executions to list retained runs, inspect/cancel/dismiss with id; list still lists saved definitions. Wait for automatic notification, not polling. Inspect typed failures, partial results and accounting; execution success is not acceptance. No replay, extra retries or renewed budgets.`,
    promptSnippet:
      "List, validate, or run a deterministic JavaScript workflow, foreground or background.",
    promptGuidelines: [
      "Call workflow with action list when a reusable saved workflow may apply.",
      "Workflow background runs require authorized independent work. Wait for automatic completion; use workflow inspect/cancel/dismiss controls. One workflow owns all children and preserves gates, budgets and deadlines; no replay or nested background execution.",
      "Use workflow for read-mostly subagent work that benefits from deterministic orchestration—dependent phases, programmatic aggregation, or verification gates—or an applicable saved workflow. Prefer subagents for a simple independent batch; parallelism or structured output alone does not require workflow. Preserve skill-required workflows. Use script with the selected mcp provider for gateway composition that needs no subagent reasoning.",
      "Do not use workflow for workspace mutation; write-filesystem and exec-shell are rejected, so use only explicitly justified read-mostly capabilities.",
      "Pass thunks to parallel() or parallelSettled(), e.g. `parallel(items.map((item) => () => agent(...)))`, so concurrency remains bounded.",
      "parallel() represents failed branches as null; use parallelSettled() when completeness or per-branch failure accounting matters. Never silently discard failed required branches.",
      "Use `agent(prompt, { output: { schema } })` for machine-readable research and fan-in boundaries. Validated structured successes may be retained after abnormal termination; successful prose is not retained in recovery artifacts.",
      "verify() resolves { ok, reasons }; report() passes only when its callable gate returns true or an object with ok: true. Return the gated result rather than treating report() as an output emitter.",
      "workflow_run_cap_exceeded denies later calls, while workflow_budget_exceeded aborts active agents and prevents retries or new spawns.",
      "Brief every agent and verifier with a self-contained task, explicit capabilities (including []), and profile.",
      "Use small bounded `retries` values only for read-only subagent calls that can safely be repeated.",
      "In workflow scripts, prefer configured deadlines; set agent/verify `timeoutMs` only for a justified task-specific per-attempt deadline. Account for workload and profile; avoid blanket short deadlines for substantial research, review, or strong-profile calls. A longer child override cannot extend the whole-run deadline.",
      "After a workflow timeout, inspect the failure code, effective deadline, available progress, and partial results before deciding whether to retry. A timeout alone does not prove work stalled. Preserve useful completed results and target missing work; do not blindly rerun the entire fan-out. Timeout failures are not automatically retried.",
    ],
    parameters: workflowParamsSchema,
    renderCall: renderWorkflowCall,
    renderResult: renderWorkflowResult,

    async execute(toolCallId, params: WorkflowParams, signal, onUpdate, ctx) {
      const combinationErrors = validateCombination(params);
      if (combinationErrors.length > 0) {
        return {
          content: text(
            `Invalid workflow input:\n- ${combinationErrors.join("\n- ")}`,
          ),
          details: {
            action: params.action,
            inputError: true,
            errors: combinationErrors,
          },
        };
      }

      if (
        ["executions", "inspect", "cancel", "dismiss"].includes(params.action)
      ) {
        const service = getBackgroundService(pi);
        const value =
          params.action === "executions"
            ? service
                .list("workflow")
                .map(({ result: _result, ...record }) => record)
            : params.action === "inspect"
              ? service.inspect("workflow", params.id!)
              : params.action === "cancel"
                ? service.cancel("workflow", params.id!)
                : service.dismiss("workflow", params.id!);
        return {
          content: text(JSON.stringify(value)),
          details: { action: params.action, background: value },
        };
      }
      const cwd = ctx.cwd;
      const modelRegistry = ctx.modelRegistry;
      // Capture caller-owned mutable input before asynchronous configuration/source reads.
      let args: unknown;
      try {
        args = structuredClone(params.args);
      } catch {
        return {
          content: text("Error: workflow args must be cloneable"),
          details: { action: params.action, inputError: true },
        };
      }
      const background =
        params.execution === "background"
          ? getBackgroundService(pi)
          : undefined;
      let config: WorkflowConfig | undefined;
      const warnings: string[] = [];
      const getConfig = async () => {
        config ??= structuredClone(await loadConfig(cwd, warnings));
        if (warnings.length > 0) {
          ctx.ui?.notify(warnings.join("\n"), "warning");
          warnings.length = 0;
        }
        return config;
      };

      if (params.action === "list") {
        try {
          const currentConfig = await getConfig();
          const inventory = await dependencies.inventory(
            currentConfig.userWorkflowsDir,
          );
          const formatted = formatWorkflowInventory(inventory);
          return {
            content: text(formatted.text),
            details: {
              action: "list",
              inventory: formatted.details,
              truncated: formatted.truncated,
            },
          };
        } catch (error) {
          return {
            content: text(formatError(error)),
            details: { action: "list", validationError: true },
          };
        }
      }

      let parsed: ParsedWorkflow;
      let sourceFile: string | undefined;
      try {
        if (params.script !== undefined) {
          parsed = parseWorkflowScript(params.script);
        } else {
          const currentConfig = await getConfig();
          const saved = await dependencies.resolveSaved(
            currentConfig.userWorkflowsDir,
            params.name!,
          );
          parsed = saved.parsed;
          sourceFile = saved.sourcePath;
        }
      } catch (error) {
        return {
          content: text(formatError(error)),
          details: {
            action: params.action,
            validationError: true,
            ...(sourceFile ? { sourceFile } : {}),
          },
        };
      }

      if (params.action === "validate") {
        return {
          content: text(
            [
              `Workflow ${parsed.meta.name} is valid.`,
              ...(sourceFile ? [`Saved source: ${sourceFile}`] : []),
            ].join("\n"),
          ),
          details: {
            action: "validate",
            meta: parsed.meta,
            ...(sourceFile ? { sourceFile } : {}),
          },
        };
      }

      const currentConfig = await getConfig();
      let scriptFile: string;
      try {
        scriptFile = await dependencies.persistScript(
          parsed.script,
          toolCallId,
          parsed.meta.name,
        );
      } catch (error) {
        return {
          content: text(formatError(error)),
          details: {
            action: "run",
            artifactError: true,
            ...(sourceFile ? { sourceFile } : {}),
          },
        };
      }

      const deadlineMs = Date.now() + currentConfig.workflowTimeoutMs;
      const executeRun = async (
        signal: AbortSignal | undefined,
        update: typeof onUpdate,
        progress?: (snapshot: WorkflowSnapshot) => void,
      ) => {
        const ledger = createWorkflowRunLedger({
          maxTokens: currentConfig.maxTokensPerRun,
          maxAgents: currentConfig.maxAgentsPerRun,
        });
        const agentStates = new Map<number, WorkflowAgentState>();
        let latestSnapshot: WorkflowSnapshot | undefined;
        const emit = (snapshot: WorkflowSnapshot) => {
          latestSnapshot = {
            ...snapshot,
            agents: [...agentStates.values()],
          };
          progress?.(latestSnapshot);
          update?.({
            content: text(`Running workflow ${parsed.meta.name}...`),
            details: {
              action: "run",
              scriptFile,
              ...(sourceFile ? { sourceFile } : {}),
              maxVisibleSettledAgents: currentConfig.maxVisibleSettledAgents,
              snapshot: latestSnapshot,
            },
          });
        };

        const spawnAgent = createWorkflowAgentSpawner({
          cwd,
          signal,
          logId: toolCallId,
          modelRegistry,
          ledger,
          onAgentUpdate: (state) => {
            agentStates.set(state.id, { ...state });
            if (latestSnapshot) emit(latestSnapshot);
          },
        });

        try {
          const result = await runWorkflow(parsed, {
            cwd,
            args,
            signal,
            spawnAgent,
            onUpdate: emit,
            timeoutMs: currentConfig.workflowTimeoutMs,
            deadlineMs,
            agentTimeoutMs: currentConfig.agentTimeoutMs,
            maxConcurrency: currentConfig.maxConcurrency,
            ledger,
          });
          const finalText = formatFinal(result, scriptFile, sourceFile);
          const spilled = await spillIfNeeded(text(finalText), toolCallId);
          return {
            content: spilled.content as { type: "text"; text: string }[],
            details: {
              action: "run",
              meta: result.meta,
              result: result.result,
              accounting: ledger.snapshot(),
              scriptFile,
              ...(sourceFile ? { sourceFile } : {}),
              durationMs: result.durationMs,
              agentFailureCount: result.agentFailureCount,
              loggedBranchFailureCount: result.loggedBranchFailureCount,
              settledBranchFailureCount: result.settledBranchFailureCount,
              maxVisibleSettledAgents: currentConfig.maxVisibleSettledAgents,
              agents: [...agentStates.values()],
              phases: result.phases,
              logs: result.logs,
              ...(latestSnapshot ? { snapshot: latestSnapshot } : {}),
              ...(spilled.spilled
                ? {
                    spilled: true,
                    spillFile: spilled.filePath,
                    originalSize: spilled.originalSize,
                  }
                : {}),
            },
          };
        } catch (error) {
          const runtimeError =
            error instanceof WorkflowRuntimeError ? error : undefined;
          const diagnostic = runtimeError?.diagnostic;
          const finalStates = [...agentStates.values()];
          let recoveryFile: string | undefined;
          let persistenceWarning: string | undefined;
          if (diagnostic && diagnostic.recoveryRecords.length > 0) {
            try {
              const persisted = await dependencies.persistRecovery(
                toolCallId,
                recoveryEnvelope(parsed.meta, diagnostic, finalStates),
              );
              if (persisted.retained) recoveryFile = persisted.path;
              else persistenceWarning = persisted.warning;
            } catch (persistenceError) {
              persistenceWarning =
                `Diagnostic recovery persistence failed: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`.slice(
                  0,
                  500,
                );
            }
          }
          const lines = diagnostic
            ? formatAbnormalWorkflow(
                diagnostic,
                recoveryFile,
                persistenceWarning,
              )
            : [formatError(error)];
          lines.push(
            `Run script: ${scriptFile}`,
            ...(sourceFile ? [`Saved source: ${sourceFile}`] : []),
          );
          return {
            content: text(lines.join("\n")),
            details: {
              action: "run",
              scriptFile,
              ...(sourceFile ? { sourceFile } : {}),
              errorCode:
                runtimeError?.code ??
                (error instanceof Error && error.name === "TimeoutError"
                  ? "workflow_timeout"
                  : error instanceof Error && error.name === "AbortError"
                    ? "workflow_aborted"
                    : "workflow_script_error"),
              accounting: ledger.snapshot(),
              aborted:
                runtimeError?.code === "workflow_aborted" ||
                (signal?.aborted ?? false),
              ...(runtimeError
                ? {
                    errorCode: runtimeError.code,
                    errorMessage: runtimeError.message,
                    counts: runtimeError.diagnostic.counts,
                  }
                : {}),
              ...(recoveryFile ? { recoveryFile } : {}),
              ...(persistenceWarning ? { persistenceWarning } : {}),
              maxVisibleSettledAgents: currentConfig.maxVisibleSettledAgents,
              snapshot: latestSnapshot ?? diagnostic?.snapshot,
            },
          };
        }
      };
      if (!background) return executeRun(signal, onUpdate);
      signal?.throwIfAborted();
      const retained = await prepareWorkflowOutcome();
      signal?.throwIfAborted();
      const execution = background.admit({
        owner: "workflow",
        label: parsed.meta.name.slice(0, 200),
        deadlineMs,
        result: { resultFile: retained.resultFile, scriptFile },
        run: async (abort, report) => {
          const controller = new AbortController();
          const combined = AbortSignal.any([abort, controller.signal]);
          let progressFailed = false;
          let previous = "";
          const publish = (value: ProgressUpdate) => {
            if (progressFailed) return;
            const key = JSON.stringify(value);
            if (key === previous) return;
            try {
              report(value);
              previous = key;
            } catch {
              progressFailed = true;
              controller.abort();
            }
          };
          const reference = { resultFile: retained.resultFile, scriptFile };
          publish({ result: reference });
          const result = await executeRun(combined, undefined, (snapshot) => {
            publish({
              activity: {
                ...(snapshot.activity ?? {
                  started: 0,
                  completed: 0,
                  failed: 0,
                }),
                ...(snapshot.phase
                  ? { phase: snapshot.phase.slice(0, 200) }
                  : {}),
              },
              result: reference,
            });
          });
          const status = progressFailed
            ? "failed"
            : workflowOutcomeStatus(result.details);
          const summary = {
            ...reference,
            status,
            accounting: result.details.accounting,
            ...("errorCode" in result.details
              ? { errorCode: result.details.errorCode }
              : {}),
            ...(progressFailed ? { progressError: true } : {}),
          };
          try {
            await retained.finish({ state: "settled", status, ...result });
          } catch {
            return {
              status: "failed",
              effectsMayPersist: true,
              outcomeUnknown: true,
              result: { ...summary, retentionError: true },
            };
          }
          return {
            status,
            effectsMayPersist: true,
            outcomeUnknown: combined.aborted || progressFailed,
            result: summary,
          };
        },
      });
      return {
        content: text(
          `Workflow admitted as background execution ${execution.id}. One automatic notification follows settlement; inspect with workflow action inspect and this id. Execution completion is not acceptance.`,
        ),
        details: { action: "run", execution },
      };
    },
  });
}
