/**
 * TUI rendering for the subagents extension.
 *
 * Pure formatters (`formatTokens`, `statsLine`, `agentProgressLine`,
 * `getActivity`) are unit-tested in `render.test.ts`. The render
 * functions themselves return pi-tui `Text` components and are exercised
 * indirectly via the extension's tool registrations in `index.ts`.
 */

import { Text } from "@earendil-works/pi-tui";
import {
  clearPartialTimer,
  firstLine,
  formatDuration,
  startPartialTimer,
} from "../_shared/render.ts";
import type { SubagentRunState } from "./types.ts";

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
  if (totalTokens > 0) {
    parts.push(`${formatTokens(totalTokens)} tokens`);
  }
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

function compactTypeLabel(agent: SubagentRunState): string {
  return agent.agentType ?? "agent";
}

function compactRecentActivity(agent: SubagentRunState): string | undefined {
  const lastEvent = agent.recentEvents?.[agent.recentEvents.length - 1];
  if (lastEvent?.text) {
    return lastEvent.kind === "stderr"
      ? `stderr: ${lastEvent.text}`
      : lastEvent.text;
  }
  if (agent.currentCommand) return agent.currentCommand;
  if (agent.lastCommand) return agent.lastCommand;
  if (
    agent.phase &&
    !["starting", "done", "error", "aborted"].includes(agent.phase)
  ) {
    return agent.phase;
  }
  return undefined;
}

function isFailed(agent: SubagentRunState): boolean {
  return agent.phase === "error" || agent.phase === "aborted";
}

function isDone(agent: SubagentRunState): boolean {
  return agent.resolved === true || agent.phase === "done" || isFailed(agent);
}

function agentsHeader(
  agents: SubagentRunState[],
  total: number | undefined,
  failed: number | undefined,
  theme: any,
  final: boolean,
): string {
  const done = agents.filter(isDone).length;
  const failureCount =
    failed ??
    agents.filter((agent) => isFailed(agent) || agent.errorMessage).length;
  const running = Math.max(0, (total ?? agents.length) - done);
  const start = agents.reduce<number | undefined>((min, agent) => {
    return min === undefined ? agent.startedAt : Math.min(min, agent.startedAt);
  }, undefined);
  const end = final
    ? agents.reduce<number | undefined>((max, agent) => {
        return max === undefined
          ? agent.lastUpdateAt
          : Math.max(max, agent.lastUpdateAt);
      }, undefined)
    : Date.now();
  const elapsed =
    start === undefined || end === undefined
      ? undefined
      : formatDuration(Math.max(0, end - start));
  const parts = [
    `${done} done`,
    `${running} running`,
    `${failureCount} failed`,
  ];
  if (elapsed) parts.push(elapsed);
  return `${theme.bold("Spawn agents")} · ${theme.fg("muted", parts.join(" · "))}`;
}

export function agentProgressLine(agent: SubagentRunState, theme: any): string {
  const elapsedMs = Math.max(
    0,
    (agent.lastUpdateAt ?? Date.now()) - agent.startedAt,
  );
  const label = `${statusGlyph(agent)} ${compactTypeLabel(agent)}: ${agent.intent}`;

  if (isFailed(agent)) {
    const msg = agent.errorMessage
      ? firstLine(agent.errorMessage)
      : agent.phase === "aborted"
        ? "Error: subagent aborted"
        : "Error: subagent failed";
    const log = agent.logFile ? ` · Log: ${agent.logFile}` : "";
    const stats = formatDuration(elapsedMs);
    return `${label} · ${theme.fg("muted", stats)} · ${theme.fg("error", `${msg}${log}`)}`;
  }

  if (agent.resolved === true || agent.phase === "done") {
    return `${label} · ${theme.fg("muted", statsLine(agent.toolUseCount, agent.totalTokens, elapsedMs))}`;
  }

  const activity = compactRecentActivity(agent) ?? "initializing";
  const stats = statsLine(
    agent.toolUseCount,
    agent.totalTokens,
    Date.now() - agent.startedAt,
  );
  return `${label} · ${theme.fg("muted", stats)} · ${theme.fg("muted", activity)}`;
}

// The call line would just repeat the intents already shown in renderAgentsResult's
// per-agent blocks, so suppress it. Pi still gets a (blank) call component so the
// usual component lifecycle is preserved.
export function renderAgentsCall(
  _args: { agents?: unknown[] },
  _theme: any,
  context: any,
) {
  const t = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  t.setText("");
  return t;
}

export function renderAgentsResult(
  result: { content: { type: string; text?: string }[]; details?: unknown },
  options: { isPartial: boolean },
  theme: any,
  context: any,
) {
  const t = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  const d = (result.details ?? {}) as {
    agents?: SubagentRunState[];
    total?: number;
    failed?: number;
  };

  if (options.isPartial) {
    startPartialTimer(context);
    const agents = d.agents ?? [];
    const lines = [
      agentsHeader(agents, d.total, d.failed, theme, false),
      "",
      ...agents.map((agent) => agentProgressLine(agent, theme)),
    ];
    t.setText(lines.join("\n"));
    return t;
  }

  clearPartialTimer(context);

  const agents = d.agents ?? [];

  const lines = [
    agentsHeader(agents, d.total, d.failed, theme, true),
    "",
    ...agents.map((agent) => agentProgressLine(agent, theme)),
  ];
  t.setText(lines.join("\n"));
  return t;
}
