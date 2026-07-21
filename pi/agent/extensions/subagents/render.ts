import {
  clearPartialTimer,
  firstLine,
  formatDuration,
  getTruncatedText,
  startPartialTimer,
} from "../_shared/render.ts";
import type { SubagentRunState } from "./types.ts";

const CONTROL_SEQUENCES =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)?|.)|[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g;

function safe(value: string | undefined, max = 240): string {
  const compact = (value ?? "")
    .replace(CONTROL_SEQUENCES, "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function getActivity(details: unknown): SubagentRunState | undefined {
  if (!details || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  const activity = record.activity;
  if (activity && typeof activity === "object") {
    return activity as SubagentRunState;
  }
  if (
    typeof record.intent === "string" &&
    typeof record.phase === "string" &&
    typeof record.startedAt === "number" &&
    typeof record.lastUpdateAt === "number"
  ) {
    return record as unknown as SubagentRunState;
  }
  return undefined;
}

export function statsLine(
  toolUseCount: number,
  totalTokens: number,
  durationMs: number,
): string {
  const parts: string[] = [];
  if (toolUseCount > 0) {
    parts.push(`${toolUseCount} tool ${toolUseCount === 1 ? "use" : "uses"}`);
  }
  if (totalTokens > 0) parts.push(`${formatTokens(totalTokens)} tokens`);
  parts.push(formatDuration(durationMs));
  return parts.join(" · ");
}

function statusGlyph(agent: SubagentRunState): string {
  if (agent.phase === "error") return "✗";
  if (agent.phase === "aborted") return "!";
  if (agent.resolved === true || agent.phase === "done") return "✓";
  if (agent.phase === "thinking") return "…";
  return "●";
}

function compactRecentActivity(agent: SubagentRunState): string | undefined {
  const lastEvent = agent.recentEvents?.[agent.recentEvents.length - 1];
  if (lastEvent?.kind === "stderr") return "stderr output";
  if (lastEvent?.kind === "tool") return safe(lastEvent.text, 80);
  if (agent.activeTool) return safe(agent.activeTool, 80);
  if (
    agent.phase &&
    !["starting", "done", "error", "aborted"].includes(agent.phase)
  ) {
    return safe(agent.phase, 80);
  }
  return undefined;
}

function isFailed(agent: SubagentRunState): boolean {
  return agent.phase === "error" || agent.phase === "aborted";
}

function isDone(agent: SubagentRunState): boolean {
  return agent.resolved === true || agent.phase === "done" || isFailed(agent);
}

function policyLabel(agent: SubagentRunState): string {
  const capabilities = agent.capabilities?.join(",") || "none";
  return `${capabilities} · ${agent.modelTier ?? "?"}/${agent.thinking ?? "?"}`;
}

function agentsHeader(
  agents: SubagentRunState[],
  total: number | undefined,
  failed: number | undefined,
  theme: any,
  final: boolean,
): string {
  const settled = agents.filter(isDone).length;
  const failureCount =
    failed ??
    agents.filter((agent) => isFailed(agent) || agent.errorMessage).length;
  const running = Math.max(0, (total ?? agents.length) - settled);
  const done = Math.max(0, settled - failureCount);
  const start = agents.reduce<number | undefined>(
    (min, agent) =>
      min === undefined ? agent.startedAt : Math.min(min, agent.startedAt),
    undefined,
  );
  const end = final
    ? agents.reduce<number | undefined>(
        (max, agent) =>
          max === undefined
            ? agent.lastUpdateAt
            : Math.max(max, agent.lastUpdateAt),
        undefined,
      )
    : Date.now();
  const elapsed =
    start === undefined || end === undefined
      ? undefined
      : formatDuration(Math.max(0, end - start));
  const parts = final
    ? [`${done} done`, `${failureCount} failed`]
    : [`${done} done`, `${running} running`, `${failureCount} failed`];
  if (elapsed) parts.push(elapsed);
  const title = theme.fg("toolTitle", theme.bold("spawn_agents"));
  const status = final
    ? `${theme.fg(failureCount > 0 ? "error" : "success", failureCount > 0 ? "✗" : "✓")} `
    : "";
  return `${status}${title} · ${theme.fg("muted", parts.join(" · "))}`;
}

export function agentProgressLine(agent: SubagentRunState, theme: any): string {
  const elapsedMs = Math.max(
    0,
    (agent.lastUpdateAt ?? Date.now()) - agent.startedAt,
  );
  const label = `${statusGlyph(agent)} ${safe(agent.intent, 160)}`;
  const policy = theme.fg("muted", policyLabel(agent));

  if (isFailed(agent)) {
    const msg = safe(
      agent.errorMessage
        ? firstLine(agent.errorMessage)
        : agent.phase === "aborted"
          ? "Error: subagent aborted"
          : "Error: subagent failed",
      180,
    );
    return `${label} · ${policy} · ${theme.fg("muted", formatDuration(elapsedMs))} · ${theme.fg("error", msg)}`;
  }

  if (agent.resolved === true || agent.phase === "done") {
    return `${label} · ${policy} · ${theme.fg("muted", statsLine(agent.toolUseCount, agent.totalTokens, elapsedMs))}`;
  }

  const activity = compactRecentActivity(agent) ?? "initializing";
  const stats = statsLine(
    agent.toolUseCount,
    agent.totalTokens,
    Date.now() - agent.startedAt,
  );
  return `${label} · ${policy} · ${theme.fg("muted", stats)} · ${theme.fg("muted", activity)}`;
}

export function renderAgentsCall(
  _args: { agents?: unknown[] },
  _theme: any,
  context: any,
) {
  return getTruncatedText(context.lastComponent, []);
}

export function renderAgentsResult(
  result: { content: { type: string; text?: string }[]; details?: unknown },
  options: { isPartial: boolean; expanded?: boolean },
  theme: any,
  context: any,
) {
  const details = (result.details ?? {}) as {
    agents?: SubagentRunState[];
    total?: number;
    failed?: number;
  };
  const agents = details.agents ?? [];

  if (options.isPartial) startPartialTimer(context);
  else clearPartialTimer(context);

  const lines = [
    agentsHeader(
      agents,
      details.total,
      details.failed,
      theme,
      !options.isPartial,
    ),
  ];
  if (options.expanded) {
    lines.push("", ...agents.map((agent) => agentProgressLine(agent, theme)));
    for (const agent of agents) {
      if (agent.logFile)
        lines.push(theme.fg("muted", `Log: ${safe(agent.logFile, 240)}`));
      if (agent.errorMessage && !isFailed(agent)) {
        lines.push(theme.fg("error", safe(agent.errorMessage, 240)));
      }
    }
  }
  return getTruncatedText(context.lastComponent, lines);
}
