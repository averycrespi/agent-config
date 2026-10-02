import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitWidgetRow, formatWidgetCountdown } from "../_shared/widget.ts";
import type { NotificationHold } from "../_shared/notification-delivery.ts";
import type { DeliveryStatus } from "./delivery.ts";
export function mailboxLine(
  s: DeliveryStatus,
  now: number,
  width: number,
  theme: Theme,
  queued = 0,
  hold?: NotificationHold,
) {
  const head = theme.fg("muted", "mailbox");
  const separator = theme.fg("dim", " · ");
  const count = theme.fg(
    s.unavailable ? "error" : "text",
    s.unavailable
      ? "unavailable"
      : s.pending
        ? `${s.pending} unacked`
        : "empty",
  );
  const warnings: string[] = [];
  const waits: string[] = [];
  if (!s.unavailable) {
    if (s.limited)
      warnings.push(theme.fg("warning", `${s.limited} at delivery limit`));
    if (s.uncertain) warnings.push(theme.fg("warning", "delivery uncertain"));
    if (s.wakeAt !== undefined && s.wakeAt <= now) {
      const reason = hold ?? s.hold;
      waits.push(
        theme.fg(
          "muted",
          reason === "draft" || reason === "dialog" || reason === "input"
            ? `waiting for ${reason}`
            : reason === "unavailable"
              ? "delivery held"
              : "delivery pending",
        ),
      );
    }
    if (s.wakeAt !== undefined && s.wakeAt > now)
      waits.push(
        theme.fg("muted", "delivery in ") +
          theme.fg("text", formatWidgetCountdown(s.wakeAt - now)),
      );
    else if (!queued && s.wakeAt === undefined && s.redeliveryAt !== undefined)
      waits.push(
        theme.fg("muted", "redelivery in ") +
          theme.fg("text", formatWidgetCountdown(s.redeliveryAt - now)),
      );
  }
  if (queued) waits.push(theme.fg("muted", "queued for agent"));
  const fields = [...warnings, ...waits];
  const full =
    head + " " + count + fields.map((field) => separator + field).join("");
  if (visibleWidth(full) <= width) return full;
  // Preserve actionable warnings before optional count/clock detail under pressure.
  return fitWidgetRow(
    head + (s.unavailable ? " " + count : ""),
    [...fields, ...(!s.unavailable ? [count] : [])],
    width,
    separator,
  );
}
