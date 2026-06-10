import { formatUsageLine, type Goal, type GoalStatus } from "./state.ts";

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

export function renderGoalWidgetLines(
  goal: Goal | undefined,
  width: number,
  theme: WidgetTheme = plainTheme,
  options: { showUsage?: boolean } = {},
): string[] {
  if (!goal) return [];
  const safeWidth = Math.max(0, width);
  const lines = [
    truncateLine(
      `Goal ${renderStatus(goal.status, theme)} ${goal.objective}`,
      safeWidth,
    ),
  ];
  if (options.showUsage) {
    const usageLine = formatUsageLine(goal);
    if (usageLine)
      lines.push(truncateLine(theme.fg("dim", usageLine), safeWidth));
  }
  if (goal.status === "complete" && goal.completionEvidence) {
    lines.push(
      truncateLine(
        theme.fg("dim", `Evidence: ${goal.completionEvidence}`),
        safeWidth,
      ),
    );
  }
  lines.push(theme.fg("borderMuted", WIDGET_SEPARATOR.repeat(safeWidth)));
  return lines;
}

export function createGoalWidget(
  goal: Goal,
  options: { showUsage?: boolean } = {},
) {
  return (_tui: unknown, theme: WidgetTheme) => ({
    render(width: number) {
      return renderGoalWidgetLines(goal, width, theme, options);
    },
    invalidate() {},
  });
}
