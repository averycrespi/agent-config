import { Type } from "typebox";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  Theme,
  ThemeColor,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  expandedBodyResult,
  getResultTextComponent,
  getTruncatedText,
  plural,
  toolCall,
  outcomeLine,
} from "../_shared/render.ts";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import type { NotificationHold } from "../_shared/notification-delivery.ts";
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
function queuedForAgent(r: DisplayReceipt): boolean {
  // Restoration clears live settlement tracking, but retains historical handoffs.
  return (
    r.awaitingSettlement &&
    r.lastAttention?.disposition === "handed_to_pi" &&
    !r.lastAttention.admitted
  );
}
function attentionReason(
  r: DisplayReceipt,
  reason: keyof typeof reasons,
): string {
  return reason === "condition" && r.delayMs !== undefined
    ? "timer elapsed"
    : reasons[reason];
}
function activity(r: DisplayReceipt): string {
  if (r.attention?.disposition === "pending")
    return attentionReason(r, r.attention.reason);
  if (queuedForAgent(r) && r.status === "active")
    return attentionReason(r, r.lastAttention!.reason);
  if (r.status !== "active") {
    if (r.status !== "finished")
      return r.status === "cancelled" ? "canceled" : label(r.status);
    if (r.failureCode === "wake_limit") return "wake limit reached";
    if (r.failureCode === "lifetime_limit") return "lifetime expired";
    const reason = r.attention?.reason ?? r.lastAttention?.reason;
    return reason ? attentionReason(r, reason) : "finished";
  }
  if (r.awaitingSettlement) return "awaiting completion";
  if (r.inFlight) return "checking";
  if (r.delayMs !== undefined) return "scheduled";
  if (r.intervalMs !== undefined)
    return r.eventCount ? "polling + events" : "polling";
  if (r.eventCount) return "watching events";
  return "observing";
}
function stateColor(state: string): ThemeColor {
  if (["condition met", "timer elapsed"].includes(state)) return "success";
  if (state === "evaluation failed") return "error";
  if (
    [
      "timed out",
      "coverage lost",
      "limit reached",
      "wake limit reached",
      "lifetime expired",
      "canceled",
      "invalidated",
    ].includes(state)
  )
    return "warning";
  if (
    [
      "watching",
      "checking",
      "scheduled",
      "polling",
      "polling + events",
      "watching events",
      "observing",
    ].includes(state)
  )
    return "accent";
  return "text";
}
function deliveryWait(r: DisplayReceipt, hold?: NotificationHold): string[] {
  return [
    ...(r.attention?.disposition === "pending"
      ? [
          hold === "unavailable"
            ? "delivery held"
            : hold
              ? `waiting for ${hold}`
              : "delivery pending",
        ]
      : []),
    ...(queuedForAgent(r) ? ["queued for agent"] : []),
  ];
}
function warnings(
  r: DisplayReceipt & Partial<Pick<Receipt, "interrupted" | "gap">>,
): string[] {
  return [
    ...(r.outcomeUnknown ? ["outcome uncertain"] : []),
    ...(r.interrupted ? ["interrupted"] : []),
    ...(r.gap ? ["coverage gap"] : []),
    ...(r.lastAttention?.disposition === "handoff_unknown"
      ? ["handoff uncertain"]
      : []),
  ];
}
function jobLine(r: DisplayReceipt, includeName = false): string {
  return [
    activity(r),
    ...(r.failureCode ? [label(r.failureCode)] : []),
    ...(includeName ? [label(r.name)] : []),
    r.recurring ? `wakes ${r.wakes}/${r.maxWakes}` : plural(r.wakes, "wake"),
    ...(r.evaluations ? [plural(r.evaluations, "evaluation")] : []),
    ...(r.calls ? [plural(r.calls, "call")] : []),
    ...deliveryWait(r),
    ...warnings(r),
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
      ...(pending ? [`${pending} deliveries pending`] : []),
    ].join(" · ");
  }
  const r = d.receipt;
  if (!r) return label(d.status) || "result unavailable";
  if (action === "start") return registrationLine(r);
  if (action === "cancel")
    return [
      d.cancelChanged
        ? "canceled"
        : `already ${r.status === "cancelled" ? "canceled" : label(r.status)}`,
      ...warnings(r),
      ...(r.lastAttention?.disposition === "handed_to_pi"
        ? ["notification already handed off"]
        : []),
    ].join(" · ");
  return jobLine(r);
}
export function visible(r: Receipt) {
  return (
    r.status === "active" ||
    r.attention?.disposition === "pending" ||
    queuedForAgent(r) ||
    (r.awaitingSettlement && r.lastAttention?.disposition === "handoff_unknown")
  );
}
export function widgetLines(
  receipts: Receipt[],
  now: number,
  width: number,
  theme: Theme,
  hold?: NotificationHold,
) {
  return receipts.filter(visible).map((r) => {
    const pending = r.attention?.disposition === "pending";
    const timing = (name: string, at: number) =>
      theme.fg("muted", `${name} `) +
      theme.fg("text", formatWidgetCountdown(at - now));
    const state = pending
      ? r.attention!.reason === "condition" && r.delayMs !== undefined
        ? "timer elapsed"
        : (reasons[r.attention!.reason] ?? "attention")
      : r.status === "active" &&
          !r.awaitingSettlement &&
          !r.inFlight &&
          r.delayMs === undefined
        ? "watching"
        : activity(r);
    const color = stateColor(state);
    const fields: string[] = [];
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
    const deliveryFields = deliveryWait(r, hold).map((wait) =>
      theme.fg("muted", wait),
    );
    const name = theme.fg("text", label(r.name));
    const separator = theme.fg("dim", " · ");
    const primary = `${theme.fg("muted", "monitor")} ${theme.fg(color, state)}`;
    const warningText = warnings(r);
    if (warningText.length) fields.push(...deliveryFields);
    const compact: Record<string, string> = {
      "outcome uncertain": "unknown",
      "coverage gap": "gap",
      "handoff uncertain": "handoff?",
    };
    const narrow =
      visibleWidth([primary, ...warningText].join(" · ")) + 9 > width;
    const critical = warningText.map((s) =>
      theme.fg("warning", narrow ? (compact[s] ?? s) : s),
    );
    const suffix = critical.length
      ? separator + critical.join(narrow ? theme.fg("dim", "/") : separator)
      : deliveryFields.length
        ? separator + deliveryFields.join(separator)
        : "";
    const mechanism =
      !pending && !r.awaitingSettlement && r.delayMs === undefined
        ? r.intervalMs !== undefined
          ? r.eventCount
            ? "polling + events"
            : "polling"
          : r.eventCount
            ? "events"
            : undefined
        : undefined;
    // Mechanism is displayed first but discarded before any clock or warning.
    const minimumName = truncateToWidth(
      name,
      Math.min(8, visibleWidth(name)),
      "…",
    );
    if (
      mechanism &&
      visibleWidth(
        primary +
          " " +
          minimumName +
          separator +
          mechanism +
          fields.map((field) => separator + field).join("") +
          suffix,
      ) <= width
    )
      fields.unshift(theme.fg("muted", mechanism));
    // Reserve warnings before fitting optional identity and telemetry, but keep
    // the name adjacent to the state whenever it fits.
    return truncateToWidth(
      fitWidgetRow(
        primary,
        fields,
        Math.max(visibleWidth(primary), width - visibleWidth(suffix)),
        separator,
        name,
        " ",
      ) + suffix,
      width,
      "…",
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
    const polling =
      action === "start" && d.receipt ? pollingWarning(d.receipt) : undefined;

    const partial =
      action === "start"
        ? "registering"
        : action === "cancel"
          ? "canceling"
          : action === "list"
            ? "listing jobs"
            : "reading job";
    const unknown =
      !isPartial &&
      (d.receipt?.outcomeUnknown ||
        d.receipt?.lastAttention?.disposition === "handoff_unknown")
        ? (failed
            ? theme.fg("error", "failed")
            : theme.fg(
                stateColor(activity(d.receipt!)),
                activity(d.receipt!),
              )) +
          theme.fg("dim", " · ") +
          outcomeLine(
            theme,
            failed ||
              (d.receipt?.outcomeUnknown &&
                d.receipt.lastAttention?.disposition === "handoff_unknown")
              ? "unknown"
              : d.receipt?.outcomeUnknown
                ? "outcome unknown"
                : "handoff unknown",
            "warning",
          ) +
          theme.fg("dim", " · ") +
          theme.fg("muted", "do not retry automatically")
        : undefined;
    const fields = (
      isPartial
        ? partial
        : failed
          ? "request failed"
          : polling
            ? "registered · no repeat poll"
            : resultLine(d, action)
    ).split(" · ");
    const separator = theme.fg("dim", " · ");
    const styleFields = (
      fields: string[],
      r = d.receipt,
      expandedDetail = false,
    ) =>
      fields
        .map((field, index) => {
          const color: ThemeColor = isPartial
            ? "muted"
            : failed && index === 0
              ? "error"
              : r && warnings(r).includes(field)
                ? "warning"
                : field === "no repeat poll"
                  ? "warning"
                  : index === 0 && r && field === activity(r)
                    ? stateColor(field)
                    : index === 0 && action === "cancel" && d.cancelChanged
                      ? "warning"
                      : r &&
                          (field === label(r.name) || field === r.failureCode)
                        ? expandedDetail
                          ? "text"
                          : "muted"
                        : "muted";
          return theme.fg(color, field);
        })
        .join(separator);
    const summary = styleFields(fields);
    const lines: string[] = [];
    if (expanded && polling && !failed && !isPartial)
      lines.push(theme.fg("text", polling));
    if (expanded && !failed && !isPartial) {
      if (action === "list")
        for (const r of d.receipts ?? [])
          lines.push(styleFields(jobLine(r, true).split(" · "), r, true));
      else if (d.receipt) {
        const r = d.receipt;
        lines.push(
          theme.fg("muted", "  job: ") +
            theme.fg("text", `${label(r.name)} (${label(r.id)})`),
        );
        if (action !== "get")
          lines.push(styleFields(jobLine(r).split(" · "), r, true));
        if (r.lastAttention)
          lines.push(
            theme.fg("muted", "  notification: ") +
              theme.fg("text", label(r.lastAttention.disposition)) +
              separator +
              theme.fg("muted", "admission: ") +
              theme.fg(
                "text",
                r.lastAttention.admitted ? "observed" : "not observed",
              ),
          );
      }
    }
    if (expanded && !isPartial)
      lines.push(
        ...expandedBodyResult(result).map((row) => theme.fg("text", row)),
      );
    return getResultTextComponent(
      ctx.lastComponent,
      [unknown ?? summary],
      lines,
    );
  },
};
