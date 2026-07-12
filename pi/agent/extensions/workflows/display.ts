import { Text } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import {
  clearPartialTimer,
  formatDuration,
  getResultText,
  getTruncatedText,
  startPartialTimer,
} from "../_shared/render.ts";
import { agentProgressLine } from "../subagents/render.ts";
import type { WorkflowAgentState, WorkflowSnapshot } from "./types.ts";

function safeDisplay(value: unknown): string {
  return stripVTControlCharacters(String(value ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatWorkflowResult(details: unknown, text: string): string {
  const info = details as
    | {
        meta?: { name?: string };
        durationMs?: number;
        agentFailureCount?: number;
        loggedBranchFailureCount?: number;
        settledBranchFailureCount?: number;
        spilled?: boolean;
      }
    | undefined;
  const name = info?.meta?.name ? ` ${info.meta.name}` : "";
  const agentFailures = info?.agentFailureCount
    ? `, ${info.agentFailureCount} agent failure${info.agentFailureCount === 1 ? "" : "s"}`
    : "";
  const branchFailures =
    (info?.loggedBranchFailureCount ?? 0) +
    (info?.settledBranchFailureCount ?? 0);
  const branches = branchFailures
    ? `, ${branchFailures} branch failure${branchFailures === 1 ? "" : "s"}`
    : "";
  const duration =
    typeof info?.durationMs === "number"
      ? ` in ${formatDuration(info.durationMs)}`
      : "";
  const first = text.trim().split("\n").find(Boolean);
  return `✓ workflow${name}${duration}${agentFailures}${branches}${first ? ` — ${first.slice(0, 80)}` : ""}`;
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
  theme: any,
  options: { final?: boolean } = {},
): string {
  const elapsed = formatDuration(
    (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt,
  );
  const name = safeDisplay(snapshot.meta?.name ?? "workflow");
  const { running, done, failed } = countAgents(snapshot);
  const agentFailures = snapshot.agentFailureCount ?? failed;
  const hasCounts = snapshot.agents.length > 0 || agentFailures > 0;
  let counts = hasCounts
    ? options.final
      ? ` · ${done} done · ${agentFailures} agent${agentFailures === 1 ? "" : "s"} failed`
      : ` · ${done} done · ${running} running · ${agentFailures} agent${agentFailures === 1 ? "" : "s"} failed`
    : "";
  const logged = snapshot.loggedBranchFailureCount ?? 0;
  const settled = snapshot.settledBranchFailureCount ?? 0;
  if (logged > 0) {
    counts += ` · ${logged} logged branch failure${logged === 1 ? "" : "s"}`;
  }
  if (settled > 0) {
    counts += ` · ${settled} settled branch failure${settled === 1 ? "" : "s"}`;
  }
  if (options.final) {
    return `${theme.bold("Workflow")}: ${name} ✓ · ${elapsed}${counts}`;
  }
  const phase = snapshot.phase ? ` · ${safeDisplay(snapshot.phase)}` : "";
  return `${theme.bold("Workflow")}: ${name}${phase}${counts} · ${elapsed}`;
}

function fallbackAgentLine(agent: WorkflowAgentState, theme: any): string {
  const glyph =
    agent.status === "done"
      ? "✓"
      : agent.status === "running"
        ? "●"
        : agent.status === "aborted"
          ? "!"
          : "✗";
  const label = `${glyph} ${agent.agent}: ${agent.intent}`;
  if (agent.status === "running")
    return `${label} · ${theme.fg("muted", "initializing")}`;
  if (agent.status === "done") return `${label} · ${theme.fg("muted", "done")}`;
  return `${label} · ${theme.fg("error", agent.errorMessage?.split("\n")[0] ?? "Error: subagent failed")}`;
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
  const lines: string[] = [workflowHeader(snapshot, theme, options)];
  if (snapshot.agents.length > 0) {
    lines.push(
      "",
      ...snapshot.agents.map((agent) =>
        agent.activity
          ? agentProgressLine(agent.activity, theme)
          : fallbackAgentLine(agent, theme),
      ),
    );
  }
  const logs = workflowLogLines(snapshot, theme);
  if (logs.length > 0) lines.push("", ...logs);
  return lines;
}

export function renderWorkflowCall(params: unknown, _theme: any, context: any) {
  const action = (params as { action?: string } | undefined)?.action;
  if (action === "list" || action === "validate") {
    const name = (params as { name?: string }).name;
    return getTruncatedText(context.lastComponent, [
      `workflow ${action}${name ? ` ${name}` : ""}`,
    ]);
  }
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
  if (text.startsWith("Error:") || text.startsWith("Invalid workflow input:")) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("error", text.split("\n")[0]),
    ]);
  }

  if (result.details?.action === "list") {
    const inventory = result.details.inventory as
      | {
          storeDir?: string;
          entries?: Array<{
            name?: string;
            filename?: string;
            description?: string;
            valid?: boolean;
            diagnostic?: string;
          }>;
          truncated?: string;
        }
      | undefined;
    const lines = [
      `saved workflows · ${safeDisplay(inventory?.storeDir ?? "unknown store")}`,
      ...(inventory?.entries ?? []).map((entry) => {
        const name = safeDisplay(entry.name ?? entry.filename);
        return entry.valid
          ? `✓ ${name}${entry.description ? ` — ${safeDisplay(entry.description)}` : ""}`
          : `✗ ${name} — ${safeDisplay(entry.diagnostic ?? "invalid")}`;
      }),
      ...(inventory?.truncated
        ? [`… ${safeDisplay(inventory.truncated)}`]
        : []),
    ];
    return getTruncatedText(context.lastComponent, lines);
  }

  if (result.details?.action === "validate") {
    const name = safeDisplay(result.details.meta?.name ?? "workflow");
    const source = result.details.sourceFile
      ? ` · ${safeDisplay(result.details.sourceFile)}`
      : " · inline";
    return getTruncatedText(context.lastComponent, [
      `${theme.fg("success", "✓")} validated ${name}${source}`,
    ]);
  }

  const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
  if (snapshot) {
    return getTruncatedText(
      context.lastComponent,
      renderSnapshot(snapshot, theme, { final: true }),
    );
  }

  return getTruncatedText(context.lastComponent, [
    formatWorkflowResult(result.details, text),
  ]);
}
