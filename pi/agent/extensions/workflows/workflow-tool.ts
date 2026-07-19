import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import {
  persistRetainedJson,
  type RetainedArtifactResult,
} from "../_shared/retained-artifacts.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import { stringEnum } from "../_shared/schema.ts";
import { loadWorkflowConfig, type WorkflowConfig } from "./config.ts";
import {
  loadAgents as loadAgentDefinitions,
  type AgentDefinition,
} from "../subagents/api.ts";
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

const workflowParamsSchema = Type.Object(
  {
    action: stringEnum(["run", "list", "validate"] as const, {
      description: "Action to perform.",
    }),
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

function modelSelectorFromCtx(ctx: {
  model?: { provider?: string; id?: string };
}) {
  if (!ctx.model?.provider || !ctx.model.id) return undefined;
  return `${ctx.model.provider}/${ctx.model.id}`;
}

function thinkingLevelFromPi(pi: ExtensionAPI): string | undefined {
  try {
    const level = pi.getThinkingLevel();
    return level && level !== "off" ? level : undefined;
  } catch {
    return undefined;
  }
}

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
      agent: state?.agent ?? record.agent,
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
    schemaVersion: 1,
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
  loadAgents: typeof loadAgentDefinitions;
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
    loadAgents: loadAgentDefinitions,
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
    description: `List, validate, or run deterministic foreground JavaScript workflows that orchestrate isolated read-mostly subagents.

Use action \"list\" for current reusable definitions, action \"validate\" with exactly one of script/name without execution, or action \"run\" with exactly one of script/name and optional args.
Scripts must start with literal metadata: export const meta = { name: \"...\", description: \"...\" }.
Use the globals agent(prompt, { agent?, intent?, output?, model?, retries?, timeoutMs? }), verify(claim, { agent?, intent?, context?, model?, retries?, timeoutMs? }), report(value, { gate: () => verdict }), budget, parallel(thunks), parallelSettled(thunks), pipeline(items, ...stages), phase(name), log(message), args, and cwd.
Concurrency is bounded by configuration. Model may only be the configured \"small\" or \"big\" alias. The immutable budget mirror is advisory; host-side run and token caps are authoritative.
Do not use imports, require, filesystem/network/timer APIs, Date.now, new Date, or Math.random.`,
    promptSnippet:
      "List, validate, or run a deterministic foreground JavaScript workflow.",
    promptGuidelines: [
      "Call workflow with action list when a reusable saved workflow may apply.",
      "Use workflow for deterministic fan-out/fan-in research, review, or audit work where several isolated subagents can run under one script.",
      "Do not use workflow for parallel workspace mutation; Phase 1 permits only read-mostly agent types.",
      "Write scripts with `export const meta = { name, description }` as the first statement and `export async function run() { ... }` for the main body.",
      "Pass thunks to parallel() or parallelSettled(), e.g. `parallel(items.map((item) => () => agent(...)))`, so concurrency remains bounded.",
      "Use parallelSettled() when workflow code needs structured per-branch failure records instead of null branch results.",
      "Use `agent(prompt, { output: { schema } })` when workflow fan-in needs machine-readable subagent results instead of Markdown text.",
      "Use `verify(claim, { agent?, intent?, context?, model?, retries?, timeoutMs? })`; it resolves { ok, reasons }. Gate a report with `report(value, { gate: () => verdict })`, where the callable gate returns true or an object with `ok: true` to pass.",
      "Treat `budget` as an advisory snapshot only. `workflow_run_cap_exceeded` denies later calls, while `workflow_budget_exceeded` aborts active agents and prevents retries or new spawns.",
      'Set `model: "small"` or `model: "big"` only when that fixed alias is configured; arbitrary model selectors are rejected host-side.',
      "Use small bounded `retries` values only for read-only subagent calls that can safely be repeated.",
      "Use `timeoutMs` on an agent call when one slow branch should fail without exhausting the whole workflow timeout.",
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

      let config: WorkflowConfig | undefined;
      const warnings: string[] = [];
      const getConfig = async () => {
        config ??= await loadConfig(ctx.cwd, warnings);
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

      const agents = dependencies.loadAgents();
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
        onUpdate?.({
          content: text(`Running workflow ${parsed.meta.name}...`),
          details: {
            action: "run",
            scriptFile,
            ...(sourceFile ? { sourceFile } : {}),
            snapshot: latestSnapshot,
          },
        });
      };

      const spawnAgent = createWorkflowAgentSpawner({
        cwd: ctx.cwd,
        signal,
        logId: toolCallId,
        agents: agents as AgentDefinition[],
        model: modelSelectorFromCtx(ctx),
        modelTiers: {
          small: currentConfig.modelTierSmall,
          big: currentConfig.modelTierBig,
        },
        thinking: thinkingLevelFromPi(pi),
        ledger,
        onAgentUpdate: (state) => {
          agentStates.set(state.id, { ...state });
          if (latestSnapshot) emit(latestSnapshot);
        },
      });

      try {
        const result = await runWorkflow(parsed, {
          cwd: ctx.cwd,
          args: params.args,
          signal,
          spawnAgent,
          onUpdate: emit,
          timeoutMs: currentConfig.workflowTimeoutMs,
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
            scriptFile,
            ...(sourceFile ? { sourceFile } : {}),
            durationMs: result.durationMs,
            agentFailureCount: result.agentFailureCount,
            loggedBranchFailureCount: result.loggedBranchFailureCount,
            settledBranchFailureCount: result.settledBranchFailureCount,
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
          ? formatAbnormalWorkflow(diagnostic, recoveryFile, persistenceWarning)
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
            snapshot: latestSnapshot ?? diagnostic?.snapshot,
          },
        };
      }
    },
  });
}
