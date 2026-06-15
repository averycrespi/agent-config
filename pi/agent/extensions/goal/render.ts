import {
  formatDuration,
  formatUsageLine,
  getAutoRunElapsedMs,
  type AutoRunStopReason,
  type Goal,
  type GoalAutoRunState,
  type GoalStatus,
} from "./state.ts";

const WIDGET_SEPARATOR = "─";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type WidgetTheme = typeof plainTheme;

function truncateLine(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function renderStatus(status: GoalStatus, theme: WidgetTheme): string {
  const marker = `[${status}]`;
  switch (status) {
    case "active":
      return theme.fg("accent", theme.bold(marker));
    case "paused":
      return theme.fg("warning", marker);
    case "complete":
      return theme.fg("success", marker);
  }
}

function formatStopReason(reason: AutoRunStopReason): string {
  switch (reason) {
    case "user_stopped":
      return "user stopped";
    case "user_input":
      return "user input";
    case "goal_paused":
      return "goal paused";
    case "goal_cleared":
      return "goal cleared";
    case "goal_complete":
      return "goal complete";
    case "turn_budget":
      return "continuation budget";
    case "time_budget":
      return "time budget";
    case "provider_error":
      return "provider error";
  }
}

function formatAutoRunUsageSuffix(
  goal: Goal,
  options: {
    autoRun?: GoalAutoRunState;
    autoRunEnabled?: boolean;
    autoRunMaxContinuations?: number;
    autoRunMaxActiveMinutes?: number;
  },
): string | undefined {
  if (options.autoRunEnabled === false) return "auto-run disabled (config)";
  if (goal.status === "paused") return "auto-run disabled (goal paused)";
  if (goal.status === "complete") return "auto-run disabled (goal complete)";

  const autoRun = options.autoRun;
  if (!autoRun || autoRun.status === "idle") return "auto-run idle";
  if (autoRun.status === "stopped") {
    return `auto-run disabled (${autoRun.stopReason ? formatStopReason(autoRun.stopReason) : "stopped"})`;
  }

  const maxContinuations = options.autoRunMaxContinuations ?? 0;
  const maxMs = (options.autoRunMaxActiveMinutes ?? 0) * 60_000;
  const elapsedMs = getAutoRunElapsedMs(autoRun);
  const remainingMs = Math.max(0, maxMs - elapsedMs);
  return `auto-run enabled (${autoRun.continuationTurns}/${maxContinuations} continuations, ${formatDuration(remainingMs)} left)`;
}

export function renderGoalWidgetLines(
  goal: Goal | undefined,
  width: number,
  theme: WidgetTheme = plainTheme,
  options: {
    showUsage?: boolean;
    autoRun?: GoalAutoRunState;
    autoRunEnabled?: boolean;
    autoRunMaxContinuations?: number;
    autoRunMaxActiveMinutes?: number;
  } = {},
): string[] {
  if (!goal) return [];
  const safeWidth = Math.max(0, width);
  const lines = [
    truncateLine(
      `${renderStatus(goal.status, theme)} Goal: ${goal.objective}`,
      safeWidth,
    ),
  ];
  if (options.showUsage) {
    const usageLine = formatUsageLine(goal);
    if (usageLine) {
      const autoRunSuffix = formatAutoRunUsageSuffix(goal, options);
      lines.push(
        truncateLine(
          theme.fg(
            "dim",
            autoRunSuffix ? `${usageLine} · ${autoRunSuffix}` : usageLine,
          ),
          safeWidth,
        ),
      );
    }
  }
  lines.push(theme.fg("borderMuted", WIDGET_SEPARATOR.repeat(safeWidth)));
  return lines;
}

export function createGoalWidget(
  goal: Goal,
  options: {
    showUsage?: boolean;
    autoRun?: GoalAutoRunState;
    autoRunEnabled?: boolean;
    autoRunMaxContinuations?: number;
    autoRunMaxActiveMinutes?: number;
  } = {},
) {
  return (_tui: unknown, theme: WidgetTheme) => ({
    render(width: number) {
      return renderGoalWidgetLines(goal, width, theme, options);
    },
    invalidate() {},
  });
}
