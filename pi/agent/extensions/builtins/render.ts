import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  clearPartialTimer,
  countNonEmptyLines,
  displayLabel,
  expandedResult,
  getRelativeLabel,
  getResultText,
  getTruncatedText,
  headNonEmptyLines,
  partialElapsed,
  plural,
  singleLineCommand,
  tailNonEmptyLines,
} from "../_shared/render.ts";

type Kind = "read" | "bash" | "ls" | "find" | "grep";

function failureSummary(kind: Kind, text: string): string {
  const message = text.trim().replace(/^Error:\s*/, "");
  if (kind === "bash") {
    const last = message.split("\n").at(-1) ?? "";
    const exit = /^Command exited with code (-?\d{1,5})$/.exec(last);
    if (exit) return `Failed: exit ${exit[1]}`;
    if (/^Command timed out after \d+(?:\.\d+)? seconds$/.test(last))
      return "Failed: timed out";
    if (last === "Command aborted") return "Failed: aborted";
    if (last === "Command terminated without an exit code")
      return "Failed: terminated";
  }
  const code = /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR):/.exec(message)?.[1];
  if (code) {
    const labels: Record<string, string> = {
      ENOENT: "not found",
      EACCES: "permission denied",
      EPERM: "permission denied",
      EISDIR: "is a directory",
      ENOTDIR: "not a directory",
    };
    return `Failed: ${labels[code]}`;
  }
  if (message === "Operation aborted") return "Failed: aborted";
  if (kind !== "bash") {
    if (message.startsWith("Path not found:")) return "Failed: not found";
    if (message.startsWith("Not a directory:"))
      return "Failed: not a directory";
    if (message.startsWith("Cannot read directory:"))
      return "Failed: directory unreadable";
    if (/^Offset \d+ is beyond end of file \(\d+ lines total\)$/.test(message))
      return "Failed: offset out of range";
  }
  return "Failed";
}

// Preserve the older compact previews without styling terminal controls or
// displaying recognizable credential literals from a command or tool output.
function safeLabel(value: unknown, limit = 200): string {
  return displayLabel(
    displayLabel(value, 4096)
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /\b((?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi,
        "$1[redacted]",
      )
      .replace(
        /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|mgw_agent_[A-Za-z0-9_]{8,})\b/g,
        "[redacted]",
      ),
    limit,
  );
}

/** Display only. The stock tools remain the execution and truncation owners. */
export function builtinRenderers(
  kind: Kind,
): Pick<ToolDefinition, "renderCall" | "renderResult"> {
  return {
    renderCall(args, theme, context) {
      const input = args as Record<string, unknown>;
      const path = safeLabel(getRelativeLabel(context.cwd, input.path ?? "."));
      const pattern = safeLabel(input.pattern, 80);
      const command = safeLabel(singleLineCommand(input.command));
      const line =
        kind === "bash"
          ? `${theme.fg("toolTitle", theme.bold(kind))} ${theme.fg("accent", command)}`
          : kind === "find" || kind === "grep"
            ? `${theme.fg("toolTitle", theme.bold(kind))} ${theme.fg("accent", kind === "grep" ? `/${pattern}/` : pattern)} ${theme.fg("muted", `in ${path}`)}${kind === "grep" && input.glob ? theme.fg("muted", ` (${safeLabel(input.glob, 80)})`) : ""}`
            : `${theme.fg("toolTitle", theme.bold(kind))} ${theme.fg("accent", kind === "read" ? safeLabel(getRelativeLabel(context.cwd, input.path)) : path)}`;
      return getTruncatedText(context.lastComponent, [line]);
    },
    renderResult(result, { isPartial, expanded }, theme, context) {
      const input = (context.args ?? {}) as Record<string, unknown>;
      const path = safeLabel(getRelativeLabel(context.cwd, input.path ?? "."));
      const pattern = safeLabel(input.pattern, 80);
      const command = safeLabel(singleLineCommand(input.command));
      if (isPartial) {
        const progress =
          kind === "read"
            ? `Reading ${safeLabel(getRelativeLabel(context.cwd, input.path))}...`
            : kind === "bash"
              ? `Running ${command}...`
              : kind === "ls"
                ? `Listing ${path}...`
                : kind === "find"
                  ? `Finding ${pattern}...`
                  : `Searching /${pattern}/...`;
        return getTruncatedText(context.lastComponent, [
          theme.fg("warning", `${progress}${partialElapsed(context)}`),
        ]);
      }
      clearPartialTimer(context);

      const text = getResultText(result);
      if (kind === "bash") {
        const lines = context.isError
          ? [headNonEmptyLines(text, 1)[0] || `bash failed: ${command}`]
          : tailNonEmptyLines(text, 3);
        return getTruncatedText(
          context.lastComponent,
          lines.map((line) =>
            theme.fg(context.isError ? "error" : "muted", safeLabel(line)),
          ),
        );
      }
      const details = result.details as any;
      const limited =
        details?.truncation?.truncated ||
        details?.entryLimitReached ||
        details?.resultLimitReached ||
        details?.matchLimitReached;
      const notices = limited
        ? [theme.fg("warning", "Output truncated; expand for details.")]
        : [];
      if (expanded) {
        return getTruncatedText(context.lastComponent, [
          ...(context.isError
            ? [theme.fg("error", failureSummary(kind, text))]
            : []),
          ...expandedResult(result).map((line) =>
            theme.fg("text", safeLabel(line, 1000)),
          ),
          ...(limited
            ? [theme.fg("warning", "Output truncated by the tool.")]
            : []),
          ...(typeof details?.fullOutputPath === "string"
            ? [
                theme.fg(
                  "muted",
                  `Full output: ${safeLabel(details.fullOutputPath, 1000)}`,
                ),
              ]
            : []),
        ]);
      }
      if (context.isError) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", failureSummary(kind, text)),
          ...notices,
        ]);
      }
      if (kind === "read")
        return getTruncatedText(context.lastComponent, notices);
      if (kind === "grep") {
        const count =
          text.trim() === "No matches found" ? 0 : countNonEmptyLines(text);
        return getTruncatedText(context.lastComponent, [
          theme.fg(
            "muted",
            count ? plural(count, "match", "matches") : "no matches",
          ),
          ...notices,
        ]);
      }
      const head = headNonEmptyLines(text, 3);
      if (head.length === 0)
        return getTruncatedText(context.lastComponent, [
          theme.fg("muted", kind === "ls" ? "empty" : "no matches"),
          ...notices,
        ]);
      const extra = countNonEmptyLines(text) - head.length;
      const lines =
        extra > 0
          ? [
              ...head,
              `... +${plural(extra, kind === "ls" ? "more entry" : "more result", kind === "ls" ? "more entries" : undefined)}`,
            ]
          : head;
      return getTruncatedText(context.lastComponent, [
        ...lines.map((line) => theme.fg("muted", safeLabel(line))),
        ...notices,
      ]);
    },
  };
}
