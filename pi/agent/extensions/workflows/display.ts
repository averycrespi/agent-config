import { Text } from "@earendil-works/pi-tui";
import {
  clearPartialTimer,
  formatDuration,
  getResultText,
  getTruncatedText,
  startPartialTimer,
} from "../_shared/render.ts";
import { agentProgressLine } from "../subagents/render.ts";
import type { WorkflowAgentState, WorkflowSnapshot } from "./types.ts";

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

function countAgents(snapshot: WorkflowSnapshot): {
  running: number;
  done: number;
  failed: number;
} {
  return {
    running: snapshot.agents.filter((a) => a.status === "running").length,
    done: snapshot.agents.filter((a) => a.status === "done").length,
    failed: snapshot.agents.filter(
      (a) => a.status === "error" || a.status === "aborted",
    ).length,
  };
}

function workflowHeader(
  snapshot: WorkflowSnapshot,
  options: { final?: boolean } = {},
): string {
  const elapsed = formatDuration(
    (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt,
  );
  const name = snapshot.meta?.name ?? "workflow";
  const { running, done, failed } = countAgents(snapshot);
  const counts =
    snapshot.agents.length > 0
      ? options.final
        ? ` · ${done} done · ${failed} failed`
        : ` · ${done} done · ${running} running · ${failed} failed`
      : "";
  if (options.final) {
    const status = failed > 0 ? "failed" : "✓";
    return `Workflow ${name} ${status} · ${elapsed}${counts}`;
  }
  const phase = snapshot.phase ? ` · ${snapshot.phase}` : "";
  return `Workflow ${name}${phase}${counts} · ${elapsed}`;
}

function fallbackAgentLine(agent: WorkflowAgentState, theme: any): string {
  const typeLabel = agent.agent.charAt(0).toUpperCase() + agent.agent.slice(1);
  const nameLine = `${theme.bold(`${typeLabel} agent`)} ${theme.fg("muted", agent.intent)}`;
  if (agent.status === "running")
    return `${nameLine}\n${theme.fg("muted", "Initializing...")}`;
  if (agent.status === "done")
    return `${nameLine}\n${theme.fg("muted", "Done")}`;
  return `${nameLine}\n${theme.fg("error", agent.errorMessage?.split("\n")[0] ?? "Error: subagent failed")}`;
}

function workflowLogLines(snapshot: WorkflowSnapshot, theme: any): string[] {
  const logs = snapshot.logs.slice(-3);
  if (logs.length === 0) return [];
  return [
    theme.bold("Logs"),
    ...logs.map((log) => {
      const color = log.level === "error" ? "error" : "muted";
      return theme.fg(color, `- ${log.message}`);
    }),
  ];
}

export function renderSnapshot(
  snapshot: WorkflowSnapshot,
  theme: any,
  options: { final?: boolean } = {},
): string[] {
  const sections: string[][] = [[workflowHeader(snapshot, options)]];
  for (let i = 0; i < snapshot.agents.length; i++) {
    const agent = snapshot.agents[i];
    const block = agent.activity
      ? agentProgressLine(
          agent.activity,
          i === snapshot.agents.length - 1,
          theme,
        )
      : fallbackAgentLine(agent, theme);
    sections.push(block.split("\n"));
  }
  const logs = workflowLogLines(snapshot, theme);
  if (logs.length > 0) sections.push(logs);
  return sections.flatMap((section, index) =>
    index === 0 ? section : ["", ...section],
  );
}

export function renderWorkflowCall(
  _params: unknown,
  _theme: any,
  context: any,
) {
  const t = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  t.setText("");
  return t;
}

export function renderWorkflowResult(
  result: any,
  { isPartial }: { isPartial?: boolean },
  theme: any,
  context: any,
) {
  if (isPartial) {
    startPartialTimer(context);
    const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
    const lines = snapshot
      ? renderSnapshot(snapshot, theme)
      : ["Running workflow..."];
    return getTruncatedText(context.lastComponent, lines);
  }
  clearPartialTimer(context);
  const text = getResultText(result);
  if (text.startsWith("Error:"))
    return new Text(theme.fg("error", text.split("\n")[0]), 0, 0);

  const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
  if (snapshot?.agents?.length) {
    return getTruncatedText(
      context.lastComponent,
      renderSnapshot(snapshot, theme, { final: true }),
    );
  }

  return getTruncatedText(context.lastComponent, [
    formatWorkflowResult(result.details, text),
  ]);
}
