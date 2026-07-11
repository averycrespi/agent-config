import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import {
  buildSpawnAgentsParams,
  DEFAULT_MAX_CONCURRENCY,
  MAX_AGENTS_PER_CALL,
  THINKING_LEVELS,
  type AgentDefinition,
  type SpawnAgentItem,
  type SpawnAgentsParams,
  type SubagentRunState,
} from "./types.ts";
import {
  createSubagentActivityTracker,
  type SubagentActivityTracker,
} from "./activity.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import { formatSpawnFailure, spawnSubagent } from "./spawn.ts";

export const _spawnSubagent = { fn: spawnSubagent };
import { loadAgents } from "./loader.ts";
import { getActivity, renderAgentsCall, renderAgentsResult } from "./render.ts";
import {
  loadSubagentsConfig,
  registerSubagentsConfigCommand,
} from "./config.ts";
import { createConcurrencyGate, type ConcurrencyGate } from "./pool.ts";
import { validateOutputSchema } from "./schema.ts";

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

export function normalizeIntent(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) throw new Error("intent is required");
  return trimmed;
}

export function buildAgentDescription(agents: AgentDefinition[]): string {
  if (agents.length === 0) {
    return "Agent type. No agents are currently loaded — check that agent markdown files exist in ~/.pi/agent/agents/.";
  }
  const list = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  return `Agent type. Choose based on the task:\n\n${list}`;
}

export function buildDelegationGuidance(agents: AgentDefinition[]): string {
  const agentList =
    agents.length > 0
      ? agents.map((a) => `${a.name}: ${a.description}`).join("; ")
      : "none loaded";
  return `\n\n## Subagent delegation
Use spawn_agents proactively for read-mostly work that would otherwise expand the main context, require iterative searching, or benefit from an isolated second opinion.

Delegate when:
- localizing unfamiliar code, tracing control/data flow, or reading more than a few files
- checking external docs, remote metadata, issues, PRs, releases, or web sources
- reviewing a plan, diff, branch, PR, or design against explicit criteria
- distilling noisy logs, traces, metrics, query results, or large command output
- splitting independent questions that can run concurrently

Do not delegate when:
- the task requires editing files or coordinating overlapping workspace changes
- a deterministic command, test, typecheck, lint, or focused search would answer faster
- the subagent would need unstated conversation context or user-owned decisions
- the work is tightly sequential or delegation would mostly duplicate effort

Pass all independent agents in one spawn_agents call — they execute in parallel. A single-agent call is correct for one isolated task. Brief each agent like a colleague who just arrived: include the goal, paths/artifacts, criteria, constraints, and expected output. Available agent types: ${agentList}.`;
}

export async function validateSpawnAgentSpecs(
  specs: SpawnAgentItem[],
  agentMap: Map<string, AgentDefinition>,
  cwd: string,
): Promise<string[]> {
  const errors: string[] = [];
  if (specs.length > MAX_AGENTS_PER_CALL) {
    errors.push(
      `agents must contain at most ${MAX_AGENTS_PER_CALL} agents (received ${specs.length})`,
    );
  }
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec.intent.trim()) {
      errors.push(`agents[${i}].intent is required`);
    }
    if (!agentMap.has(spec.agent)) {
      errors.push(
        `agents[${i}].agent "${spec.agent}" is not a known agent type`,
      );
    }
    if (
      spec.thinking !== undefined &&
      !(THINKING_LEVELS as readonly string[]).includes(spec.thinking)
    ) {
      errors.push(
        `agents[${i}].thinking must be one of: ${THINKING_LEVELS.join(", ")}`,
      );
    }
    for (let j = 0; j < (spec.files?.length ?? 0); j += 1) {
      const file = spec.files![j]!;
      if (!file.trim()) {
        errors.push(`agents[${i}].files[${j}] must be non-empty`);
        continue;
      }
      const absolutePath = resolve(cwd, file);
      try {
        const metadata = await stat(absolutePath);
        if (!metadata.isFile()) {
          errors.push(`agents[${i}].files[${j}] must name a regular file`);
          continue;
        }
        await access(absolutePath, constants.R_OK);
      } catch {
        errors.push(
          `agents[${i}].files[${j}] must name a readable regular file`,
        );
      }
    }
    if (spec.output_schema !== undefined) {
      errors.push(
        ...validateOutputSchema(
          spec.output_schema,
          `agents[${i}].output_schema`,
        ),
      );
    }
  }
  return errors;
}

// ─── execution ────────────────────────────────────────────────────────────────

