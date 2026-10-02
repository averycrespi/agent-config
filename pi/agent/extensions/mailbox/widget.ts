import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import type { DeliveryStatus } from "./delivery.ts";
export function mailboxLine(
  s: DeliveryStatus,
  now: number,
  width: number,
  theme: Theme,
  queued = 0,
) {
  const state = s.unavailable
    ? "unavailable"
    : s.pending || queued
      ? "pending"
      : "listening";
  const head =
    theme.fg("muted", "mailbox") +
    " " +
    theme.fg(
      s.unavailable ? "error" : s.pending || queued ? "warning" : "accent",
      state,
    );
  const fields: string[] = [];
  const queuedField = queued
    ? theme.fg("warning", "queued for agent")
    : undefined;
  if (s.unavailable) {
    if (queuedField) fields.push(queuedField);
    fields.push(theme.fg("muted", "/mailbox"));
  } else {
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
    if (queuedField) fields.push(queuedField);
    const wake =
      s.wakeAt !== undefined && s.wakeAt <= now
        ? theme.fg(
            "warning",
            s.hold === "draft" || s.hold === "dialog"
              ? `wake held: ${s.hold}`
              : "wake pending",
          )
        : undefined;
    const count = theme.fg(
      s.pending ? "text" : "muted",
      s.pending ? `${s.pending} unacked` : "empty",
    );
    // Reserve held/pending delivery ahead of counts under width pressure, but
    // keep the ordinary count-first grammar when the complete row fits.
    if (wake) fields.push(wake);
    fields.push(count);
    if (s.wakeAt !== undefined && s.wakeAt > now)
      fields.push(
        theme.fg("muted", "wake in ") +
          theme.fg("text", formatWidgetCountdown(s.wakeAt - now)),
      );
    else if (!queued && s.wakeAt === undefined && s.redeliveryAt !== undefined)
      fields.push(
        theme.fg("muted", "redelivery in ") +
          theme.fg("text", formatWidgetCountdown(s.redeliveryAt - now)),
      );
    if (wake && visibleWidth([head, ...fields].join(" · ")) <= width) {
      const index = fields.indexOf(wake);
      fields.splice(index, 2, count, wake);
    }
  }
  return fitWidgetRow(head, fields, width, theme.fg("dim", " · "));
}
