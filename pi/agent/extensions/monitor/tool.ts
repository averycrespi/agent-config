import { Type } from "typebox";
import { visibleWidth } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  expandedResult,
  getTruncatedText,
  plural,
  toolCall,
  outcomeLine,
  outcomeSections,
  type RenderLine,
} from "../_shared/render.ts";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { label, type Receipt } from "./contract.ts";
import { DEFAULT_CONFIG, type MonitorConfig } from "./config.ts";
const finite = (max: number, description: string) =>
  Type.Optional(Type.Integer({ minimum: 1000, maximum: max, description }));
export const parameters = (config: Readonly<MonitorConfig> = DEFAULT_CONFIG) =>
  Type.Object(
    {
      action: StringEnum(["start", "list", "get", "cancel"] as const),
      id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      message: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
      providers: Type.Optional(
        Type.Array(Type.String(), { maxItems: 32, uniqueItems: true }),
      ),
      source: Type.Optional(Type.String({ minLength: 1, maxLength: 237568 })),
      cycle_timeout_ms: finite(
        config.maxCycleTimeoutMs,
        "Observation/attention deadline per cycle, including setup; NOT a per-call timeout. One-shot expiry ends observation. For repeated polling, allow multiple intervals plus evaluation time.",
      ),
      lifetime_ms: finite(
        config.maxLifetimeMs,
        "Outer wall-clock ceiling including setup and settlement waits. Does not override earlier cycle expiry or renew caller-owned task allowances.",
      ),
      max_wakes: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      recurring: Type.Optional(Type.Boolean()),
      interval_ms: finite(
        config.maxCycleTimeoutMs,
        "Polling delay after each evaluation settles (including event evaluations), not evaluation runtime or observation lifetime. Initial evaluation runs after setup; interval >= cycle timeout permits no subsequent poll before that deadline.",
      ),
      delay_ms: finite(
        config.maxCycleTimeoutMs,
        "Timer-only continuation delay: first from admission, subsequent delays after positively correlated wake settlement. Alternative to polling/events/source.",
      ),
      events: Type.Optional(
        Type.Array(
          Type.Object(
            {
              provider: Type.String(),
              event: Type.String(),
              args: Type.Array(Type.Any()),
            },
            { additionalProperties: false },
          ),
          { maxItems: 4 },
        ),
      ),
      state: Type.Optional(Type.Any()),
    },
    { additionalProperties: false },
  );
