import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getTruncatedText, plural } from "../_shared/render.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { label, type Receipt } from "./contract.ts";
import { DEFAULT_CONFIG, type BackgroundConfig } from "./config.ts";
const finite = (max: number) =>
  Type.Optional(Type.Integer({ minimum: 1000, maximum: max }));
export const parameters = (
  config: Readonly<BackgroundConfig> = DEFAULT_CONFIG,
) =>
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
      cycle_timeout_ms: finite(config.maxCycleTimeoutMs),
      lifetime_ms: finite(config.maxLifetimeMs),
      max_wakes: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      recurring: Type.Optional(Type.Boolean()),
      interval_ms: finite(config.maxCycleTimeoutMs),
      delay_ms: finite(config.maxCycleTimeoutMs),
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
export interface DisplayDetails {
  backgroundError?: boolean;
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
    return `${reasons[r.attention.reason] ?? "attention"} · follow-up queued`;
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
function warnings(r: DisplayReceipt): string[] {
  return [
    ...(r.outcomeUnknown ? ["effects uncertain"] : []),
    ...(r.lastAttention?.disposition === "handoff_unknown"
      ? ["handoff uncertain"]
      : []),
  ];
}
function jobLine(r: DisplayReceipt): string {
  return [
    label(r.name),
    activity(r),
    ...warnings(r),
    ...(r.failureCode ? [label(r.failureCode)] : []),
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
        : `scheduled · in ${duration(r.delayMs)}`
      : r.intervalMs !== undefined
        ? `polling every ${duration(r.intervalMs)}${r.eventCount ? " + events" : ""}`
        : r.eventCount
          ? "watching events"
          : "registered";
  return [
    label(r.name),
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
      label(r.name),
      d.cancelChanged ? "cancelled" : `already ${label(r.status)}`,
      ...warnings(r),
      ...(r.lastAttention?.disposition === "handed_to_pi"
        ? ["follow-up already handed off"]
        : []),
      ...(r.effectsMayPersist && !r.outcomeUnknown
        ? ["effects may persist"]
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
    let state = activity(r);
    const fields: string[] = warnings(r).map((s) => theme.fg("warning", s));
    if (!pending && !r.awaitingSettlement) {
      if (!r.inFlight && r.nextAt !== undefined) {
        if (r.delayMs !== undefined)
          state = `continue in ${formatWidgetCountdown(r.nextAt - now)}`;
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
    // Drop the redundant extension prefix before squeezing away job identity.
    const prefix =
      width >= 60 ? `${theme.fg("muted", "background")}${separator}` : "";
    const primary = theme.fg(color, state);
    // Reserve identity and the primary state before optional telemetry.
    while (
      fields.length &&
      visibleWidth(
        `${prefix}${label(r.name).slice(0, 16)}${separator}${primary}${separator}${fields.join(separator)}`,
      ) > width
    )
      fields.pop();
    const nameWidth = Math.max(
      1,
      width -
        visibleWidth(
          `${prefix}${separator}${[primary, ...fields].join(separator)}`,
        ),
    );
    return fitWidgetRow(
      `${prefix}${truncateToWidth(name, nameWidth, "…")}`,
      [primary, ...fields],
      width,
      separator,
    );
  });
}
export function notificationContent(
  r: Receipt,
  message: string,
  now = Date.now(),
) {
  return `${message}\n\nBackground attention: ${r.lastAttention?.reason}. This is not watched-condition success/failure or acknowledgment of model consumption. Recurrence ${r.status === "active" && r.recurring ? "remains enabled" : "disabled"}. Inspect background get; cancel when no further work is authorized.\n${wrapUntrustedContent("BACKGROUND EVIDENCE", JSON.stringify({ id: r.id, reason: r.lastAttention?.reason, latestCommittedEvidence: r.evidence, evidenceAgeMs: r.evidenceAt === undefined ? null : Math.max(0, now - r.evidenceAt), gap: r.gap, interrupted: r.interrupted, failureCode: r.failureCode, effectsMayPersist: r.effectsMayPersist, outcomeUnknown: r.outcomeUnknown }))}`;
}
export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, ctx) {
    return getTruncatedText(ctx.lastComponent, [
      `${theme.fg("toolTitle", theme.bold("background"))} ${theme.fg("muted", label(args.action, 16))} ${theme.fg("text", label(args.name ?? args.id))}`,
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, ctx) {
    const d = (result.details ?? {}) as DisplayDetails;
    const action = label(d.action ?? ctx.args?.action, 16);
    const failed = ctx.isError || d.backgroundError;
    const target = label(d.receipt?.name ?? ctx.args?.name ?? ctx.args?.id);
    const reason =
      d.receipt?.attention?.reason ?? d.receipt?.lastAttention?.reason;
    const jobFailed =
      d.receipt?.outcomeUnknown ||
      d.receipt?.lastAttention?.disposition === "handoff_unknown" ||
      reason === "evaluation_failure" ||
      reason === "coverage_failure";
    const caution =
      d.receipt &&
      (d.receipt.failureCode ||
        reason === "timeout" ||
        d.receipt.attention?.disposition === "pending");
    const partial =
      action === "start"
        ? "registering…"
        : action === "cancel"
          ? "cancelling…"
          : action === "list"
            ? "listing jobs…"
            : "reading job…";
    const lines = [
      theme.fg(
        isPartial
          ? "warning"
          : failed || jobFailed
            ? "error"
            : caution
              ? "warning"
              : "success",
        isPartial
          ? partial
          : failed
            ? ["background", action, target, "request failed"]
                .filter(Boolean)
                .join(" · ")
            : resultLine(d, action),
      ),
    ];
    if (expanded && !failed && !isPartial) {
      if (action === "list")
        for (const r of d.receipts ?? []) lines.push(jobLine(r));
      else if (d.receipt) {
        const r = d.receipt;
        lines.push(`job ${label(r.id)}`);
        if (action !== "get") lines.push(jobLine(r));
        if (r.effectsMayPersist)
          lines.push(
            "Dispatched effects may persist; cancellation is not rollback.",
          );
        if (r.lastAttention)
          lines.push(
            `follow-up ${label(r.lastAttention.disposition)} · admission ${r.lastAttention.admitted ? "observed" : "not observed"}`,
          );
      }
    }
    return getTruncatedText(ctx.lastComponent, lines);
  },
};
