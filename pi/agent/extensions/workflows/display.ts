import { Text } from "@earendil-works/pi-tui";
import {
  clearPartialTimer,
  formatDuration,
  getResultText,
  getTruncatedText,
  partialElapsed,
} from "../_shared/render.ts";
import type { WorkflowSnapshot } from "./types.ts";

export function formatWorkflowResult(details: unknown, text: string): string {
  const info = details as
    | {
        meta?: { name?: string };
        durationMs?: number;
        failureCount?: number;
        spilled?: boolean;
      }
    | undefined;
  const name = info?.meta?.name ? ` ${info.meta.name}` : "";
  const failures = info?.failureCount
    ? `, ${info.failureCount} failure${info.failureCount === 1 ? "" : "s"}`
    : "";
  const duration =
    typeof info?.durationMs === "number"
      ? ` in ${formatDuration(info.durationMs)}`
      : "";
  const first = text.trim().split("\n").find(Boolean);
  return `✓ workflow${name}${duration}${failures}${first ? ` — ${first.slice(0, 80)}` : ""}`;
}

export function renderSnapshot(snapshot: WorkflowSnapshot): string[] {
  const elapsed = formatDuration(
    (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt,
  );
  const name = snapshot.meta?.name ?? "workflow";
  const running = snapshot.agents.filter((a) => a.status === "running").length;
  const done = snapshot.agents.filter((a) => a.status === "done").length;
  const errored = snapshot.agents.filter(
    (a) => a.status === "error" || a.status === "aborted",
  ).length;
  const lines = [
    `Running workflow ${name}${snapshot.phase ? ` (${snapshot.phase})` : ""} — ${elapsed}`,
  ];
  if (snapshot.agents.length > 0)
    lines.push(`Agents: ${done} done, ${running} running, ${errored} failed`);
  for (const log of snapshot.logs.slice(-2))
    lines.push(`${log.level}: ${log.message}`);
  return lines;
}

export function renderWorkflowCall(params: unknown, _theme: any, context: any) {
  const script = (params as { script?: unknown } | undefined)?.script;
  const firstLine =
    typeof script === "string" ? script.trim().split("\n")[0] : "script";
  return getTruncatedText(context.lastComponent, [`workflow ${firstLine}`]);
}

export function renderWorkflowResult(
  result: any,
  { isPartial }: { isPartial?: boolean },
  theme: any,
  context: any,
) {
  if (isPartial) {
    const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
    const lines = snapshot
      ? renderSnapshot(snapshot)
      : [`Running workflow...${partialElapsed(context)}`];
    return getTruncatedText(context.lastComponent, lines);
  }
  clearPartialTimer(context);
  const text = getResultText(result);
  if (text.startsWith("Error:"))
    return new Text(theme.fg("error", text.split("\n")[0]), 0, 0);
  return getTruncatedText(context.lastComponent, [
    formatWorkflowResult(result.details, text),
  ]);
}
