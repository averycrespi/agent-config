import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import {
  getResultText,
  getTruncatedText,
  plural,
  toolCall,
  outcomeSections,
} from "../_shared/render.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import type { Message } from "./store.ts";

interface ToolRenderContext {
  args: unknown;
  lastComponent?: unknown;
  isError?: boolean;
}

// Bound before sanitizing, then remove controls that can alter terminal layout.
function label(value: unknown, limit = 100): string {
  if (typeof value !== "string") return "";
  const text = stripVTControlCharacters(value.slice(0, limit))
    .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text + (value.length > limit ? " [truncated]" : "");
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const count = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0;
function message(value: unknown): value is Message {
  const m = record(value);
  return (
    typeof m.id === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(m.id) &&
    count(m.at) &&
    m.at <= 8.64e15 &&
    typeof m.type === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(m.type) &&
    typeof m.message === "string" &&
    m.message.length <= 8192
  );
}

// Read only the exact existing direct-tool frame. Never reinterpret report bodies.
function payload(result: AgentToolResult<unknown>): Record<string, unknown> {
  const text = getResultText(result);
  if (text.length > 24000) return {};
  const frame = wrapUntrustedContent("MAILBOX RESULT", "\0").split("\0");
  if (!text.startsWith(frame[0]) || !text.endsWith(frame[1])) return {};
  try {
    return record(JSON.parse(text.slice(frame[0].length, -frame[1].length)));
  } catch {
    return {};
  }
}
const failures: Record<string, string> = {
  invalid_input: "Failed: invalid input",
  storage_failed: "Failed: storage unavailable",
  mailbox_full: "Failed: mailbox full",
  publication_unknown: "publication uncertain; no replay",
};

export function renderMailboxCall(
  args: Record<string, unknown>,
  theme: Theme,
  context: ToolRenderContext,
) {
  const action = ["send", "list", "ack"].includes(String(args.action))
    ? args.action
    : "";
  return getTruncatedText(context.lastComponent, [
    toolCall(theme, "mailbox", action, label(args.mailbox, 80)),
  ]);
}

export function renderMailboxResult(
  result: AgentToolResult<unknown>,
  { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: ToolRenderContext,
) {
  const args = record(context.args);
  const value = payload(result);
  const details = record(result.details);
  const lines: string[] = [];
  const add = (text: string) => lines.push(theme.fg("muted", text));
  const finish = (
    summary: string | string[],
    color: "muted" | "success" | "warning" | "error",
  ) =>
    getTruncatedText(context.lastComponent, [
      outcomeSections(
        theme,
        Array.isArray(summary) ? summary : [summary],
        color,
      ),
      ...lines,
    ]);
  const error = details.error ?? value.error;
  if (
    context.isError ||
    error ||
    details.outcomeUnknown ||
    value.outcomeUnknown
  ) {
    const code =
      details.outcomeUnknown || value.outcomeUnknown
        ? "publication_unknown"
        : typeof error === "string"
          ? error
          : getResultText(result)
              .trim()
              .replace(/^Error: /, "");
    if (expanded)
      add(
        `Untrusted diagnostic: ${label(typeof error === "string" ? error : getResultText(result), 600)}`,
      );
    return finish(
      Object.hasOwn(failures, code)
        ? failures[code]
        : "Failed: mailbox operation",
      "error",
    );
  }
  if (isPartial) {
    return finish(
      args.action === "send"
        ? "Sending..."
        : args.action === "ack"
          ? "Acknowledging..."
          : args.action === "list"
            ? "Listing..."
            : "Working...",
      "warning",
    );
  }
  const showMessage = (m: Message, previewLimit: number) => {
    add(
      `${m.id.slice(0, 8)} | ${label(m.type)} | ${new Date(m.at).toISOString()}`,
    );
    add(`ID: ${m.id}`);
    add(`Untrusted message: ${label(m.message, previewLimit)}`);
  };
  if (args.action === "send" && message(value)) {
    if (expanded) {
      add("Persisted, not consumed, accepted or completed.");
      showMessage(value, 1200);
    }
    return finish(`persisted ${label(value.type)} (not consumed)`, "success");
  }
  if (
    args.action === "list" &&
    value.mailbox === args.mailbox &&
    count(value.pending) &&
    value.pending <= 1000 &&
    Array.isArray(value.messages) &&
    value.messages.length <= 50 &&
    value.messages.every(message) &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  ) {
    const shown = value.messages.length;
    if (expanded) {
      add("Shown counts this page; pending counts the current inbox.");
      add(
        value.nextCursor
          ? "More pages remain in this scan; later arrivals require a fresh scan."
          : "Scan complete; start a fresh scan for later arrivals.",
      );
      for (const m of value.messages) showMessage(m, 240);
    }
    return finish(
      shown === 0 && value.pending === 0
        ? "No pending messages"
        : [
            `${shown} shown`,
            `${value.pending} pending`,
            value.nextCursor ? "more pages" : "scan complete",
          ],
      "muted",
    );
  }
  if (
    args.action === "ack" &&
    value.mailbox === args.mailbox &&
    count(value.acknowledged) &&
    Array.isArray(args.ids) &&
    args.ids.length <= 100 &&
    value.acknowledged <= args.ids.length
  ) {
    const n = value.acknowledged;
    const requested = args.ids.length;
    if (expanded) {
      add(`Acknowledged ${n} of ${requested} requested`);
      if (requested > n)
        add(
          `${plural(requested - n, "requested ID")} ${requested - n === 1 ? "was" : "were"} not pending.`,
        );
      add(
        "Count only; removed IDs are not identified. Ack is not task resolution.",
      );
      for (const id of args.ids) add(`Requested ID: ${label(id, 80)}`);
    }
    return finish(
      n
        ? `acknowledged ${plural(n, "message")} (not task resolution)`
        : `No messages acknowledged (${requested} requested)`,
      "success",
    );
  }
  if (expanded)
    add("No recognized mailbox result; inspect the underlying tool result.");
  return finish("Failed: unrecognized mailbox result", "error");
}