export const PARAMETERS = parameters();
export function summary(r: Receipt) {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    deadline: r.deadline,
    cycleDeadline: r.cycleDeadline,
    wakes: r.wakes,
    maxWakes: r.maxWakes,
    evaluations: r.evaluations,
    attention: r.attention,
    lastAttention: r.lastAttention,
    failureCode: r.failureCode,
    recurring: r.recurring,
    cycleMs: r.cycleMs,
    intervalMs: r.intervalMs,
    delayMs: r.delayMs,
    eventCount: r.eventCount,
    calls: r.calls,
    inFlight: r.inFlight,
    awaitingSettlement: r.awaitingSettlement,
    effectsMayPersist: r.effectsMayPersist,
    outcomeUnknown: r.outcomeUnknown,
  };
}
export type DisplayReceipt = Pick<Receipt, keyof ReturnType<typeof summary>>;
export function pollingWarning(r: DisplayReceipt): string | undefined {
  if (r.intervalMs === undefined || r.intervalMs < r.cycleMs) return;
  return (
    "Warning: interval_ms >= cycle_timeout_ms. Only the initial polling evaluation can run before the cycle deadline; the next poll is scheduled after evaluation settlement plus interval_ms, at or beyond that deadline." +
    (r.eventCount
      ? " Events may still trigger evaluations before expiry."
      : "") +
    " One-shot expiry ends observation; lifetime_ms does not extend the cycle. Registration accepted unchanged."
  );
}
export interface DisplayDetails {
  monitorError?: boolean;
  action?: string;
  status?: string;
  receipts?: DisplayReceipt[];
  receipt?: DisplayReceipt;
  cancelChanged?: boolean;
}
const reasons = {
  condition: "condition met",
  timeout: "timed out",
  evaluation_failure: "evaluation failed",
  coverage_failure: "coverage lost",
  budget_exhausted: "limit reached",
};
function activity(r: DisplayReceipt): string {
  if (r.attention?.disposition === "pending")
    return `${reasons[r.attention.reason] ?? "attention"}; follow-up queued`;
  if (r.status !== "active") {
    if (r.status !== "finished") return label(r.status);
    if (r.failureCode === "wake_limit") return "wake limit reached";
    if (r.failureCode === "lifetime_limit") return "lifetime expired";
    const reason = r.attention?.reason ?? r.lastAttention?.reason;
    return reason && reason !== "condition" ? reasons[reason] : "finished";
  }
  if (r.awaitingSettlement) return "awaiting settlement";
  if (r.inFlight) return "checking";
  if (r.delayMs !== undefined) return "scheduled";
  if (r.intervalMs !== undefined)
    return r.eventCount ? "polling + events" : "polling";
  if (r.eventCount) return "watching events";
  return "observing";
}
function warnings(
  r: DisplayReceipt & Partial<Pick<Receipt, "interrupted" | "gap">>,
): string[] {
  return [
    ...(r.outcomeUnknown ? ["effects uncertain"] : []),
    ...(r.interrupted ? ["interrupted"] : []),
    ...(r.gap ? ["coverage gap"] : []),
    ...(r.effectsMayPersist && !r.outcomeUnknown
      ? ["effects may persist"]
      : []),
    ...(r.lastAttention?.disposition === "handoff_unknown"
      ? ["handoff uncertain"]
      : []),
  ];
}
function jobLine(r: DisplayReceipt, includeName = false): string {
  return [
    ...warnings(r),
    activity(r),
    ...(r.failureCode ? [label(r.failureCode)] : []),
    ...(includeName ? [label(r.name)] : []),
    r.recurring ? `wakes ${r.wakes}/${r.maxWakes}` : plural(r.wakes, "wake"),
    ...(r.evaluations ? [plural(r.evaluations, "evaluation")] : []),
    ...(r.calls ? [plural(r.calls, "call")] : []),
  ].join(" · ");
}
function registrationLine(r: DisplayReceipt): string {
  const duration = formatWidgetCountdown;
  const mode =
    r.delayMs !== undefined
      ? r.recurring
        ? `every ${duration(r.delayMs)} after settlement`
        : `scheduled in ${duration(r.delayMs)}`
      : r.intervalMs !== undefined
        ? `polling every ${duration(r.intervalMs)}${r.eventCount ? " + events" : ""}`
        : r.eventCount
          ? "watching events"
          : "registered";
  return [
    mode,
    `timeout ${duration(r.cycleMs)}`,
    ...(r.recurring ? [`max ${plural(r.maxWakes, "wake")}`] : []),
  ].join(" · ");
}
function resultLine(d: DisplayDetails, action: string): string {
  if (action === "list") {
    const receipts = d.receipts ?? [];
    if (!receipts.length) return "no jobs";
    const active = receipts.filter((r) => r.status === "active").length;
    const pending = receipts.filter(
      (r) => r.attention?.disposition === "pending",
    ).length;
    return [
      active ? `${active} active` : "no active jobs",
      `${receipts.length} retained`,
      ...(pending ? [`${pending} follow-up queued`] : []),
    ].join(" · ");
  }
  const r = d.receipt;
  if (!r) return label(d.status) || "result unavailable";
  if (action === "start") return registrationLine(r);
  if (action === "cancel")
    return [
      ...warnings(r),
      d.cancelChanged ? "cancelled" : `already ${label(r.status)}`,
      ...(r.lastAttention?.disposition === "handed_to_pi"
        ? ["follow-up already handed off"]
        : []),
    ].join(" · ");
  return jobLine(r);
}
export function visible(r: Receipt) {
  return r.status === "active" || r.attention?.disposition === "pending";
}
export function widgetLines(
  receipts: Receipt[],
  now: number,
  width: number,
  theme: Theme,
) {
  return receipts.filter(visible).map((r) => {
    const pending = r.attention?.disposition === "pending";
    const color =
      r.outcomeUnknown || (pending && r.attention!.reason.includes("failure"))
        ? "error"
        : pending || r.awaitingSettlement
          ? "warning"
          : "accent";
    const timing = (name: string, at: number) =>
      theme.fg("muted", `${name} `) +
      theme.fg("text", formatWidgetCountdown(at - now));
    const state = pending
      ? (reasons[r.attention!.reason] ?? "attention")
      : activity(r);
    const fields: string[] = pending
      ? [theme.fg("warning", "follow-up queued")]
      : [];
    if (!pending && !r.awaitingSettlement) {
      if (!r.inFlight && r.nextAt !== undefined) {
        if (r.delayMs !== undefined) fields.push(timing("in", r.nextAt));
        else fields.push(timing("next check", r.nextAt));
      }
      fields.push(
        timing(
          r.deadline < r.cycleDeadline ? "expires" : "timeout",
          Math.min(r.deadline, r.cycleDeadline),
        ),
      );
    }
    if (r.recurring)
      fields.push(
        theme.fg("muted", "wakes ") +
          theme.fg("text", `${r.wakes}/${r.maxWakes}`),
      );
    if (r.awaitingSettlement && r.status === "active")
      fields.push(timing("expires", r.deadline));
    const name = theme.fg("text", label(r.name));
    const separator = theme.fg("dim", " · ");
    const primary = `${theme.fg("muted", "monitor")} ${theme.fg(color, state)}`;
    const warningText = warnings(r);
    const compact: Record<string, string> = {
      "effects uncertain": "unknown",
      "coverage gap": "gap",
      "effects may persist": "effects?",
      "handoff uncertain": "handoff?",
    };
    const narrow = visibleWidth([primary, ...warningText].join(" · ")) > width;
    const critical = warningText.map((s) =>
      theme.fg("warning", narrow ? (compact[s] ?? s) : s),
    );
    return fitWidgetRow(
      primary +
        (critical.length
          ? separator + critical.join(narrow ? theme.fg("dim", "/") : separator)
          : ""),
      fields,
      width,
      separator,
      name,
      " ",
    );
  });
}
export function notificationContent(
  r: Receipt,
  message: string,
  now = Date.now(),
) {
  return `${message}\n\nMonitor attention: ${r.lastAttention?.reason}. This is not watched-condition success/failure or acknowledgment of model consumption. Recurrence ${r.status === "active" && r.recurring ? "remains enabled" : "disabled"}. Inspect monitor get; cancel when no further work is authorized.\n${wrapUntrustedContent("MONITOR EVIDENCE", JSON.stringify({ id: r.id, reason: r.lastAttention?.reason, latestCommittedEvidence: r.evidence, evidenceAgeMs: r.evidenceAt === undefined ? null : Math.max(0, now - r.evidenceAt), gap: r.gap, interrupted: r.interrupted, failureCode: r.failureCode, effectsMayPersist: r.effectsMayPersist, outcomeUnknown: r.outcomeUnknown }))}`;
}
export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, ctx) {
    return getTruncatedText(ctx.lastComponent, [
      toolCall(
        theme,
        "monitor",
        args.action,
        args.name ?? args.id?.slice(0, 8),
      ),
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, ctx) {
    const d = (result.details ?? {}) as DisplayDetails;
    const action = label(d.action ?? ctx.args?.action, 16);
    const failed = ctx.isError || d.monitorError;
    const reason =
      d.receipt?.attention?.reason ?? d.receipt?.lastAttention?.reason;
    const jobFailed =
      d.receipt?.outcomeUnknown ||
      d.receipt?.lastAttention?.disposition === "handoff_unknown" ||
      reason === "evaluation_failure" ||
      reason === "coverage_failure";
    const polling =
      action === "start" && d.receipt ? pollingWarning(d.receipt) : undefined;
    const caution =
      polling ||
      (d.receipt &&
        (warnings(d.receipt).length > 0 ||
          d.receipt.failureCode ||
          reason === "timeout" ||
          d.receipt.attention?.disposition === "pending"));
    const partial =
      action === "start"
        ? "registering…"
        : action === "cancel"
          ? "cancelling…"
          : action === "list"
            ? "listing jobs…"
            : "reading job…";
    if (
      !expanded &&
      !isPartial &&
      (d.receipt?.outcomeUnknown ||
        d.receipt?.lastAttention?.disposition === "handoff_unknown")
    )
      return getTruncatedText(ctx.lastComponent, [
        outcomeLine(
          theme,
          failed
            ? "failed; unknown; no replay"
            : d.receipt.outcomeUnknown &&
                d.receipt.lastAttention?.disposition === "handoff_unknown"
              ? "unknown; no replay"
              : d.receipt.outcomeUnknown
                ? "effects unknown; no replay"
                : "handoff unknown; no replay",
          failed ? "error" : "warning",
        ),
      ]);
    const lines: RenderLine[] = [
      outcomeSections(
        theme,
        (isPartial
          ? partial
          : failed
            ? "request failed"
            : !expanded && polling
              ? "registered; no repeat poll"
              : resultLine(d, action)
        ).split(" · "),
        isPartial
          ? "warning"
          : failed || jobFailed
            ? "error"
            : caution
              ? "warning"
              : "muted",
      ),
    ];
    if (expanded && polling && !failed && !isPartial)
      lines.push(theme.fg("warning", polling));
    if (expanded && !failed && !isPartial) {
      if (action === "list")
        for (const r of d.receipts ?? []) lines.push(jobLine(r, true));
      else if (d.receipt) {
        const r = d.receipt;
        lines.push(`job ${label(r.name)} (${label(r.id)})`);
        if (action !== "get") lines.push(jobLine(r));
        if (r.effectsMayPersist)
          lines.push(
            "Dispatched effects may persist; cancellation is not rollback.",
          );
        if (r.lastAttention)
          lines.push(
            `follow-up ${label(r.lastAttention.disposition)}; admission ${r.lastAttention.admitted ? "observed" : "not observed"}`,
          );
      }
    }
    if (expanded && !isPartial) lines.push(...expandedResult(result));
    return getTruncatedText(ctx.lastComponent, lines);
  },
};
