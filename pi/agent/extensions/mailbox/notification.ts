import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

// Read only data properties: historical display metadata may be malformed.
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/** Display only: retain original untrusted model content; never ACK on rendering. */
export const mailboxNotification: MessageRenderer = (
  message,
  { expanded },
  theme,
) => ({
  invalidate() {},
  render(width) {
    const columns = Math.max(0, width);
    const raw =
      typeof message.content === "string"
        ? message.content
        : "Mailbox content unavailable";
    const safe = stripVTControlCharacters(raw.slice(0, 24000)).replace(
      /[\p{Cc}\p{Cf}]/gu,
      (c) => (c === "\n" ? c : " "),
    );
    const display = field(message.details, "display");
    const count = field(display, "count");
    const redelivered = field(display, "redelivered");
    const valid =
      field(display, "version") === 1 &&
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 1 &&
      count <= 20 &&
      typeof redelivered === "number" &&
      Number.isSafeInteger(redelivered) &&
      redelivered >= 0 &&
      redelivered <= count;
    let summary = theme.fg("muted", "status unavailable");
    if (valid) {
      const messages = `${count} message${count === 1 ? "" : "s"}`;
      summary =
        redelivered === count
          ? theme.fg("warning", `redelivered ${messages}`)
          : theme.fg("text", `received ${messages}`) +
            (redelivered > 0
              ? theme.fg("warning", ` (${redelivered} redelivered)`)
              : "");
    }
    const heading =
      theme.bold(theme.fg("toolTitle", "mailbox")) + " " + summary;
    const rows = expanded
      ? [
          heading,
          ...wrapTextWithAnsi(safe, Math.max(1, columns)),
          ...(raw.length > 24000 ? ["[display truncated]"] : []),
        ]
      : [heading];
    return rows.slice(0, 2000).map((row) => {
      const line = truncateToWidth(row, columns, "…");
      return theme.bg(
        "customMessageBg",
        line + " ".repeat(Math.max(0, columns - visibleWidth(line))),
      );
    });
  },
});
