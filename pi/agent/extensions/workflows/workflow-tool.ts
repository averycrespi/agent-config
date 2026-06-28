import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { spillIfNeeded } from "../_shared/spillover.ts";
import { loadAgents, type AgentDefinition } from "../subagents/api.ts";
import { parseWorkflowScript } from "./parser.ts";
import { createWorkflowAgentSpawner, runWorkflow } from "./runtime.ts";
import type { WorkflowAgentState, WorkflowSnapshot } from "./types.ts";
import { renderWorkflowCall, renderWorkflowResult } from "./display.ts";

const workflowParamsSchema = Type.Object({
  script: Type.String({
    description:
      "Raw JavaScript workflow script. Must start with `export const meta = { name, description }` and call agent() at least once.",
  }),
  args: Type.Optional(
    Type.Any({
      description: "Optional JSON value exposed to the script as args.",
    }),
  ),
});

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

function formatFinal(result: Awaited<ReturnType<typeof runWorkflow>>): string {
  const body =
    typeof result.result === "string"
      ? result.result
      : JSON.stringify(result.result, null, 2);
  return [
    `Workflow ${result.meta.name} completed in ${(result.durationMs / 1000).toFixed(1)}s.`,
    `Failures: ${result.failureCount}`,
    "",
    body ?? "null",
  ].join("\n");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `Error: ${error.message}`;
  return `Error: ${String(error)}`;
}

export function registerWorkflowTool(pi: ExtensionAPI): void {
  const agents = loadAgents();

  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description: `Execute a deterministic foreground JavaScript workflow that orchestrates isolated read-mostly subagents.

Scripts must start with literal metadata: export const meta = { name: "...", description: "..." }.
Use the globals agent(prompt, { agent?, intent?, output? }), parallel(thunks), pipeline(items, ...stages), phase(name), log(message), args, and cwd.
Do not use imports, require, filesystem/network/timer APIs, Date.now, new Date, or Math.random.`,
    promptSnippet:
      "Run a deterministic foreground JavaScript workflow that fans out isolated read-mostly subagents.",
    promptGuidelines: [
      "Use workflow for deterministic fan-out/fan-in research, review, or audit work where several isolated subagents can run under one script.",
      "Do not use workflow for parallel workspace mutation; Phase 1 permits only read-mostly agent types.",
      "Write scripts with `export const meta = { name, description }` as the first statement and `export async function run() { ... }` for the main body.",
      "Pass thunks to parallel(), e.g. `parallel(items.map((item) => () => agent(...)))`, so concurrency remains bounded.",
      "Use `agent(prompt, { output: { schema } })` when workflow fan-in needs machine-readable subagent results instead of Markdown text.",
    ],
    parameters: workflowParamsSchema,
    renderCall: renderWorkflowCall,
    renderResult: renderWorkflowResult,

    async execute(toolCallId, params: WorkflowParams, signal, onUpdate, ctx) {
      let parsed;
      try {
        parsed = parseWorkflowScript(params.script);
      } catch (error) {
        return {
          content: text(formatError(error)),
          details: { validationError: true },
        };
      }

      const agentStates = new Map<number, WorkflowAgentState>();
      let latestSnapshot: WorkflowSnapshot | undefined;
      const emit = (snapshot: WorkflowSnapshot) => {
        latestSnapshot = {
          ...snapshot,
          agents: [...agentStates.values()],
        };
        onUpdate?.({
          content: text(`Running workflow ${parsed.meta.name}...`),
          details: { snapshot: latestSnapshot },
        });
      };

      const spawnAgent = createWorkflowAgentSpawner({
        cwd: ctx.cwd,
        signal,
        logId: toolCallId,
        agents: agents as AgentDefinition[],
        model: modelSelectorFromCtx(ctx),
        thinking: thinkingLevelFromPi(pi),
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
        });
        const finalText = formatFinal(result);
        const spilled = await spillIfNeeded(text(finalText), toolCallId);
        return {
          content: spilled.content as { type: "text"; text: string }[],
          details: {
            meta: result.meta,
            durationMs: result.durationMs,
            failureCount: result.failureCount,
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
        return {
          content: text(formatError(error)),
          details: {
            aborted: signal?.aborted ?? false,
            snapshot: latestSnapshot,
          },
        };
      }
    },
  });
}
