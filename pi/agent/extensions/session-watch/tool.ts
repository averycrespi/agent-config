import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getTruncatedText } from "../_shared/render.ts";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { EVENTS } from "./events.ts";
import { label, type Receipt } from "./engine.ts";

export const PARAMETERS = Type.Object(
  {
    action: StringEnum(["start", "list", "get", "cancel"]),
    target: Type.Optional(
      Type.String({
        description: "Exact target incarnation UUID from list",
        maxLength: 36,
      }),
    ),
    name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 80,
        description: "Optional nonsecret display label",
      }),
    ),
    events: Type.Optional(
      Type.Array(StringEnum(EVENTS), {
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
      }),
    ),
    timeout_ms: Type.Optional(
      Type.Integer({ minimum: 1000, maximum: 86400000 }),
    ),
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    id: Type.Optional(Type.String({ maxLength: 36 })),
  },
  { additionalProperties: false },
);

export function widgetLines(
  receipts: Receipt[],
  now: number,
  width: number,
  theme: Theme,
) {
  return receipts
    .filter((r) => r.state === "active")
    .map((r) =>
      fitWidgetRow(
        theme.fg("muted", "watcher") + " " + theme.fg("accent", "active"),
        [
          theme.fg("text", formatWidgetCountdown(r.deadline - now)) +
            theme.fg("muted", " left"),
        ],
        width,
        theme.fg("dim", " · "),
        theme.fg("text", label(r.name)) +
          theme.fg("dim", " · ") +
          theme.fg("muted", r.events.join(", ")),
      ),
    );
}
export function notificationContent(receipt: Receipt, message: string) {
  return `Session watch needs attention, not proof of task completion or green CI. User attention grants no permission to answer. Notification admission is not consumption.\n${wrapUntrustedContent("session-watch receipt", JSON.stringify(receipt))}\nCaller follow-up instruction:\n${message}`;
}
export const renderers = {
  renderCall(args: { action?: string }, theme: Theme, context: any) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("toolTitle", theme.bold("session_watch")) +
        " " +
        theme.fg("muted", label(args.action, 16)),
    ]);
  },
  renderResult(
    result: any,
    options: { expanded: boolean; isPartial?: boolean },
    theme: Theme,
    context: any,
  ) {
    const error = context.isError || result.details?.watchError;
    const status = options.isPartial
      ? "registering"
      : error
        ? "invalid request or unavailable"
        : label(result.details?.status, 100) || "settled";
    const lines = [
      theme.fg(
        error ? "error" : options.isPartial ? "warning" : "success",
        `session_watch ${label(context.args?.action, 16)} · ${status}`,
      ),
    ];
    if (options.expanded && !options.isPartial)
      for (const r of result.details?.receipts ?? [])
        lines.push(label(`${r.id} · ${r.state} · ${r.notification}`, 160));
    return getTruncatedText(context.lastComponent, lines);
  },
};
