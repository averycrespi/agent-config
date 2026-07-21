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

function separator(theme: any): string {
  return theme.fg("muted", " · ");
}

function workflowIdentity(theme: any, action: string, name?: string): string {
  const title = theme.fg("toolTitle", theme.bold("workflow"));
  const safeName = name ? ` ${safeDisplay(name)}` : "";
  return action === "run"
    ? `${title}${safeName}`
    : `${title} ${safeDisplay(action)}${safeName}`;
}

function statusPrefix(
  theme: any,
  status: "success" | "warning" | "error",
): string {
  const glyph = status === "success" ? "✓" : status === "warning" ? "!" : "✗";
  return `${theme.fg(status, glyph)} `;
}

function conciseErrorMessage(text: string): string {
  return safeDisplay(text)
    .replace(/^(?:Error:|Invalid workflow input:)\s*/i, "")
    .replace(/^-\s*/, "")
    .slice(0, 100);
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

function workflowSummaryLine(
  snapshot: WorkflowSnapshot,
  theme: any,
  options: { final?: boolean; error?: boolean } = {},
): string {
  const elapsed = formatDuration(
    Math.max(0, (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt),
  );
  const { running, done, failed } = countAgents(snapshot);
  const agentFailures = snapshot.agentFailureCount ?? failed;
  const branchFailures =
    (snapshot.loggedBranchFailureCount ?? 0) +
    (snapshot.settledBranchFailureCount ?? 0);
  const parts: string[] = [];
  if (!options.final && snapshot.phase) parts.push(safeDisplay(snapshot.phase));
  parts.push(`${done} done`);
  if (!options.final) parts.push(`${running} running`);
  parts.push(
    branchFailures > 0
      ? `${agentFailures} agent${agentFailures === 1 ? "" : "s"} failed`
      : `${agentFailures} failed`,
  );
  if (branchFailures > 0) {
    parts.push(
      `${branchFailures} branch${branchFailures === 1 ? "" : "es"} failed`,
    );
  }
  parts.push(elapsed);

  const hasFailures = agentFailures > 0 || branchFailures > 0;
  const status = options.final
    ? statusPrefix(
        theme,
        options.error ? "error" : hasFailures ? "warning" : "success",
      )
    : "";
  const identity = workflowIdentity(theme, "run", snapshot.meta?.name);
  return `${status}${identity}${separator(theme)}${theme.fg("muted", parts.join(" · "))}`;
}

function errorSummaryLine(
  snapshot: WorkflowSnapshot | undefined,
  details: any,
  text: string,
  theme: any,
  context: any,
): string {
  const input = context.args as { action?: string; name?: string } | undefined;
  const action = safeDisplay(details?.action ?? input?.action ?? "run");
  const name = safeDisplay(
    snapshot?.meta?.name ?? details?.meta?.name ?? input?.name,
  );
  const code = safeDisplay(
    details?.errorCode ??
      (details?.inputError
        ? "invalid input"
        : details?.validationError
          ? "invalid definition"
          : details?.artifactError
            ? "artifact error"
            : `${action} failed`),
  );
  const parts = [code];
  const counts = details?.counts as
    | {
        completed?: number;
        failed?: number;
        timedOut?: number;
        canceled?: number;
        outstanding?: number;
      }
    | undefined;
  if (counts) {
    parts.push(`${counts.completed ?? 0} done`, `${counts.failed ?? 0} failed`);
    if ((counts.timedOut ?? 0) > 0) {
      parts.push(`${counts.timedOut} timed out`);
    }
    const canceled = (counts.canceled ?? 0) + (counts.outstanding ?? 0);
    if (canceled > 0) parts.push(`${canceled} canceled/outstanding`);
  }
  if (snapshot) {
    parts.push(
      formatDuration(
        Math.max(0, (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt),
      ),
    );
  }
  const message = conciseErrorMessage(text);
  const suffix = message
    ? `${theme.fg("muted", " — ")}${theme.fg("error", message)}`
    : "";
  return `${statusPrefix(theme, "error")}${workflowIdentity(theme, action, name || undefined)}${separator(theme)}${theme.fg("muted", parts.join(" · "))}${suffix}`;
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
  const policy = theme.fg(
    "muted",
    safeDisplay(
      `${agent.capabilities.join(",") || "none"} · ${agent.modelTier}/${agent.thinking}`,
    ),
  );
  const label = `${glyph} ${safeDisplay(agent.intent)}`;
  const sep = separator(theme);
  if (agent.status === "running")
    return `${label}${sep}${policy}${sep}${theme.fg("muted", "initializing")}`;
  if (agent.status === "done")
    return `${label}${sep}${policy}${sep}${theme.fg("muted", "done")}`;
  return `${label}${sep}${policy}${sep}${theme.fg("error", safeDisplay(agent.errorMessage?.split("\n")[0] ?? "Error: subagent failed"))}`;
}

function agentLines(agent: WorkflowAgentState, theme: any): string[] {
  let primary = agent.activity
    ? agentProgressLine(safeAgentActivity(agent.activity), theme)
    : fallbackAgentLine(agent, theme);
  if (agent.explicitTimeoutMs !== undefined) {
    primary += `${separator(theme)}${theme.fg("dim", `timeout ${agent.explicitTimeoutMs}ms`)}`;
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

function renderSnapshotDetails(
  snapshot: WorkflowSnapshot,
  theme: any,
  maxVisibleSettledAgents = DEFAULT_MAX_VISIBLE_SETTLED_AGENTS,
): string[] {
  const lines: string[] = [];
  const chronologicalAgents = [...snapshot.agents].sort(
    (a, b) => a.startedAt - b.startedAt || a.id - b.id,
  );
  const settled = chronologicalAgents.filter(
    (agent) => agent.status !== "running",
  );
  const visibleSettled =
    maxVisibleSettledAgents === 0
      ? []
      : settled.slice(-maxVisibleSettledAgents);
  const hiddenSettled = settled.slice(
    0,
    Math.max(0, settled.length - visibleSettled.length),
  );
  const visibleSettledSet = new Set(visibleSettled);
  const visibleAgents = chronologicalAgents.filter(
    (agent) => agent.status === "running" || visibleSettledSet.has(agent),
  );
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

export function renderSnapshot(
  snapshot: WorkflowSnapshot,
  theme: any,
  options: {
    final?: boolean;
    error?: boolean;
    maxVisibleSettledAgents?: number;
  } = {},
): string[] {
  return [
    workflowSummaryLine(snapshot, theme, options),
    ...renderSnapshotDetails(
      snapshot,
      theme,
      options.maxVisibleSettledAgents ?? DEFAULT_MAX_VISIBLE_SETTLED_AGENTS,
    ),
  ];
}

function actionSummaryLine(
  theme: any,
  status: "success" | "warning",
  action: string,
  name: string | undefined,
  parts: string[] = [],
): string {
  const suffix =
    parts.length > 0
      ? `${separator(theme)}${theme.fg("muted", parts.join(" · "))}`
      : "";
  return `${statusPrefix(theme, status)}${workflowIdentity(theme, action, name)}${suffix}`;
}

export function renderWorkflowCall(
  _params: unknown,
  _theme: any,
  context: any,
) {
  return getTruncatedText(context.lastComponent, []);
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
    if (snapshot) {
      const lines = expanded
        ? renderSnapshot(snapshot, theme, {
            maxVisibleSettledAgents: result.details?.maxVisibleSettledAgents,
          })
        : [workflowSummaryLine(snapshot, theme)];
      return getTruncatedText(context.lastComponent, lines);
    }
    const input = context.args as
      | { action?: string; name?: string }
      | undefined;
    const identity = workflowIdentity(
      theme,
      safeDisplay(input?.action ?? "run"),
      input?.name,
    );
    return getTruncatedText(context.lastComponent, [
      `${identity}${separator(theme)}${theme.fg("muted", "starting")}`,
    ]);
  }

  clearPartialTimer(context);
  const text = getResultText(result);
  if (
    context.isError ||
    text.startsWith("Error") ||
    text.startsWith("Invalid workflow input:")
  ) {
    const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
    const summary = errorSummaryLine(
      snapshot,
      result.details,
      text,
      theme,
      context,
    );
    if (!expanded || !snapshot) {
      return getTruncatedText(context.lastComponent, [summary]);
    }

    const lines = [
      summary,
      ...renderSnapshotDetails(
        snapshot,
        theme,
        result.details?.maxVisibleSettledAgents ??
          DEFAULT_MAX_VISIBLE_SETTLED_AGENTS,
      ),
    ];
    const recoveryFile = result.details?.recoveryFile
      ? safeDisplay(result.details.recoveryFile)
      : undefined;
    const persistenceWarning = result.details?.persistenceWarning
      ? safeDisplay(result.details.persistenceWarning)
      : undefined;
    if (recoveryFile || persistenceWarning) {
      lines.push("");
      if (recoveryFile) lines.push(`Recovery: ${recoveryFile}`);
      if (persistenceWarning) {
        lines.push(theme.fg("warning", `Warning: ${persistenceWarning}`));
      }
    }
    return getTruncatedText(context.lastComponent, lines);
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
    const summary = actionSummaryLine(theme, "success", "list", undefined, [
      `${entries.length} saved`,
    ]);
    const lines = [summary];
    if (expanded) {
      lines.push(
        "",
        `store ${safeDisplay(inventory?.storeDir ?? "unknown")}`,
        ...entries.map((entry) => {
          const name = safeDisplay(entry.name ?? entry.filename);
          return entry.valid
            ? `✓ ${name}${entry.description ? ` — ${safeDisplay(entry.description)}` : ""}`
            : `✗ ${name} — ${safeDisplay(entry.diagnostic ?? "invalid")}`;
        }),
        ...(inventory?.truncated
          ? [`… ${safeDisplay(inventory.truncated)}`]
          : []),
      );
    }
    return getTruncatedText(context.lastComponent, lines);
  }

  if (result.details?.action === "validate") {
    const name = safeDisplay(result.details.meta?.name ?? "workflow");
    const summary = actionSummaryLine(theme, "success", "validate", name);
    const lines = [summary];
    if (expanded) {
      lines.push(
        "",
        `source ${safeDisplay(result.details.sourceFile ?? "inline")}`,
      );
    }
    return getTruncatedText(context.lastComponent, lines);
  }

  const snapshot = result.details?.snapshot as WorkflowSnapshot | undefined;
  if (snapshot) {
    const lines = expanded
      ? renderSnapshot(snapshot, theme, {
          final: true,
          maxVisibleSettledAgents: result.details?.maxVisibleSettledAgents,
        })
      : [workflowSummaryLine(snapshot, theme, { final: true })];
    return getTruncatedText(context.lastComponent, lines);
  }

  const info = result.details as
    | {
        meta?: { name?: string };
        durationMs?: number;
        agentFailureCount?: number;
        loggedBranchFailureCount?: number;
        settledBranchFailureCount?: number;
      }
    | undefined;
  const agentFailures = info?.agentFailureCount ?? 0;
  const branchFailures =
    (info?.loggedBranchFailureCount ?? 0) +
    (info?.settledBranchFailureCount ?? 0);
  const parts: string[] = [];
  if (agentFailures > 0) parts.push(`${agentFailures} failed`);
  if (branchFailures > 0) {
    parts.push(
      `${branchFailures} branch${branchFailures === 1 ? "" : "es"} failed`,
    );
  }
  if (typeof info?.durationMs === "number") {
    parts.push(formatDuration(info.durationMs));
  }
  return getTruncatedText(context.lastComponent, [
    actionSummaryLine(
      theme,
      agentFailures > 0 || branchFailures > 0 ? "warning" : "success",
      "run",
      info?.meta?.name,
      parts,
    ),
  ]);
}
