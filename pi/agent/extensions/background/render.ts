import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  displayLabel,
  expandedResult,
  getTruncatedText,
  plural,
  toolSummary,
  type RenderLine,
} from "../_shared/render.ts";

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
      tool === "subagents" ? "list" : "executions",
    ].includes(String(args.action))
  );
}

/** Adapter-independent projection of retained execution receipts; never calls the service. */
export function renderExecutionResult(
  tool: string,
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
  const unknown = list.some(
    (r) =>
      r.outcomeUnknown ||
      r.persistenceFailed ||
      r.notification?.handoff === "unknown",
  );
  const possible = list.some((r) => r.effectsMayPersist);
  const bad = failed || context.isError;
  const state =
    selected &&
    [
      "running",
      "success",
      "failed",
      "cancelled",
      "timeout",
      "interrupted",
    ].includes(selected.status)
      ? selected.status
      : "status unavailable";
  const inventory = action === "list" || action === "executions";
  const outcome = options.isPartial
    ? "pending"
    : unknown
      ? bad
        ? "failed; unknown; no replay"
        : "effects unknown; no replay"
      : bad
        ? "request failed"
        : inventory
          ? plural(list.length, "execution")
          : action === "dismiss"
            ? "attention dismissed; evidence retained"
            : action === "cancel"
              ? selected?.cancelRequested && state === "running"
                ? "cancellation requested"
                : `retained ${state}`
              : action === "run"
                ? `admitted · ${state}`
                : state;
  const caution =
    unknown || possible || state === "interrupted" || state === "timeout";
  const lines: RenderLine[] = [
    toolSummary(
      theme,
      tool,
      action,
      outcome + (possible && !unknown ? " · effects may persist" : ""),
      inventory ? "" : (selected?.label ?? context.args?.description),
      options.isPartial
        ? "warning"
        : bad
          ? "error"
          : caution
            ? "warning"
            : state === "failed"
              ? "error"
              : "muted",
    ),
  ];
  if (options.expanded) {
    for (const r of list)
      lines.push(
        `${displayLabel(r.label)} · ${displayLabel(r.status)} · ${displayLabel(r.id)}`,
      );
    lines.push(...expandedResult(result));
  }
  return getTruncatedText(context.lastComponent, lines);
}
