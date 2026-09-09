import type { ToolDefinition, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import { getTruncatedText, ELAPSED_THRESHOLD_MS } from "../_shared/render.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { active, label, type Receipt } from "./engine.ts";

export const PARAMETERS = Type.Object(
  {
    action: StringEnum(["start", "list", "get", "cancel"] as const),
    id: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 80,
        description: "Monitor ID; cancel also accepts all.",
      }),
    ),
    name: Type.Optional(
      Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" }),
    ),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    ),
    source: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 262144,
        description:
          'Async JavaScript body returning exactly {decision:"wait"|"notify", evidence: JSON}. Fresh code-mode child each poll; mcp.call and parallel available.',
      }),
    ),
    message: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 2000,
        pattern: "\\S",
        description: "Instruction to hand back when attention is needed.",
      }),
    ),
    interval_ms: Type.Optional(
      Type.Integer({ minimum: 1000, maximum: 3600000 }),
    ),
    timeout_ms: Type.Optional(
      Type.Integer({ minimum: 1000, maximum: 86400000 }),
    ),
    poll_timeout_ms: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 300000 }),
    ),
    failure_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { additionalProperties: false },
);

export function summary(r: Receipt) {
  return {
    id: r.id,
    name: r.name,
    state: r.state,
    notification: r.notification,
    polls: r.polls,
    failures: r.failures,
    deadline: r.deadline,
    inFlight: r.inFlight,
  };
}
export function notificationContent(r: Receipt): string {
  return [
    `Monitor ${r.id} (${label(r.name, 80)}): ${r.state}. Attention needed, not a success assertion.`,
    `Caller instruction: ${label(r.message, 2000)}`,
    `Accounting: ${r.polls} observations, ${r.calls} calls, ${r.failures}/${r.failureLimit} repeat-safe failures.`,
    ...(r.failure ? [`Host failure: ${JSON.stringify(r.failure)}`] : []),
    `Latest validated evidence from observation ${r.evidencePoll ?? "none"}:`,
    wrapUntrustedContent("monitor evidence", r.evidence ?? "null"),
    "Observation stopped. Cancellation is not rollback. Do not replay uncertain operations. Notification handed to Pi; consumption is not acknowledged.",
  ].join("\n");
}
export class WidgetObservations {
  private starts = new Map<string, { poll: number; at: number }>();

  update(receipts: Receipt[], now: number): void {
    const observing = receipts.filter((r) => r.state === "observing");
    const ids = new Set(observing.map((r) => r.id));
    for (const id of this.starts.keys())
      if (!ids.has(id)) this.starts.delete(id);
    for (const r of observing)
      if (this.starts.get(r.id)?.poll !== r.polls)
        this.starts.set(r.id, { poll: r.polls, at: now });
  }

  isLongPoll(r: Receipt, now: number): boolean {
    const start = this.starts.get(r.id);
    return (
      r.state === "observing" &&
      start?.poll === r.polls &&
      now - start.at >= ELAPSED_THRESHOLD_MS
    );
  }
}

export function widgetLines(
  receipts: Receipt[],
  now: number,
  width: number,
  theme: Pick<Theme, "fg">,
  observations = new WidgetObservations(),
): string[] {
  return receipts.filter(active).map((r) => {
    const status = observations.isLongPoll(r, now) ? "observing" : "active";
    const fields: string[] = [];
    if (r.failures)
      fields.push(
        theme.fg("warning", `failures ${r.failures}/${r.failureLimit}`),
      );
    if (r.state === "waiting")
      fields.push(
        theme.fg("muted", "next ") +
          theme.fg("text", formatWidgetCountdown(r.nextAt - now)),
      );
    fields.push(
      theme.fg("text", formatWidgetCountdown(r.deadline - now)) +
        theme.fg("muted", " left"),
    );
    return fitWidgetRow(
      theme.fg("muted", "monitor") + " " + theme.fg("accent", status),
      fields,
      width,
      theme.fg("dim", " · "),
      theme.fg("text", label(r.name, 80)),
    );
  });
}
export type ToolDetails = {
  monitorError?: boolean;
  action: string;
  status: string;
  receipts?: ReturnType<typeof summary>[];
};
export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS, ToolDetails>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("toolTitle", theme.bold("monitor")) +
        theme.fg(
          "muted",
          ` ${label(args.action, 16)} ${label(args.name ?? args.id, 80)}`.trimEnd(),
        ),
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, context) {
    const d = result.details;
    const failed = context.isError || d?.monitorError;
    const lines = [
      theme.fg(
        failed ? "error" : isPartial ? "warning" : "success",
        `${label(d?.action ?? context.args.action, 16)} · ${failed ? "failed" : isPartial ? "working" : label(d?.status, 120)}`,
      ),
    ];
    if (expanded && d?.receipts)
      for (const r of d.receipts)
        lines.push(
          label(
            `${r.id} ${r.name} · ${r.state} · ${r.notification} · ${r.polls} polls`,
            240,
          ),
        );
    return getTruncatedText(context.lastComponent, lines);
  },
};
