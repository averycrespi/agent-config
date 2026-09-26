import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import type { DeliveryStatus } from "./delivery.ts";
export function mailboxLine(
  s: DeliveryStatus,
  now: number,
  width: number,
  theme: Theme,
) {
  const state = s.unavailable
    ? "unavailable"
    : s.pending
      ? "pending"
      : "listening";
  const head =
    theme.fg("muted", "mailbox") +
    " " +
    theme.fg(s.unavailable ? "error" : s.pending ? "warning" : "accent", state);
  const fields: string[] = [];
  if (s.unavailable) fields.push(theme.fg("muted", "/mailbox"));
  else {
    if (s.limited)
      fields.push(
        theme.fg(
          "warning",
          s.limited === s.pending
            ? "delivery limit reached"
            : `${s.limited} at limit`,
        ),
      );
    if (s.uncertain) fields.push(theme.fg("warning", "handoff uncertain"));
    fields.push(
      theme.fg(
        s.pending ? "text" : "muted",
        s.pending ? `${s.pending} unacked` : "empty",
      ),
    );
    let meta = "";
    if (s.wakeAt !== undefined)
      meta =
        s.wakeAt > now
          ? `wake in ${formatWidgetCountdown(s.wakeAt - now)}`
          : s.hold === "draft" || s.hold === "dialog"
            ? `held: ${s.hold}`
            : "awaiting idle";
    else if (s.redeliveryAt !== undefined)
      meta = `redelivery in ${formatWidgetCountdown(s.redeliveryAt - now)}`;
    if (meta) fields.push(theme.fg("muted", meta));
  }
  return fitWidgetRow(head, fields, width, theme.fg("dim", " · "));
}
