import { stripVTControlCharacters } from "node:util";
import {
  clearPartialTimer,
  formatDuration,
  getResultText,
  getTruncatedText,
  startPartialTimer,
} from "../_shared/render.ts";
import { agentProgressLine } from "../subagents/render.ts";
import {
  DEFAULT_MAX_VISIBLE_SETTLED_AGENTS,
  type WorkflowAgentState,
  type WorkflowSnapshot,
} from "./types.ts";

const MAX_DISPLAY_CHARS = 2_000;

function safeDisplay(value: unknown): string {
  return stripVTControlCharacters(String(value ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_CHARS);
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
  const name = info?.meta?.name ? ` ${safeDisplay(info.meta.name)}` : "";
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
  return `✓ workflow${name}${duration}${agentFailures}${branches}${first ? ` — ${safeDisplay(first).slice(0, 80)}` : ""}`;
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
  options: { final?: boolean; error?: boolean } = {},
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
    const glyph = options.error
      ? theme.fg("error", "✗")
      : theme.fg("success", "✓");
    return `${theme.bold("Workflow")}: ${name} ${glyph} · ${elapsed}${counts}`;
  }
  const phase = snapshot.phase ? ` · ${safeDisplay(snapshot.phase)}` : "";
  return `${theme.bold("Workflow")}: ${name}${phase}${counts} · ${elapsed}`;
}

