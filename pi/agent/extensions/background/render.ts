import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  displayLabel,
  expandedResult,
  formatDuration,
  getTruncatedText,
  plural,
} from "../_shared/render.ts";
import {
  executionCounts,
  executionTokens,
  executionState,
  executionWarnings,
} from "./display.ts";

export function isBackgroundControl(
  tool: string,
  args: { action?: unknown; execution?: unknown },
): boolean {
  return (
    args.execution === "background" ||
    [
      "inspect",
      "cancel",
      "dismiss",
      tool === "subagent" || tool === "subagents" ? "list" : "executions",
    ].includes(String(args.action))
  );
}

/** Adapter-independent projection of retained execution receipts; never fetches artifacts. */
export function renderExecutionResult(
  _tool: string,
  records: unknown,
  result: AgentToolResult<unknown>,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: any,
  failed = false,
) {
  const action = displayLabel(context.args?.action) || "run";
  const list = Array.isArray(records)
    ? records.filter((r) => r && typeof r === "object")
    : [];
  const selected = list[0];
  const bad = failed || context.isError;
  const inventory = action === "list" || action === "executions";
  const [state, stateColor] = executionState(selected?.status);
  let outcome = state;
  let color: ThemeColor = stateColor;
  if (options.isPartial) {
    outcome = "pending";
    color = "muted";
  } else if (bad) {
    outcome = "request failed";
    color = "error";
  } else if (inventory) {
    outcome = plural(list.length, "execution");
    color = "muted";
  } else if (action === "dismiss") {
    outcome = "dismissed";
    color = "muted";
  } else if (
    action === "cancel" &&
    selected?.cancelRequested &&
    selected.status === "running"
  ) {
    outcome = "cancellation requested";
    color = "warning";
  } else if (action === "run") {
    outcome = "admitted";
    color = "muted";
  }

  const warnings = [
    ...new Set(list.flatMap((r) => executionWarnings(r).map(([full]) => full))),
  ];
  const unknown = list.some(
    (r) =>
      r.outcomeUnknown ||
      r.persistenceFailed ||
      r.notification?.handoff === "unknown",
  );
  let line = theme.fg(color, outcome);
  const separator = theme.fg("dim", " · ");
  if (warnings.length)
    line +=
      separator +
      theme.fg(
        "warning",
        `${warnings.join("; ")}${unknown ? "; no replay" : ""}`,
      );
  if (
    action === "inspect" &&
    !bad &&
    !options.isPartial &&
    selected?.status === "success"
  ) {
    const singleChild =
      selected.owner === "subagents" && selected.progress?.total === 1;
    const counts = singleChild ? undefined : executionCounts(selected, theme);
    const tokens = executionTokens(selected);
    const elapsed =
      Number.isFinite(selected.createdAt) && Number.isFinite(selected.endedAt)
        ? formatDuration(Math.max(0, selected.endedAt - selected.createdAt))
        : undefined;
    line += [
      counts,
      tokens ? theme.fg("muted", tokens) : undefined,
      elapsed ? theme.fg("muted", elapsed) : undefined,
    ]
      .filter(Boolean)
      .map((field) => separator + field)
      .join("");
  }
  // Explicit adapter diagnostic only; never infer a failure reason from arbitrary result prose.
  const diagnostic =
    selected?.result?.errorMessage ?? selected?.result?.errorCode;
  if (
    action === "inspect" &&
    selected?.status !== "success" &&
    typeof diagnostic === "string"
  ) {
    const safe = displayLabel(diagnostic, 1000)
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /\b((?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi,
        "$1[redacted]",
      );
    line += theme.fg("muted", ` — ${displayLabel(safe, 200)}`);
  }
  const lines = [line];
  if (options.expanded) {
    for (const r of list)
      lines.push(
        `${displayLabel(r.label)} (${executionState(r.status)[0]}; ${displayLabel(r.id)})`,
      );
    lines.push(...expandedResult(result));
  }
  return getTruncatedText(context.lastComponent, lines);
}