type SpawnCtx = {
  cwd: string;
  signal?: AbortSignal;
  model?: { provider?: string; id?: string };
  sessionManager: { getSessionFile(): string | undefined };
  hasUI: boolean;
  ui: {
    setStatus(widgetId: string, text: string | undefined): void;
    setWidget(widgetId: string, widget: string[] | undefined): void;
  };
};

type OnUpdate = (event: {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}) => void;

export async function spillSubagentOutput(
  content: { type: "text"; text: string }[],
  toolCallId: string,
  dir?: string,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const spilled = await spillIfNeeded(content, toolCallId, dir);
  return {
    content: spilled.content as { type: "text"; text: string }[],
    details: spilled.spilled
      ? {
          outputSpilled: true,
          spillFile: spilled.filePath,
          originalSize: spilled.originalSize,
        }
      : {},
  };
}

async function runSpawn(
  pi: ExtensionAPI,
  agent: AgentDefinition,
  spec: SpawnAgentItem,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate?: OnUpdate,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const intent = normalizeIntent(spec.intent);
  const tracker: SubagentActivityTracker = createSubagentActivityTracker({
    toolCallId,
    roleLabel:
      agent.name.charAt(0).toUpperCase() + agent.name.slice(1) + " agent",
    intent,
    showActivity: true,
    hasUI: ctx.hasUI,
    ui: ctx.hasUI
      ? {
          setStatus: (id, value) => ctx.ui.setStatus(id, value),
          setWidget: (id, value) => ctx.ui.setWidget(id, value),
        }
      : undefined,
    onUpdate,
  });

  const result = await _spawnSubagent.fn({
    prompt: spec.prompt,
    toolAllowlist: agent.tools,
    extensionAllowlist: agent.extensions,
    files: spec.files,
    model: agent.model ?? modelSelectorFromCtx(ctx),
    thinking: spec.thinking ?? agent.thinking ?? thinkingLevelFromPi(pi),
    systemPrompt: agent.systemPrompt,
    inheritSession: "none",
    parentSessionFile: ctx.sessionManager.getSessionFile(),
    disableSkills: agent.disableSkills,
    disablePromptTemplates: agent.disablePromptTemplates,
    output:
      spec.output_schema !== undefined
        ? { schema: spec.output_schema }
        : undefined,
    logId: toolCallId,
    cwd: ctx.cwd,
    env: agent.env,
    signal: ctx.signal,
    onEvent: (event) => tracker.handleEvent(event),
  });

  tracker.finish(result);

  if (!result.ok) {
    return {
      content: text(formatSpawnFailure(result)),
      details: {
        ok: false,
        structuredError: result.errorMessage ?? formatSpawnFailure(result),
        aborted: result.aborted,
        exitCode: result.exitCode,
        signal: result.signal,
        stderr: result.stderr,
        stdout: result.stdout,
        logFile: result.logFile,
        activity: tracker.state,
      },
    };
  }

  if (spec.output_schema !== undefined && result.structured?.ok) {
    return {
      content: text(
        `\`\`\`json\n${JSON.stringify(result.structured.value, null, 2)}\n\`\`\``,
      ),
      details: {
        ok: true,
        exitCode: result.exitCode,
        structuredValue: result.structured.value,
        activity: tracker.state,
      },
    };
  }

  return {
    content: text(result.stdout),
    details: {
      ok: true,
      exitCode: result.exitCode,
      activity: tracker.state,
    },
  };
}