function compactSnapshotLine(
  snapshot: WorkflowSnapshot,
  theme: any,
  final: boolean,
  error = false,
): string {
  const elapsed = formatDuration(
    Math.max(0, (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt),
  );
  const name = safeDisplay(snapshot.meta?.name ?? "workflow");
  const phase =
    !final && snapshot.phase ? ` · ${safeDisplay(snapshot.phase)}` : "";
  const { running, done, failed } = countAgents(snapshot);
  const agentFailures = snapshot.agentFailureCount ?? failed;
  const branchFailures =
    (snapshot.loggedBranchFailureCount ?? 0) +
    (snapshot.settledBranchFailureCount ?? 0);
  const branches =
    branchFailures > 0 ? ` · ${branchFailures} branch failed` : "";
  if (!final) {
    return theme.fg(
      "warning",
      `Running ${name}${phase} · ${done} done · ${running} running · ${agentFailures} failed${branches} · ${elapsed}`,
    );
  }
  const hasFailures = agentFailures > 0 || branchFailures > 0;
  return theme.fg(
    error ? "error" : hasFailures ? "warning" : "success",
    `${error ? "✗" : hasFailures ? "!" : "✓"} ${name} · ${done} done · ${agentFailures} failed${branches} · ${elapsed}`,
  );
}

function compactErrorLine(
  snapshot: WorkflowSnapshot,
  details: any,
  message: string,
  theme: any,
): string {
  const elapsed = formatDuration(
    Math.max(0, (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt),
  );
  const name = safeDisplay(snapshot.meta?.name ?? "workflow");
  const code = safeDisplay(details?.errorCode ?? "workflow_script_error");
  const counts = details?.counts as
    | {
        completed?: number;
        failed?: number;
        timedOut?: number;
        canceled?: number;
        outstanding?: number;
      }
    | undefined;
  const summary = counts
    ? ` · ${counts.completed ?? 0} done · ${counts.failed ?? 0} failed · ${counts.timedOut ?? 0} timed out · ${(counts.canceled ?? 0) + (counts.outstanding ?? 0)} canceled/outstanding`
    : "";
  return theme.fg(
    "error",
    `✗ ${name} · ${code}${summary} · ${elapsed} — ${safeDisplay(message).slice(0, 100)}`,
  );
}

function safeAgentActivity(
  activity: NonNullable<WorkflowAgentState["activity"]>,
): NonNullable<WorkflowAgentState["activity"]> {
  const safeOptional = (value: string | undefined) =>
    value === undefined ? undefined : safeDisplay(value);
  return {
    ...activity,
    intent: safeDisplay(activity.intent),
    phase: safeDisplay(activity.phase) as typeof activity.phase,
    activeTool: safeOptional(activity.activeTool),
    currentCommand: safeOptional(activity.currentCommand),
    lastCommand: safeOptional(activity.lastCommand),
    lastOutput: safeOptional(activity.lastOutput),
    lastToolInfo: safeOptional(activity.lastToolInfo),
    recentEvents: activity.recentEvents.map((event) => ({
      ...event,
      text: safeDisplay(event.text),
    })),
    errorMessage: safeOptional(activity.errorMessage),
    logFile: safeOptional(activity.logFile),
  };
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
  const policy = `${agent.capabilities.join(",") || "none"} · ${agent.modelTier}/${agent.thinking}`;
  const label = `${glyph} ${safeDisplay(agent.intent)} · ${safeDisplay(policy)}`;
  if (agent.status === "running")
    return `${label} · ${theme.fg("muted", "initializing")}`;
  if (agent.status === "done") return `${label} · ${theme.fg("muted", "done")}`;
  return `${label} · ${theme.fg("error", safeDisplay(agent.errorMessage?.split("\n")[0] ?? "Error: subagent failed"))}`;
}

function agentLines(agent: WorkflowAgentState, theme: any): string[] {
  let primary = agent.activity
    ? agentProgressLine(safeAgentActivity(agent.activity), theme)
    : fallbackAgentLine(agent, theme);
  if (agent.explicitTimeoutMs !== undefined) {
    primary += ` · ${theme.fg("dim", `timeout ${agent.explicitTimeoutMs}ms`)}`;
  }
  const metadata: string[] = [];
  if (agent.errorCode) metadata.push(`failure ${safeDisplay(agent.errorCode)}`);
  if (agent.logFile) metadata.push(`log ${safeDisplay(agent.logFile)}`);
  if (agent.diagnosticWarnings?.length) {
    metadata.push(
      `warning ${safeDisplay(agent.diagnosticWarnings.join("; "))}`,
    );
  }
  return metadata.length > 0
    ? [primary, theme.fg("dim", `  ${metadata.join(" · ")}`)]
    : [primary];
}

function workflowLogLines(snapshot: WorkflowSnapshot, theme: any): string[] {
  const logs = snapshot.logs.slice(-3);
  if (logs.length === 0) return [];
  return [
    theme.bold("Logs"),
    ...logs.map((log) => {
      const color = log.level === "error" ? "error" : "muted";
      return theme.fg(color, `- ${safeDisplay(log.message)}`);
    }),
  ];
}

export function renderSnapshot(
  snapshot: WorkflowSnapshot,
  theme: any,
  options: {
    final?: boolean;
    error?: boolean;
    maxVisibleSettledAgents?: number;
  } = {},
): string[] {
  const lines: string[] = [workflowHeader(snapshot, theme, options)];
  const running = snapshot.agents.filter((agent) => agent.status === "running");
  const settled = snapshot.agents.filter((agent) => agent.status !== "running");
  const maxVisibleSettledAgents =
    options.maxVisibleSettledAgents ?? DEFAULT_MAX_VISIBLE_SETTLED_AGENTS;
  const visibleSettled =
    maxVisibleSettledAgents === 0
      ? []
      : settled.slice(-maxVisibleSettledAgents);
  const hiddenSettled = settled.slice(
    0,
    Math.max(0, settled.length - visibleSettled.length),
  );
  const visibleAgents = [...running, ...visibleSettled];
  if (snapshot.agents.length > 0) {
    lines.push("");
    if (hiddenSettled.length > 0) {
      const done = hiddenSettled.filter(
        (agent) => agent.status === "done",
      ).length;
      const failed = hiddenSettled.length - done;
      const hiddenSummary = [
        `↑ ${hiddenSettled.length} earlier agent${hiddenSettled.length === 1 ? "" : "s"} hidden`,
        ...(done > 0 ? [`${done} done`] : []),
        ...(failed > 0 ? [`${failed} failed`] : []),
      ].join(" · ");
      lines.push(theme.fg("dim", hiddenSummary));
    }
    lines.push(...visibleAgents.flatMap((agent) => agentLines(agent, theme)));
  }
  const logs = workflowLogLines(snapshot, theme);
  if (logs.length > 0) lines.push("", ...logs);
  return lines;
}

export function renderWorkflowCall(params: unknown, theme: any, context: any) {
  const input = params as { action?: string; name?: string } | undefined;
  const action = safeDisplay(input?.action ?? "run");
  const name = input?.name ? ` ${safeDisplay(input.name)}` : "";
  return getTruncatedText(context.lastComponent, [
    `${theme.fg("toolTitle", theme.bold("workflow"))} ${theme.fg("muted", `${action}${name}`)}`,
  ]);
}

export function renderWorkflowResult(
  result: any,
  { isPartial, expanded }: { isPartial?: boolean; expanded?: boolean },
  theme: any,
  context: any,
) {
  if (isPartial) {
    startPartialTimer(context);
    const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
    const lines = snapshot
      ? expanded
        ? [
            "",
            ...renderSnapshot(snapshot, theme, {
              maxVisibleSettledAgents: result.details?.maxVisibleSettledAgents,
            }),
          ]
        : [compactSnapshotLine(snapshot, theme, false)]
      : [theme.fg("warning", "workflow running...")];
    return getTruncatedText(context.lastComponent, lines);
  }
  clearPartialTimer(context);
  const text = getResultText(result);
  if (
    context.isError ||
    text.startsWith("Error") ||
    text.startsWith("Invalid workflow input:")
  ) {
    const message = theme.fg(
      "error",
      safeDisplay(text.split("\n").find(Boolean) ?? "Workflow failed"),
    );
    const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
    if (snapshot) {
      const recoveryFile = result.details?.recoveryFile
        ? safeDisplay(result.details.recoveryFile)
        : undefined;
      const persistenceWarning = result.details?.persistenceWarning
        ? safeDisplay(result.details.persistenceWarning)
        : undefined;
      const lines = expanded
        ? [
            "",
            ...renderSnapshot(snapshot, theme, {
              final: true,
              error: true,
              maxVisibleSettledAgents: result.details?.maxVisibleSettledAgents,
            }),
            "",
            message,
            ...(recoveryFile ? [`Recovery: ${recoveryFile}`] : []),
            ...(persistenceWarning
              ? [theme.fg("warning", `Warning: ${persistenceWarning}`)]
              : []),
          ]
        : [compactErrorLine(snapshot, result.details, message, theme)];
      return getTruncatedText(context.lastComponent, lines);
    }
    const input = context.args as
      | { action?: string; name?: string }
      | undefined;
    const action = safeDisplay(
      result.details?.action ?? input?.action ?? "run",
    );
    const name = input?.name ? ` ${safeDisplay(input.name)}` : "";
    return getTruncatedText(context.lastComponent, [
      theme.fg("error", `✗ workflow ${action}${name}`),
      message,
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
    const entries = inventory?.entries ?? [];
    if (!expanded) {
      const count = entries.length;
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("success", "✓")} ${count} saved workflow${count === 1 ? "" : "s"}`,
      ]);
    }
    return getTruncatedText(context.lastComponent, [
      `saved workflows · ${safeDisplay(inventory?.storeDir ?? "unknown store")}`,
      ...entries.map((entry) => {
        const name = safeDisplay(entry.name ?? entry.filename);
        return entry.valid
          ? `✓ ${name}${entry.description ? ` — ${safeDisplay(entry.description)}` : ""}`
          : `✗ ${name} — ${safeDisplay(entry.diagnostic ?? "invalid")}`;
      }),
      ...(inventory?.truncated
        ? [`… ${safeDisplay(inventory.truncated)}`]
        : []),
    ]);
  }

  if (result.details?.action === "validate") {
    const name = safeDisplay(result.details.meta?.name ?? "workflow");
    const source = expanded
      ? result.details.sourceFile
        ? ` · ${safeDisplay(result.details.sourceFile)}`
        : " · inline"
      : "";
    return getTruncatedText(context.lastComponent, [
      `${theme.fg("success", "✓")} validated ${name}${source}`,
    ]);
  }

  const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
  if (snapshot) {
    return getTruncatedText(
      context.lastComponent,
      expanded
        ? [
            "",
            ...renderSnapshot(snapshot, theme, {
              final: true,
              maxVisibleSettledAgents: result.details?.maxVisibleSettledAgents,
            }),
          ]
        : [compactSnapshotLine(snapshot, theme, true)],
    );
  }

  return getTruncatedText(context.lastComponent, [
    theme.fg("success", formatWorkflowResult(result.details, text)),
  ]);
}
