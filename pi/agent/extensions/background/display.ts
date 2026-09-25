import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Execution } from "./api.ts";

/** Presentation vocabulary only; persisted lifecycle values remain unchanged. */
export function executionState(status: string): [string, ThemeColor] {
  switch (status) {
    case "running":
      return ["running", "accent"];
    case "success":
      return ["succeeded", "success"];
    case "failed":
      return ["failed", "error"];
    case "cancelled":
      return ["canceled", "warning"];
    case "timeout":
      return ["timed out", "error"];
    case "interrupted":
      return ["interrupted", "warning"];
    default:
      return ["status unavailable", "muted"];
  }
}

export function executionWarnings(r: Partial<Execution>): [string, string][] {
  return [
    ...(r.outcomeUnknown
      ? [["effects unknown", "unknown"] as [string, string]]
      : r.effectsMayPersist && r.status !== "success"
        ? [["effects may persist", "effects?"] as [string, string]]
        : []),
    ...(r.persistenceFailed
      ? [["persistence failed", "persist failed"] as [string, string]]
      : []),
    ...(r.notification?.handoff === "unknown"
      ? [["handoff unknown", "handoff?"] as [string, string]]
      : []),
  ];
}

export function executionCounts(
  r: Execution,
  theme: Theme,
): string | undefined {
  const a = r.activity;
  if (a && a.canceled !== undefined) {
    const queued = a.queued ?? 0;
    return (
      (
        [
          [queued, "queued", "muted"],
          [a.started - a.completed - queued, "running", "muted"],
          [a.completed - a.failed, "done", "muted"],
          [a.failed - a.canceled, "failed", "muted"],
          [a.canceled, "canceled", "muted"],
        ] as const
      )
        .filter(([count]) => count > 0)
        .map(([count, name, color]) => theme.fg(color, `${count} ${name}`))
        .join(", ") || undefined
    );
  }
  // Historical receipts do not distinguish cancellation from failure.
  const completed = a?.completed ?? r.progress?.completed;
  const total = a?.started ?? r.progress?.total;
  const unsuccessful = a?.failed ?? r.progress?.failed ?? 0;
  return completed === undefined
    ? undefined
    : theme.fg("muted", `${completed}/${total} settled`) +
        (unsuccessful
          ? theme.fg("muted", `, ${unsuccessful} unsuccessful`)
          : "");
}

export function executionTokens(r: Execution): string | undefined {
  const result = r.result as any;
  const tokens =
    result?.accounting?.used ??
    result?.usage?.totalTokens ??
    r.activity?.totalTokens;
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return undefined;
  return `${tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens`;
}
