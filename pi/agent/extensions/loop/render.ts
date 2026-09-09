import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import {
  getLoopActiveElapsedMs,
  sanitizeDisplayText,
  type LoopState,
  type LoopStopReason,
} from "./state.ts";

const plainTheme = {
  fg: (_color: string, text: string) => text,
};

type WidgetTheme = Pick<Theme, "fg">;

function formatMinutes(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 60_000))}m`;
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

function statusLine(
  loop: LoopState,
  width: number,
  theme: WidgetTheme,
  now: number,
  nextContinuationAt?: number,
): string {
  const separator = theme.fg("dim", " · ");
  const prefix = theme.fg("muted", "loop") + " ";
  const muted = (text: string) => theme.fg("muted", text);
  const value = (text: string) => theme.fg("text", text);
  if (loop.status === "yielded") {
    return fitWidgetRow(
      prefix + theme.fg("warning", "yielded"),
      [],
      width,
      separator,
      muted("waiting for user") +
        (loop.detail
          ? separator + muted(sanitizeDisplayText(loop.detail))
          : ""),
    );
  }
  if (loop.status === "stopped") {
    return fitWidgetRow(
      prefix +
        theme.fg(
          loop.stopReason === "provider_error" ? "error" : "muted",
          "stopped",
        ),
      [],
      width,
      separator,
      muted(formatStopReason(loop.stopReason)) +
        (loop.detail
          ? separator + muted(sanitizeDisplayText(loop.detail))
          : ""),
    );
  }
  const fields: string[] = [];
  if (nextContinuationAt !== undefined)
    fields.push(
      muted("next ") + value(formatWidgetCountdown(nextContinuationAt - now)),
    );
  fields.push(
    value(`${loop.continuationCount}/${loop.limits.maxContinuations}`) +
      muted(" continuations"),
    value(
      `${formatMinutes(getLoopActiveElapsedMs(loop, now))}/${loop.limits.maxActiveMinutes}m`,
    ) + muted(" active"),
  );
  if (nextContinuationAt === undefined && loop.delaySeconds > 0)
    fields.push(
      muted("delay ") + value(formatWidgetCountdown(loop.delaySeconds * 1000)),
    );
  return fitWidgetRow(
    prefix +
      theme.fg(
        "accent",
        nextContinuationAt === undefined ? "running" : "waiting",
      ),
    fields,
    width,
    separator,
  );
}

export function renderLoopWidgetLines(
  loop: LoopState | undefined,
  width: number,
  theme: WidgetTheme = plainTheme,
  now: number = Date.now(),
  nextContinuationAt?: number,
): string[] {
  if (!loop) return [];
  return [statusLine(loop, width, theme, now, nextContinuationAt)];
}

export function createLoopWidget(loop: LoopState, nextContinuationAt?: number) {
  return (_tui: unknown, theme: WidgetTheme) => ({
    render(width: number) {
      return renderLoopWidgetLines(
        loop,
        width,
        theme,
        Date.now(),
        nextContinuationAt,
      );
    },
    invalidate() {},
  });
}
