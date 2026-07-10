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

function buildGitSummarySegment(
  summary: GitSummary,
  theme: FooterTheme,
): string {
  const parts = [theme.fg("accent", summary.ref)];
  const tracking = `${summary.behind ? `↓${summary.behind}` : ""}${
    summary.ahead ? `↑${summary.ahead}` : ""
  }`;
  if (tracking) parts.push(theme.fg("muted", tracking));
  if (summary.conflicts) parts.push(theme.fg("error", `✖${summary.conflicts}`));
  if (summary.staged) parts.push(theme.fg("warning", `●${summary.staged}`));
  if (summary.changed) parts.push(theme.fg("warning", `✚${summary.changed}`));
  if (summary.untracked)
    parts.push(theme.fg("warning", `…${summary.untracked}`));
  if (summary.stashes) parts.push(theme.fg("muted", `⚑${summary.stashes}`));
  if (parts.length === 1) parts.push(theme.fg("success", "✔"));
  return parts.join(" ");
}

function buildCwdSegment(state: FooterState, theme: FooterTheme): string {
  const cwd = collapseHome(state.cwd, state.homeDir);
  if (state.gitSummary)
    return `${cwd} [${buildGitSummarySegment(state.gitSummary, theme)}]`;
  return state.gitBranch
    ? `${cwd} [${theme.fg("accent", state.gitBranch)}]`
    : cwd;
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

function colorizePercent(percent: number, theme: FooterTheme): string {
  const text = `${Math.round(percent)}%`;
  if (percent > 90) return theme.fg("error", text);
  if (percent > 70) return theme.fg("warning", text);
  return text;
}

function buildUsageSegment(
  usage: FooterState["usage"],
  theme: FooterTheme,
): string | undefined {
  if (!usage) return undefined;

  const { label, stats } = usage;
  const labelText = theme.fg("muted", label);
  if (stats.balance !== undefined) {
    const reset = stats.primary?.resetAfterSeconds;
    return reset === undefined
      ? `${labelText} $${stats.balance}`
      : `${labelText} $${stats.balance} ${theme.fg("muted", formatDuration(reset))}`;
  }

  if (stats.limitReached) {
    const reset = stats.primary?.resetAfterSeconds;
    return reset === undefined
      ? `${labelText} limit`
      : `${labelText} limit ${theme.fg("muted", formatDuration(reset))}`;
  }

  const primaryPercent = stats.primary?.usedPercent;
  const secondaryPercent = stats.secondary?.usedPercent;
  const primaryReset = stats.primary?.resetAfterSeconds;

  if (primaryPercent === undefined && secondaryPercent === undefined) {
    return labelText;
  }

  let percentText = "";
  if (primaryPercent !== undefined && secondaryPercent !== undefined) {
    percentText = `${colorizePercent(primaryPercent, theme)} (${colorizePercent(secondaryPercent, theme)})`;
  } else if (primaryPercent !== undefined) {
    percentText = colorizePercent(primaryPercent, theme);
  } else if (secondaryPercent !== undefined) {
    percentText = colorizePercent(secondaryPercent, theme);
  }

  const resetText =
    primaryReset === undefined
      ? ""
      : ` ${theme.fg("muted", formatDuration(primaryReset))}`;

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

  const labelText = theme.fg("muted", "ctx");
  const windowText = theme.fg(
    "muted",
    `/${formatTokens(contextUsage.contextWindow)}`,
  );
  return `${labelText} ${percentText}${windowText}`;
}

function buildThinkingSegment(
  state: FooterState,
  theme: FooterTheme,
): string | undefined {
  if (!state.thinking) return undefined;

  const color = {
    off: "thinkingOff",
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXhigh",
  }[state.thinking];

  return color ? theme.fg(color, state.thinking) : state.thinking;
}

function buildStatusSegments(state: FooterState, theme: FooterTheme): string[] {
  return [
    buildUsageSegment(state.usage, theme),
    buildContextSegment(state.contextUsage, theme),
    state.modelId ? theme.fg("muted", state.modelId) : undefined,
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
  const left = buildCwdSegment(state, theme);
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
    buildCwdSegment(state, theme),
    ...buildStatusSegments(state, theme),
  ];
  return joinFittingSegments(segments, width, separator);
}
