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
  total?: number;
  mode?: "timer" | "observation";
}

const EXECUTION: Record<string, [string, ThemeColor]> = {
  success: ["succeeded", "success"],
  failed: ["failed", "error"],
  timeout: ["timed out", "warning"],
  cancelled: ["canceled", "warning"],
  interrupted: ["interrupted", "warning"],
};
const OBSERVATION: Record<string, [string, ThemeColor]> = {
  condition: ["condition", "warning"],
  timeout: ["timed out", "warning"],
  evaluation_failure: ["evaluation failed", "error"],
  coverage_failure: ["coverage lost", "error"],
  budget_exhausted: ["budget exhausted", "warning"],
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

export function executionType(owner: string, total?: unknown): string {
  if (owner === "subagents") return total === 1 ? "subagent" : "subagents";
  return owner === "script" || owner === "workflow" ? owner : "execution";
}

/** Pure TUI projection: no host callbacks, receipts, fetching, timers or mutations. */
export function notificationRenderer(
  source: "background" | "monitor",
): MessageRenderer {
  return (message, { expanded }, theme) => {
    const details = message.details;
    const candidate = field(details, "display");
    const display = field(candidate, "version") === 1 ? candidate : undefined;
    const id = safeText(
      field(details, source === "background" ? "executionId" : "jobId"),
      200,
    );
    const name = safeText(field(display, "name"), 200);
    const owner = safeText(field(display, "owner"), 48);
    const type =
      source === "monitor"
        ? "monitor"
        : executionType(owner, field(display, "total"));
    const status = field(display, "status");
    const vocabulary = source === "background" ? EXECUTION : OBSERVATION;
    const optional = (key: string, type: string) =>
      field(display, key) === undefined || typeof field(display, key) === type;
    const total = field(display, "total");
    const mode = field(display, "mode");
    const dataOnly =
      display &&
      typeof display === "object" &&
      !Array.isArray(display) &&
      [
        "name",
        "status",
        "owner",
        "outcomeUnknown",
        "effectsMayPersist",
        "interrupted",
        "gap",
        "total",
        "mode",
      ].every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(display, key);
        return !descriptor || "value" in descriptor;
      });
    const valid =
      dataOnly &&
      typeof field(display, "name") === "string" &&
      typeof status === "string" &&
      Object.hasOwn(vocabulary, status) &&
      optional("owner", "string") &&
      ["outcomeUnknown", "effectsMayPersist", "interrupted", "gap"].every(
        (key) => optional(key, "boolean"),
      ) &&
      (total === undefined ||
        (typeof total === "number" &&
          Number.isSafeInteger(total) &&
          total >= 0)) &&
      (mode === undefined || mode === "timer" || mode === "observation");
    const [outcome, color] = valid
      ? vocabulary[status as string]
      : ["status unavailable", "muted" as const];
    const reason =
      valid &&
      source === "monitor" &&
      status === "condition" &&
      field(display, "mode") === "timer"
        ? "timer elapsed"
        : outcome;
    const warnings = [
      ...(field(display, "outcomeUnknown") === true ? ["effects unknown"] : []),
      ...(field(display, "interrupted") === true && status !== "interrupted"
        ? ["interrupted"]
        : []),
      ...(field(display, "gap") === true ? ["coverage gap"] : []),
      ...(field(display, "effectsMayPersist") === true &&
      !(source === "background" && valid && status === "success") &&
      field(display, "outcomeUnknown") !== true
        ? ["effects may persist"]
        : []),
    ];
    return {
      invalidate() {},
      render(width) {
        const w = Math.max(0, Math.floor(width));
        const separator = " ";
        const title = theme.fg("toolTitle", theme.bold(type));
        const state =
          source === "monitor" && valid ? `attention ${reason}` : reason;
        let prefix = `${title} ${theme.fg(color, state)}`;
        let essential =
          prefix +
          (warnings.length
            ? separator + theme.fg("warning", `(${warnings.join("; ")})`)
            : "");
        if (visibleWidth(essential) > w) {
          const compactWarnings: Record<string, string> = {
            "effects unknown": "unknown",
            interrupted: "interrupted",
            "coverage gap": "gap",
            "effects may persist": "effects?",
          };
          // At narrow widths preserve every warning before optional identity.
          const shortReason = reason
            .replace("evaluation", "eval")
            .replace("budget exhausted", "budget")
            .replace("timed out", "timeout");
          prefix = `${title} ${theme.fg(color, shortReason)}`;
          essential =
            prefix +
            (warnings.length
              ? separator +
                theme.fg(
                  "warning",
                  warnings.map((s) => compactWarnings[s]).join("/"),
                )
              : "");
        }
        const fit = (text: string) => {
          const line = truncateToWidth(text, w).replace(
            /\x1b\[0m/g,
            "\x1b[22;23;24;25;27;28;29;39m",
          );
          return theme.bg(
            "customMessageBg",
            line + " ".repeat(Math.max(0, w - visibleWidth(line))),
          );
        };
        const identity =
          name && w - visibleWidth(essential) >= 8
            ? separator +
              theme.fg(
                "text",
                truncateToWidth(name, w - visibleWidth(essential) - 1),
              )
            : "";
        const lines = [
          fit(
            source === "background"
              ? prefix + identity + essential.slice(prefix.length)
              : essential + identity,
          ),
        ];
        if (!expanded) return lines;
        // Plain text only: expansion never interprets terminal links or fetches references.
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n");
        const context = [
          ["Name", name],
          ["ID", id],
          ["Adapter", owner],
          ["Status", state],
          ["Warnings", warnings.join("; ")],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => `${label}: ${value}`)
          .join("\n");
        const text = [context, safeText(content, MAX_TEXT, true)]
          .filter(Boolean)
          .join("\n");
        const rows = w > 0 ? wrapTextWithAnsi(text, w) : [""];
        lines.push(
          ...rows.slice(0, MAX_ROWS).map((line) => fit(theme.fg("text", line))),
        );
        if (content.length > MAX_TEXT || rows.length > MAX_ROWS) {
          lines.push(
            ...wrapTextWithAnsi(
              "Display truncated; complete message remains in session/model context.",
              Math.max(1, w),
            ).map((line) => fit(theme.fg("warning", line))),
          );
        }
        return lines;
      },
    };
  };
}
