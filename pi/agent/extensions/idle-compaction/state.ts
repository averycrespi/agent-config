import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const STATE_TYPE = "idle-compaction";
export type Outcome = "started" | "completed" | "failed" | "cancelled";
export type Attempt = {
  version: 1;
  kind: "attempt";
  conversationId: string;
  at: number;
  outcome: Outcome;
};
export type Override = { version: 1; kind: "override"; enabled: boolean };
export type RecordData = Attempt | Override;

export function conversationId(
  entries: readonly SessionEntry[],
): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (
      entry.type === "message" ||
      entry.type === "custom_message" ||
      entry.type === "branch_summary"
    )
      return entry.id;
  }
  return undefined;
}

export function restore(entries: readonly SessionEntry[]) {
  let override: boolean | undefined;
  let lastAttempt: Attempt | undefined;
  let valid = true;
  const attempted = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
    const value: unknown = entry.data;
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("kind" in value)
    ) {
      valid = false;
      continue;
    }
    if (
      value.kind === "override" &&
      "enabled" in value &&
      typeof value.enabled === "boolean"
    ) {
      override = value.enabled;
    } else if (
      value.kind === "attempt" &&
      "conversationId" in value &&
      typeof value.conversationId === "string" &&
      value.conversationId.length > 0 &&
      value.conversationId.length <= 128 &&
      "at" in value &&
      typeof value.at === "number" &&
      Number.isFinite(value.at) &&
      value.at >= 0 &&
      value.at <= 8.64e15 &&
      "outcome" in value &&
      ["started", "completed", "failed", "cancelled"].includes(
        String(value.outcome),
      )
    ) {
      const attempt = value as Attempt;
      attempted.add(attempt.conversationId);
      lastAttempt = { ...attempt };
    } else {
      valid = false;
    }
  }
  return { override, lastAttempt, attempted, valid };
}
