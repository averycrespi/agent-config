import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildSpawnAgentsParams,
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
import { loadAgents } from "./loader.ts";
import { getActivity, renderAgentsCall, renderAgentsResult } from "./render.ts";

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

export function validateSpawnAgentSpecs(
  specs: SpawnAgentItem[],
  agentMap: Map<string, AgentDefinition>,
): string[] {
  const errors: string[] = [];
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
  intent: string,
  prompt: string,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate?: OnUpdate,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
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

  const result = await spawnSubagent({
    prompt,
    toolAllowlist: agent.tools,
    extensionAllowlist: agent.extensions,
    model: agent.model ?? modelSelectorFromCtx(ctx),
    thinking: agent.thinking ?? thinkingLevelFromPi(pi),
    systemPrompt: agent.systemPrompt,
    inheritSession: "none",
    parentSessionFile: ctx.sessionManager.getSessionFile(),
    disableSkills: agent.disableSkills,
    disablePromptTemplates: agent.disablePromptTemplates,
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

  return {
    content: text(result.stdout),
    details: {
      exitCode: result.exitCode,
      activity: tracker.state,
    },
  };
}

async function runParallelSpawn(
  pi: ExtensionAPI,
  specs: SpawnAgentItem[],
  agentMap: Map<string, AgentDefinition>,
  ctx: SpawnCtx,
  toolCallId: string,
  onUpdate?: OnUpdate,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}> {
  const validationErrors = validateSpawnAgentSpecs(specs, agentMap);
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
    phase: "starting",
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

  const results = await Promise.all(
    specs.map(async (spec, i) => {
      const agent = agentMap.get(spec.agent);
      if (!agent) {
        states[i].resolved = true;
        emitCombined();
        return {
          content: text(`Error: unknown agent type "${spec.agent}"`),
          details: { exitCode: 1, aborted: false },
        };
      }
      const result = await runSpawn(
        pi,
        agent,
        normalizeIntent(spec.intent),
        spec.prompt,
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
    }),
  );

  const failed = results.filter((r) => {
    const ec = r.details.exitCode;
    return (typeof ec === "number" && ec !== 0) || r.details.aborted === true;
  }).length;

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
      ...spilled.details,
    },
  };
}

// ─── extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const agents = loadAgents();
  const agentMap = new Map(agents.map((a) => [a.name, a]));
  const agentDescription = buildAgentDescription(agents);

  pi.on("before_agent_start", async (event: { systemPrompt: string }) => {
    const agentList = agents
      .map((a) => `${a.name}: ${a.description}`)
      .join("; ");
    const guidance = `\n\n## Subagent delegation\nUse spawn_agents to delegate tasks to focused subagents when a task would generate large output, require iterative searching, or benefit from isolation. Pass all agents you want to run in a single call — they execute in parallel, and a single-agent call is the right shape for delegating one task. Brief each agent thoroughly — subagents have no access to the current conversation. Available agent types: ${agentList}.`;
    return { systemPrompt: event.systemPrompt + guidance };
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
