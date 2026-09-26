import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

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
    const heading =
      theme.bold(theme.fg("toolTitle", "mailbox")) +
      " " +
      theme.fg("warning", "messages") +
      theme.fg("muted", " untrusted");
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
