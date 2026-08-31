import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  getLoopActiveElapsedMs,
  sanitizeDisplayText,
  type LoopState,
  type LoopStopReason,
} from "./state.ts";

const SEPARATOR = "─";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type WidgetTheme = typeof plainTheme;

function truncateLine(text: string, width: number): string {
  if (width <= 0) return "";
  return truncateToWidth(text, width);
}

function formatMinutes(ms: number): string {
  return `${Math.max(0, Math.ceil(ms / 60_000))}m`;
}

function formatStopReason(reason: LoopStopReason | undefined): string {
  switch (reason) {
    case "agent_stop":
      return "stopped by agent";
    case "user_stop":
      return "stopped by user";
    case "extension_stop":
      return "stopped by extension";
    case "continuation_limit":
      return "continuation limit reached";
    case "time_limit":
      return "time limit reached";
    case "provider_error":
      return "provider error";
    case "aborted":
      return "aborted";
    case "session_restored":
      return "session restored; resume explicitly";
    default:
      return "stopped";
  }
}

function statusLine(loop: LoopState, theme: WidgetTheme, now: number): string {
  const separator = theme.fg("borderMuted", " · ");
  if (loop.status === "yielded") {
    return `${theme.fg("warning", theme.bold("◆ Loop yielded"))}${separator}${theme.fg("muted", "waiting for user input")}`;
  }
  if (loop.status === "stopped") {
    return `${theme.fg("muted", theme.bold("■ Loop stopped"))}${separator}${theme.fg("muted", formatStopReason(loop.stopReason))}`;
  }

  const elapsed = getLoopActiveElapsedMs(loop, now);
  const continuationUsage = theme.fg(
    "text",
    `${loop.continuationCount}/${loop.limits.maxContinuations}`,
  );
  const activeUsage = theme.fg(
    "text",
    `${formatMinutes(elapsed)}/${loop.limits.maxActiveMinutes}m`,
  );
  const delay =
    loop.delaySeconds > 0
      ? `${separator}${theme.fg("text", `${loop.delaySeconds}s`)}${theme.fg("muted", " delay")}`
      : "";
  return `${theme.fg("accent", theme.bold("● Loop running"))}${separator}${continuationUsage}${theme.fg("muted", " continuations")}${separator}${activeUsage}${theme.fg("muted", " active")}${delay}`;
}

export function renderLoopWidgetLines(
  loop: LoopState | undefined,
  width: number,
  theme: WidgetTheme = plainTheme,
  now: number = Date.now(),
): string[] {
  if (!loop) return [];
  const safeWidth = Math.max(0, width);
  const detail =
    loop.status !== "running" && loop.detail ? loop.detail : loop.message;
  return [
    truncateLine(statusLine(loop, theme, now), safeWidth),
    truncateLine(`↻ ${sanitizeDisplayText(detail)}`, safeWidth),
    theme.fg("borderMuted", SEPARATOR.repeat(safeWidth)),
  ];
}

export function createLoopWidget(loop: LoopState) {
  return (_tui: unknown, theme: WidgetTheme) => ({
    render(width: number) {
      return renderLoopWidgetLines(loop, width, theme);
    },
    invalidate() {},
  });
}
