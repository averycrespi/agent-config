import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  clearPartialTimer,
  countNonEmptyLines,
  displayLabel,
  expandedResult,
  getRelativeLabel,
  getResultText,
  getTruncatedText,
  partialElapsed,
  plural,
  toolSummary,
} from "../_shared/render.ts";

type Kind = "read" | "bash" | "ls" | "find" | "grep";

/** Recognize stock-owned status/error grammar, never preview arbitrary output. */
function failureSummary(kind: Kind, text: string): string {
  const message = text.trim().replace(/^Error:\s*/, "");
  if (kind === "bash") {
    const last = message.split("\n").at(-1) ?? "";
    const exit = /^Command exited with code (-?\d{1,5})$/.exec(last);
    if (exit) return `failed · exit ${exit[1]}`;
    if (/^Command timed out after \d+(?:\.\d+)? seconds$/.test(last))
      return "failed · timed out";
    if (last === "Command aborted") return "failed · aborted";
    if (last === "Command terminated without an exit code")
      return "failed · terminated";
  }
  const codes: Record<string, string> = {
    ENOENT: "not found",
    EACCES: "permission denied",
    EPERM: "permission denied",
    EISDIR: "is a directory",
    ENOTDIR: "not a directory",
  };
  const code = /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR):/.exec(message)?.[1];
  if (code) return `failed · ${codes[code]}`;
  if (message === "Operation aborted") return "failed · aborted";
  if (kind !== "bash") {
    if (message.startsWith("Path not found:")) return "failed · not found";
    if (message.startsWith("Not a directory:"))
      return "failed · not a directory";
    if (message.startsWith("Cannot read directory:"))
      return "failed · directory unreadable";
    if (/^Offset \d+ is beyond end of file \(\d+ lines total\)$/.test(message))
      return "failed · offset out of range";
    if (
      message === "fd is not available and could not be downloaded" ||
      message === "ripgrep (rg) is not available and could not be downloaded"
    )
      return "failed · search unavailable";
  }
  return "failed";
}

/** Display only. The stock tools remain the execution and truncation owners. */
export function builtinRenderers(
  kind: Kind,
): Pick<ToolDefinition, "renderCall" | "renderResult"> {
  const target = (input: unknown, cwd: string) => {
    const args = (input && typeof input === "object" ? input : {}) as Record<
      string,
      unknown
    >;
    return kind === "bash"
      ? "shell"
      : kind === "find" || kind === "grep"
        ? `${displayLabel(args.pattern, 80)} in ${displayLabel(getRelativeLabel(cwd, args.path ?? "."))}`
        : displayLabel(
            getRelativeLabel(
              cwd,
              args.path ?? (kind === "ls" ? "." : undefined),
            ),
          );
  };
  return {
    renderCall(args, theme, context) {
      return getTruncatedText(context.lastComponent, [
        toolSummary(theme, kind, "", "", target(args, context.cwd)),
      ]);
    },
    renderResult(result, { isPartial, expanded }, theme, context) {
      const label = target(context.args ?? {}, context.cwd);
      const elapsed = isPartial ? partialElapsed(context) : "";
      if (!isPartial) clearPartialTimer(context);
      const count = countNonEmptyLines(getResultText(result));
      const details = result.details as any;
      const truncated =
        details?.truncation?.truncated ||
        details?.entryLimitReached ||
        details?.resultLimitReached ||
        details?.matchLimitReached;
      const state = isPartial
        ? `running${elapsed}`
        : context.isError
          ? failureSummary(kind, getResultText(result))
          : kind === "read"
            ? "read"
            : kind === "bash"
              ? "exited successfully"
              : "listed";
      const summary = toolSummary(
        theme,
        kind,
        "",
        `${state}${truncated ? " · truncated" : ""}${!isPartial && !context.isError ? ` · ${plural(count, "output line")}` : ""}`,
        label,
        isPartial ? "warning" : context.isError ? "error" : "success",
      );
      return getTruncatedText(context.lastComponent, [
        summary,
        ...(expanded ? expandedResult(result) : []),
      ]);
    },
  };
}
