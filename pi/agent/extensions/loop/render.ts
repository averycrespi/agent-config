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
  if (loop.status === "yielded") {
    return theme.fg("warning", "Loop yielded · waiting for user input");
  }
  if (loop.status === "stopped") {
    return theme.fg(
      "muted",
      `Loop stopped · ${formatStopReason(loop.stopReason)}`,
    );
  }
  const elapsed = getLoopActiveElapsedMs(loop, now);
  return theme.fg(
    "accent",
    theme.bold(
      `Loop running · ${loop.continuationCount}/${loop.limits.maxContinuations} continuations · ${formatMinutes(elapsed)}/${loop.limits.maxActiveMinutes}m${loop.delaySeconds > 0 ? ` · ${loop.delaySeconds}s delay` : ""}`,
    ),
  );
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
