import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve } from "node:path";

// Pi tool boxes apply background after child rendering; full resets inside
// child lines clear that background before the box's final background reset.
const SGR_FULL_RESET = /\x1b\[0m/g;
const SGR_BG_SAFE_RESET = "\x1b[22;23;24;25;27;28;29;39m";
const TAB_REPLACEMENT = "   ";

/**
 * Partial-state renderers only show elapsed time once they've been
 * running at least this long. Avoids flashing "(0s)" on fast calls.
 */
export const ELAPSED_THRESHOLD_MS = 2000;

/**
 * Success summaries that inline the first line of output should only
 * do so when the line fits within this many characters. Fall back to
 * "N lines" otherwise.
 */
export const FIRST_LINE_INLINE_MAX = 80;

/** First non-empty line of `text`, or an empty string. */
export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/** Extract the plain-text portion of a tool result, ignoring image content. */
export function getResultText(result: AgentToolResult<unknown>): string {
  const textContent = result.content.find((c) => c.type === "text");
  return textContent?.type === "text" ? textContent.text : "";
}

/**
 * Convert an incoming path argument into a short, cwd-relative display
 * label. Falls back to the absolute path when the target escapes cwd,
 * or `"file"` when nothing usable was provided (streaming partial args).
 */
export function getRelativeLabel(cwd: string, path: unknown): string {
  if (typeof path !== "string" || path.length === 0) return "file";
  const normalized = path.startsWith("@") ? path.slice(1) : path;
  const absolutePath = resolve(cwd, normalized);
  const relativePath = relative(cwd, absolutePath);
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  ) {
    return relativePath;
  }
  if (relativePath === "") return ".";
  return absolutePath;
}

/** Count the non-empty lines in `text`. */
export function countNonEmptyLines(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length > 0) n += 1;
  }
  return n;
}

/** English pluralization for compact labels (e.g. "1 reference", "3 references"). */
export function plural(
  count: number,
  singular: string,
  pluralForm?: string,
): string {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${pluralForm ?? singular + "s"}`;
}

/**
 * Collapse a possibly multi-line command into a single-line label.
 * Appends a trailing `...` marker when later lines were dropped.
 */
export function singleLineCommand(command: unknown): string {
  if (typeof command !== "string" || command.length === 0) return "";
  const newlineIndex = command.indexOf("\n");
  if (newlineIndex === -1) return command;
  return `${command.slice(0, newlineIndex).trimEnd()} ...`;
}

/**
 * Take the first N non-empty lines of `text`. Useful for showing a
 * short head snippet of a tool result (first few lines of a list,
 * first few log entries, etc.).
 */
export function headNonEmptyLines(text: string, count: number): string[] {
  const result: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    result.push(line);
    if (result.length >= count) break;
  }
  return result;
}

/**
 * Take the last N non-empty lines of `text`. Useful for showing the
 * tail of streamed output (command output, build logs, etc.).
 */
export function tailNonEmptyLines(text: string, count: number): string[] {
  const lines = text.split("\n");
  const result: string[] = [];
  for (let i = lines.length - 1; i >= 0 && result.length < count; i--) {
    const line = lines[i];
    if (line && line.trim().length > 0) {
      result.unshift(line);
    }
  }
  return result;
}

/**
 * Format a duration in milliseconds as a compact human-readable label.
 * Under a minute: `"5s"`. One minute or more: `"1m 03s"` (zero-padded
 * seconds).
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${totalSeconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/**
 * Minimal renderer-context shape used by the partial-state timer
 * helpers. The real `renderResult` context is wider; we deliberately
 * narrow to just the fields these helpers touch so subagents and
 * single-line renderers can share them.
 */
interface PartialTimerContext {
  state: Record<string, unknown>;
  invalidate: () => void;
}

/**
 * Start a 1s redraw ticker on the context if one isn't already
 * running. Use this directly when you need the ticker but are
 * rendering elapsed time yourself (e.g. inside a multi-line
 * structured progress view). Prefer `partialElapsed` for the
 * standard single-line case.
 */
export function startPartialTimer(context: PartialTimerContext): void {
  if (!context.state.renderTimer) {
    context.state.renderTimer = setInterval(() => context.invalidate(), 1000);
  }
}

/**
 * Clear a previously-started partial timer. Safe to call when no
 * timer is running. Always call this in the error and success
 * branches of `renderResult` so the ticker doesn't leak after the
 * tool finishes.
 */
export function clearPartialTimer(context: PartialTimerContext): void {
  const handle = context.state.renderTimer;
  if (handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  }
  context.state.renderTimer = undefined;
}

/**
 * Standard in-progress elapsed-time suffix. Records `state.startedAt`
 * on first call, starts the redraw ticker, and returns
 * `" (1m 03s)"` once elapsed >= `ELAPSED_THRESHOLD_MS`. Returns an
 * empty string before the threshold so fast calls don't flash a
 * "(0s)" counter.
 *
 * Typical usage:
 *
 *     renderResult(result, { isPartial }, theme, context) {
 *       if (isPartial) {
 *         return new Text(
 *           theme.fg("warning", `Running ${cmd}...${partialElapsed(context)}`),
 *           0, 0,
 *         );
 *       }
 *       clearPartialTimer(context);
 *       // ...error / success branches
 *     }
 */
export function partialElapsed(context: PartialTimerContext): string {
  const state = context.state;
  if (typeof state.startedAt !== "number") {
    state.startedAt = Date.now();
  }
  startPartialTimer(context);
  const elapsedMs = Date.now() - (state.startedAt as number);
  if (elapsedMs < ELAPSED_THRESHOLD_MS) return "";
  return ` (${formatDuration(elapsedMs)})`;
}

/**
 * Width-aware text component for compact tool renderers that must stay
 * on the same logical lines regardless of terminal width. Each stored
 * line is independently truncated at render time instead of wrapped.
 */
export class TruncatedText implements Component {
  private lines: string[];
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(lines: string[] = []) {
    this.lines = lines;
  }

  setLines(lines: string[]): void {
    this.lines = lines;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const safeWidth = Math.max(0, width);
    const rendered = this.lines.map((line) =>
      truncateToWidth(
        line.replaceAll("\t", TAB_REPLACEMENT),
        safeWidth,
      ).replace(SGR_FULL_RESET, SGR_BG_SAFE_RESET),
    );
    this.cachedWidth = width;
    this.cachedLines = rendered;
    return rendered;
  }
}

/**
 * Reuse a prior compact renderer component when possible, updating its
 * logical lines so truncation recomputes against the current width.
 */
export function getTruncatedText(
  lastComponent: unknown,
  lines: string[],
): TruncatedText {
  const text =
    lastComponent instanceof TruncatedText
      ? lastComponent
      : new TruncatedText();
  text.setLines(lines);
  return text;
}