export async function runParallelSpawn(
  pi: ExtensionAPI,
  specs: SpawnAgentItem[],
  agentMap: Map<string, AgentDefinition>,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate: OnUpdate | undefined,
  gate: ConcurrencyGate,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const validationErrors = await validateSpawnAgentSpecs(
    specs,
    agentMap,
    ctx.cwd,
  );
  if (validationErrors.length > 0) {
    return {
      content: text(
        `Error: invalid spawn_agents request\n${validationErrors.join("\n")}`,
      ),
      details: { validationError: true, errors: validationErrors },
    };
  }

  const states: SubagentRunState[] = specs.map((s) => ({
    intent: s.intent,
    agentType: s.agent,
    phase: "queued",
    recentEvents: [],
    toolUseCount: 0,
    totalTokens: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  }));

  function emitCombined(): void {
    onUpdate?.({
      content: [{ type: "text", text: `Running ${specs.length} agents...` }],
      details: { agents: [...states], total: specs.length },
    });
  }

  emitCombined();

  function cancelledBeforeLaunch(i: number) {
    const errorMessage = "Subagent cancelled before launch";
    states[i] = {
      ...states[i],
      phase: "aborted",
      resolved: true,
      errorMessage,
      lastUpdateAt: Date.now(),
    };
    emitCombined();
    return {
      content: text(`Error: ${errorMessage}`),
      details: {
        ok: false,
        exitCode: null,
        aborted: true,
        structuredError: errorMessage,
      },
    };
  }

  const results = await Promise.all(
    specs.map(async (spec, i) => {
      const release = await gate.acquire(ctx.signal);
      if (!release) return cancelledBeforeLaunch(i);

      try {
        if (ctx.signal?.aborted) return cancelledBeforeLaunch(i);
        const agent = agentMap.get(spec.agent);
        if (!agent) {
          states[i].resolved = true;
          emitCombined();
          return {
            content: text(`Error: unknown agent type "${spec.agent}"`),
            details: {
              ok: false,
              exitCode: 1,
              aborted: false,
              structuredError: `Unknown agent type: ${spec.agent}`,
            },
          };
        }
        const result = await runSpawn(
          pi,
          agent,
          spec,
          ctx,
          `${toolCallId}:${i}`,
          (event) => {
            const activity = getActivity(event.details);
            if (activity) {
              activity.agentType = spec.agent;
              states[i] = activity;
            }
            emitCombined();
          },
        );
        const finalActivity = getActivity(result.details);
        if (finalActivity) {
          finalActivity.agentType = spec.agent;
          states[i] = finalActivity;
        }
        states[i].resolved = true;
        const errorText = result.content[0]?.text;
        if (errorText?.startsWith("Error:")) {
          states[i].errorMessage = errorText;
        }
        if (typeof result.details.logFile === "string") {
          states[i].logFile = result.details.logFile;
        }
        emitCombined();
        return result;
      } finally {
        release();
      }
    }),
  );

  const failed = results.filter((result) => result.details.ok === false).length;

  const structured = specs.some((spec) => spec.output_schema !== undefined)
    ? results.map((result, index) => {
        if (specs[index]!.output_schema === undefined) {
          return { requested: false } as const;
        }
        if (result.details.ok === true && "structuredValue" in result.details) {
          return {
            requested: true,
            ok: true,
            value: result.details.structuredValue,
          } as const;
        }
        const error =
          typeof result.details.structuredError === "string"
            ? result.details.structuredError
            : (result.content[0]?.text ?? "Structured subagent failed");
        return { requested: true, ok: false, error } as const;
      })
    : undefined;

  const parts = results.map((r, i) => {
    const header = `## ${specs[i].agent} · ${specs[i].intent}`;
    const body = r.content[0]?.text ?? "";
    return `${header}\n\n${body}`;
  });

  const spilled = await spillSubagentOutput(
    text(parts.join("\n\n---\n\n")),
    toolCallId,
  );

  return {
    content: spilled.content,
    details: {
      agents: states,
      total: specs.length,
      failed,
      allOk: failed === 0,
      ...(structured ? { structured } : {}),
      ...spilled.details,
    },
  };
}

// ─── extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const agents = loadAgents();
  const agentMap = new Map(agents.map((a) => [a.name, a]));
  const agentDescription = buildAgentDescription(agents);
  const directGate = createConcurrencyGate(DEFAULT_MAX_CONCURRENCY);

  registerSubagentsConfigCommand(pi);

  pi.on("before_agent_start", async (event: { systemPrompt: string }) => {
    return {
      systemPrompt: event.systemPrompt + buildDelegationGuidance(agents),
    };
  });

  pi.registerTool({
    name: "spawn_agents",
    label: "Spawn Agents",
    description:
      "Launch multiple subagents in parallel. Each runs independently in its own context window. Results are returned as a combined document once all complete. Use when tasks are independent and can run concurrently.",
    parameters: buildSpawnAgentsParams(agentDescription),
    async execute(
      toolCallId,
      params: SpawnAgentsParams,
      signal,
      onUpdate,
      ctx,
    ) {
      const warnings: string[] = [];
      const config = await loadSubagentsConfig(ctx.cwd, warnings);
      directGate.setLimit(config.maxConcurrency);
      if (ctx.hasUI) {
        for (const warning of warnings) ctx.ui.notify(warning, "warning");
      }
      return await runParallelSpawn(
        pi,
        params.agents,
        agentMap,
        {
          cwd: ctx.cwd,
          signal,
          model: ctx.model as any,
          sessionManager: ctx.sessionManager,
          hasUI: ctx.hasUI,
          ui: ctx.ui,
        },
        toolCallId,
        onUpdate,
        directGate,
      );
    },
    renderCall(args, theme, context) {
      return renderAgentsCall(args as { agents?: unknown[] }, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderAgentsResult(result, options, theme, context);
    },
  });
}
