import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getTruncatedText } from "../_shared/render.ts";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { label, type Receipt } from "./contract.ts";
const finite = (max: number) =>
  Type.Optional(Type.Integer({ minimum: 1000, maximum: max }));
export const PARAMETERS = Type.Object(
  {
    action: StringEnum(["start", "list", "get", "cancel"] as const),
    id: Type.Optional(Type.String()),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    providers: Type.Optional(
      Type.Array(Type.String(), { maxItems: 32, uniqueItems: true }),
    ),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 237568 })),
    cycle_timeout_ms: finite(1500000),
    lifetime_ms: finite(86400000),
    max_wakes: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    recurring: Type.Optional(Type.Boolean()),
    interval_ms: finite(1500000),
    delay_ms: finite(1500000),
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
  };
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
    const state = pending
      ? `${r.attention!.reason} awaiting settlement`
      : r.awaitingSettlement
        ? "awaiting settlement"
        : "active";
    const color = pending
      ? r.attention!.reason.includes("failure")
        ? "error"
        : "warning"
      : "accent";
    return fitWidgetRow(
      `${theme.fg("muted", "background")} ${theme.fg(color, state)}`,
      [
        theme.fg("muted", r.awaitingSettlement ? "lifetime " : "wake ") +
          theme.fg(
            "text",
            formatWidgetCountdown(
              (r.awaitingSettlement
                ? r.deadline
                : Math.min(r.cycleDeadline, r.deadline, r.nextAt ?? Infinity)) -
                now,
            ),
          ),
      ],
      width,
      theme.fg("dim", " · "),
      theme.fg("text", label(r.name)),
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
    const d = result.details as
      | { backgroundError?: boolean; status?: string; receipts?: Receipt[] }
      | undefined;
    const failed = ctx.isError || d?.backgroundError;
    const lines = [
      theme.fg(
        isPartial ? "warning" : failed ? "error" : "success",
        isPartial
          ? "registering…"
          : failed
            ? "background request failed"
            : label(d?.status, 120),
      ),
    ];
    if (expanded)
      for (const r of d?.receipts ?? [])
        lines.push(
          `${label(r.name)} · ${label(r.status)} · ${r.wakes}/${r.maxWakes} wakes`,
        );
    return getTruncatedText(ctx.lastComponent, lines);
  },
};
