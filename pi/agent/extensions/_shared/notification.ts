import type {
  MessageRenderer,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

/** Display-only snapshot. Never use this metadata for delivery or acknowledgment. */
export interface NotificationDisplay {
  version: 1;
  name: string;
  status?: string;
  owner?: string;
  outcomeUnknown?: boolean;
  effectsMayPersist?: boolean;
  interrupted?: boolean;
  gap?: boolean;
}

const EXECUTION: Record<string, [string, ThemeColor]> = {
  success: ["execution succeeded", "success"],
  failed: ["execution failed", "error"],
  timeout: ["execution timed out", "warning"],
  cancelled: ["execution cancelled", "muted"],
  interrupted: ["execution interrupted", "warning"],
};
const OBSERVATION: Record<string, [string, ThemeColor]> = {
  condition: ["condition attention", "warning"],
  timeout: ["observation timed out", "warning"],
  evaluation_failure: ["evaluation failed", "error"],
  coverage_failure: ["coverage lost", "error"],
  budget_exhausted: ["observation budget exhausted", "warning"],
};
const MAX_TEXT = 64_000;
const MAX_ROWS = 2_000;

// Historical JSON may be malformed. Inspect data fields only, not accessors.
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
function safeText(value: unknown, limit: number, multiline = false): string {
  if (typeof value !== "string") return "";
  return stripVTControlCharacters(value.slice(0, limit))
    .replace(multiline ? /[^\S\n]+/gu : /\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (multiline && c === "\n" ? c : " "))
    .trim();
}

/** Pure TUI projection: no host callbacks, receipts, fetching, timers or mutations. */
export function notificationRenderer(
  source: "background" | "monitor",
): MessageRenderer {
  return (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    const candidate = field(details, "display");
    const display = field(candidate, "version") === 1 ? candidate : undefined;
    const id = safeText(
      field(details, source === "background" ? "executionId" : "jobId"),
      200,
    );
    const name = safeText(field(display, "name"), 200);
    const owner = safeText(field(display, "owner"), 48);
    const status = field(display, "status");
    const vocabulary = source === "background" ? EXECUTION : OBSERVATION;
    const [outcome, color] =
      typeof status === "string" && Object.hasOwn(vocabulary, status)
        ? vocabulary[status]
        : ["notification · status unavailable", "muted" as const];
    const warnings = [
      ...(field(display, "outcomeUnknown") === true ? ["effects unknown"] : []),
      ...(field(display, "interrupted") === true && status !== "interrupted"
        ? ["interrupted"]
        : []),
      ...(field(display, "gap") === true ? ["coverage gap"] : []),
      ...(field(display, "effectsMayPersist") === true &&
      field(display, "outcomeUnknown") !== true
        ? ["effects may persist"]
        : []),
    ];
    const identity = [name, id.slice(0, 8)].filter(Boolean).join(" · ");
    return {
      invalidate() {},
      render(width) {
        const w = Math.max(0, Math.floor(width));
        const pad = Math.min(
          Math.max(0, outputPad ?? 0),
          Math.max(0, Math.floor((w - 32) / 2)),
        );
        const available = w - pad * 2;
        const fit = (s: string) =>
          " ".repeat(pad) + truncateToWidth(s, available);
        const separator = theme.fg("dim", " · ");
        const lines = [
          fit(
            theme.fg("toolTitle", theme.bold(source)) +
              (identity ? separator + theme.fg("text", identity) : ""),
          ),
          fit(theme.fg(color, outcome)),
        ];
        if (warnings.length) {
          const full = warnings.join(" · ");
          // All supplied warnings fit at 32 columns; do not hide a coverage gap
          // behind effect uncertainty or interruption when the row is narrow.
          const compact = warnings
            .map((warning) =>
              warning === "coverage gap"
                ? "gap"
                : warning === "effects may persist"
                  ? "effects possible"
                  : warning,
            )
            .join("/");
          lines.push(
            fit(
              theme.fg(
                "warning",
                visibleWidth(full) <= available ? full : compact,
              ),
            ),
          );
        }
        if (!expanded) return lines;
        // Text only: never interpret terminal links, images, Markdown HTML or escape sequences.
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("\n");
        const context = [
          ["Name", name],
          ["ID", id],
          ["Adapter", owner],
          ...(warnings.length ? [["Warnings", warnings.join(" · ")]] : []),
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => `${label}: ${value}`)
          .join("\n");
        const text = [context, safeText(content, MAX_TEXT, true)]
          .filter(Boolean)
          .join("\n");
        const rows = available > 0 ? wrapTextWithAnsi(text, available) : [""];
        const truncated = content.length > MAX_TEXT || rows.length > MAX_ROWS;
        lines.push(
          ...rows.slice(0, MAX_ROWS).map((line) => fit(theme.fg("text", line))),
        );
        if (truncated) {
          lines.push(
            ...wrapTextWithAnsi(
              "Display truncated; complete message remains in session/model context.",
              Math.max(1, available),
            ).map((line) => fit(theme.fg("warning", line))),
          );
        }
        return lines;
      },
    };
  };
}
