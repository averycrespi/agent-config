import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitSummary } from "./git.ts";
import { formatDuration, type UsageStats } from "./utils.ts";

export type FooterTheme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

export type FooterState = {
  cwd: string;
  homeDir?: string;
  usage?: {
    label: string;
    stats: UsageStats;
  };
  contextUsage?: {
    percent: number | null;
    contextWindow: number | null;
  } | null;
  modelId?: string;
  thinking?: string;
  gitBranch?: string;
  gitSummary?: GitSummary;
};

function collapseHome(cwd: string, homeDir?: string): string {
  if (homeDir && cwd.startsWith(homeDir)) {
    return `~${cwd.slice(homeDir.length)}`;
  }
  return cwd;
}

function buildGitSummarySegment(summary: GitSummary): string {
  const parts = [summary.ref];
  const tracking = `${summary.behind ? `↓${summary.behind}` : ""}${
    summary.ahead ? `↑${summary.ahead}` : ""
  }`;
  if (tracking) parts.push(tracking);
  if (summary.conflicts) parts.push(`✖${summary.conflicts}`);
  if (summary.staged) parts.push(`●${summary.staged}`);
  if (summary.changed) parts.push(`✚${summary.changed}`);
  if (summary.untracked) parts.push(`…${summary.untracked}`);
  if (summary.stashes) parts.push(`⚑${summary.stashes}`);
  if (parts.length === 1) parts.push("✔");
  return parts.join(" ");
}

function buildCwdSegment(state: FooterState): string {
  const cwd = collapseHome(state.cwd, state.homeDir);
  if (state.gitSummary)
    return `${cwd} [${buildGitSummarySegment(state.gitSummary)}]`;
  return state.gitBranch ? `${cwd} [${state.gitBranch}]` : cwd;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(millions >= 10 ? 0 : 1)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(value);
}

function dim(text: string, theme: FooterTheme): string {
  return theme.fg("dim", text);
}

function colorizePercent(percent: number, theme: FooterTheme): string {
  const text = `${Math.round(percent)}%`;
  if (percent > 90) return theme.fg("error", text);
  if (percent > 70) return theme.fg("warning", text);
  return dim(text, theme);
}

function buildUsageSegment(
  usage: FooterState["usage"],
  theme: FooterTheme,
): string | undefined {
  if (!usage) return undefined;

  const { label, stats } = usage;
  const labelText = dim(label, theme);
  if (stats.balance !== undefined) {
    const reset = stats.primary?.resetAfterSeconds;
    return reset === undefined
      ? `${labelText} $${stats.balance}`
      : `${labelText} $${stats.balance} ${dim(formatDuration(reset), theme)}`;
  }

  if (stats.limitReached) {
    const reset = stats.primary?.resetAfterSeconds;
    return reset === undefined
      ? `${labelText} limit`
      : `${labelText} limit ${dim(formatDuration(reset), theme)}`;
  }

  const primaryPercent = stats.primary?.usedPercent;
  const secondaryPercent = stats.secondary?.usedPercent;
  const primaryReset = stats.primary?.resetAfterSeconds;

  if (primaryPercent === undefined && secondaryPercent === undefined) {
    return labelText;
  }

  let percentText = "";
  if (primaryPercent !== undefined && secondaryPercent !== undefined) {
    percentText = `${colorizePercent(primaryPercent, theme)}${dim(
      " (",
      theme,
    )}${colorizePercent(secondaryPercent, theme)}${dim(")", theme)}`;
  } else if (primaryPercent !== undefined) {
    percentText = colorizePercent(primaryPercent, theme);
  } else if (secondaryPercent !== undefined) {
    percentText = colorizePercent(secondaryPercent, theme);
  }

  const resetText =
    primaryReset === undefined
      ? ""
      : ` ${dim(formatDuration(primaryReset), theme)}`;

  return `${labelText} ${percentText}${resetText}`;
}

function buildContextSegment(
  contextUsage: FooterState["contextUsage"],
  theme: FooterTheme,
): string | undefined {
  if (!contextUsage?.contextWindow) return undefined;

  const percent = contextUsage.percent;
  const percentText =
    percent === null || percent === undefined
      ? "?%"
      : colorizePercent(percent, theme);

  return `${dim("ctx", theme)} ${percentText}${dim(
    `/${formatTokens(contextUsage.contextWindow)}`,
    theme,
  )}`;
}

function buildThinkingSegment(
  state: FooterState,
  theme: FooterTheme,
): string | undefined {
  if (!state.thinking) return undefined;
  return dim(state.thinking, theme);
}

function buildStatusSegments(state: FooterState, theme: FooterTheme): string[] {
  return [
    buildUsageSegment(state.usage, theme),
    buildContextSegment(state.contextUsage, theme),
    state.modelId ? dim(state.modelId, theme) : undefined,
    buildThinkingSegment(state, theme),
  ].filter((segment): segment is string => Boolean(segment));
}

function joinFittingSegments(
  segments: string[],
  width: number,
  separator: string,
): string {
  let line = "";
  for (const segment of segments) {
    const candidate = line ? `${line}${separator}${segment}` : segment;
    if (visibleWidth(candidate) <= width) {
      line = candidate;
      continue;
    }

    if (!line) return truncateToWidth(segment, width);
    break;
  }

  return line;
}

export function renderFooterLines(
  state: FooterState,
  width: number,
  theme: FooterTheme,
): string[] {
  if (width <= 0) return [""];

  const separator = theme.fg("dim", " · ");
  const left = buildCwdSegment(state);
  const right = joinFittingSegments(
    buildStatusSegments(state, theme),
    width,
    separator,
  );
  if (!right) return [left];

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + 1 + rightWidth <= width) {
    return [`${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`];
  }

  return [left, right];
}

export function renderFooterLine(
  state: FooterState,
  width: number,
  theme: FooterTheme,
): string {
  if (width <= 0) return "";

  const separator = theme.fg("dim", " · ");
  const segments = [
    buildCwdSegment(state),
    ...buildStatusSegments(state, theme),
  ];
  return joinFittingSegments(segments, width, separator);
}
