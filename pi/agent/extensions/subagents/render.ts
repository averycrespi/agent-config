/**
 * TUI rendering for the subagents extension.
 *
 * Pure formatters (`formatTokens`, `statsLine`, `formatRunningLine`,
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
import type { SubagentEvent, SubagentRunState } from "./types.ts";

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

/**
 * Build the per-agent running line. Format:
 *   "Running: 3 tool uses (1m 03s)"  when there are tool uses
 *   "Running... (1m 03s)"            before the first tool use
 *   "Running..."                     when no activity is known yet
 */
export function formatRunningLine(agent: SubagentRunState | undefined): string {
  if (!agent) return "Running...";
  const elapsedSuffix = ` (${formatDuration(Date.now() - agent.startedAt)})`;
  const toolUses = agent.toolUseCount;
  if (toolUses > 0) {
    const label = toolUses === 1 ? "1 tool use" : `${toolUses} tool uses`;
    return `Running: ${label}${elapsedSuffix}`;
  }
  return `Running...${elapsedSuffix}`;
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

export function compactAgentProgressLine(
  agent: SubagentRunState,
  theme: any,
): string {
  const elapsedMs = Math.max(
    0,
    (agent.lastUpdateAt ?? Date.now()) - agent.startedAt,
  );
  const label = `${statusGlyph(agent)} ${compactTypeLabel(agent)} ${agent.intent}`;

  if (agent.phase === "error" || agent.phase === "aborted") {
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

function renderEventLine(
  event: SubagentEvent,
  prefix: string,
  theme: any,
): string {
  if (event.kind === "stderr") {
    return `${prefix}${theme.fg("error", `stderr: ${event.text}`)}`;
  }
  return `${prefix}${theme.fg("muted", event.text)}`;
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

export function agentProgressLine(
  agent: SubagentRunState,
  _isLast: boolean,
  theme: any,
): string {
  const isResolved = agent.resolved === true;
  const typeName = agent.agentType ?? "agent";
  const typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
  const nameLine = `${theme.bold(`${typeLabel} agent`)} ${theme.fg("muted", agent.intent)}`;

  if (isResolved) {
    if (agent.phase === "aborted" || agent.phase === "error") {
      const msg = agent.errorMessage
        ? firstLine(agent.errorMessage)
        : agent.phase === "aborted"
          ? "Error: subagent aborted"
          : "Error: subagent failed";
      const lines = [nameLine, theme.fg("error", msg)];
      if (agent.logFile) {
        lines.push(theme.fg("muted", `Log: ${agent.logFile}`));
      }
      return lines.join("\n");
    }
    const doneInfo = statsLine(
      agent.toolUseCount,
      agent.totalTokens,
      Math.max(0, agent.lastUpdateAt - agent.startedAt),
    );
    const doneLine = doneInfo ? `Done: ${doneInfo}` : "Done";
    return `${nameLine}\n${theme.fg("muted", doneLine)}`;
  }

  const events = agent.recentEvents ?? [];
  const lastEvent = events[events.length - 1];
  if (lastEvent) {
    const runningLine = formatRunningLine(agent);
    return [
      nameLine,
      renderEventLine(lastEvent, "- ", theme),
      theme.fg("muted", runningLine),
    ].join("\n");
  }
  const elapsed = ` (${formatDuration(Date.now() - agent.startedAt)})`;
  return `${nameLine}\n${theme.fg("muted", `Initializing...${elapsed}`)}`;
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
    const lines: string[] = [];
    for (let i = 0; i < agents.length; i++) {
      lines.push(agentProgressLine(agents[i], i === agents.length - 1, theme));
    }
    t.setText(lines.join("\n\n"));
    return t;
  }

  clearPartialTimer(context);

  const agents = d.agents ?? [];

  const lines: string[] = [];
  for (let i = 0; i < agents.length; i++) {
    lines.push(agentProgressLine(agents[i], i === agents.length - 1, theme));
  }
  t.setText("\n" + lines.join("\n\n"));
  return t;
}
