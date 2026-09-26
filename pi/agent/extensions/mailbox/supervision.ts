import { MailboxError } from "./store.ts";

export interface BatchPolicy {
  count: number;
  ageMs: number;
  reminderMs: number;
}
export const DEFAULT_BATCH_POLICY: Readonly<BatchPolicy> = Object.freeze({
  count: 3,
  ageMs: 60000,
  reminderMs: 300000,
});
export const policySchema = {
  type: "object",
  properties: {
    count: { type: "integer", minimum: 1, maximum: 1000 },
    ageMs: { type: "integer", minimum: 1000, maximum: 86400000 },
    reminderMs: { type: "integer", minimum: 1000, maximum: 86400000 },
  },
  additionalProperties: false,
};
export const checkpointSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        mailbox: {
          type: "string",
          pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$",
        },
        epoch: {
          type: "string",
          pattern: "^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$",
        },
        through: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        notifiedAt: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      required: ["mailbox", "epoch", "through", "notifiedAt"],
      additionalProperties: false,
    },
  ],
};
export interface BatchCheckpoint {
  mailbox: string;
  epoch: string;
  through: number;
  notifiedAt: number;
}
export function batchPolicy(input: Partial<BatchPolicy> = {}): BatchPolicy {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !Object.hasOwn(DEFAULT_BATCH_POLICY, k))
  )
    throw new MailboxError("invalid_input");
  const p = { ...DEFAULT_BATCH_POLICY, ...input };
  if (
    !Number.isSafeInteger(p.count) ||
    p.count < 1 ||
    p.count > 1000 ||
    !Number.isSafeInteger(p.ageMs) ||
    p.ageMs < 1000 ||
    p.ageMs > 86400000 ||
    !Number.isSafeInteger(p.reminderMs) ||
    p.reminderMs <= p.ageMs ||
    p.reminderMs > 86400000
  )
    throw new MailboxError("invalid_input");
  return p;
}

/** One immutable storage snapshot, no scheduler, acknowledgment, or retained host state. */
export function observeBatch(
  mailbox: string,
  snapshot:
    | { epoch: string; sequence: number; rows: { seq: number; at: number }[] }
    | undefined,
  previous: BatchCheckpoint | null,
  policy: Partial<BatchPolicy>,
  now: number,
) {
  const p = batchPolicy(policy);
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    (previous !== null &&
      (!previous ||
        typeof previous !== "object" ||
        Array.isArray(previous) ||
        Object.keys(previous).length !== 4 ||
        previous.mailbox !== mailbox ||
        typeof previous.epoch !== "string" ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(previous.epoch) ||
        !Number.isSafeInteger(previous.through) ||
        previous.through < 0 ||
        !Number.isSafeInteger(previous.notifiedAt) ||
        previous.notifiedAt < 0))
  )
    throw new MailboxError("invalid_input");
  const same = snapshot && previous?.epoch === snapshot.epoch;
  if (same && previous.through > snapshot.sequence)
    throw new MailboxError("invalid_input");
  const rows = snapshot?.rows ?? [];
  const fresh = rows.filter((row) => !same || row.seq > previous.through);
  const oldestNewAt = fresh.length ? Math.min(...fresh.map((r) => r.at)) : null;
  const reminder =
    same &&
    rows.length > fresh.length &&
    now - previous.notifiedAt >= p.reminderMs;
  const ready =
    fresh.length >= p.count ||
    (oldestNewAt !== null && now - oldestNewAt >= p.ageMs) ||
    reminder;
  // Every condition attention covers the entire snapshot, including old and new rows.
  // Later sends have larger sequence numbers; ACK never renumbers or hides them.
  const state =
    ready && snapshot
      ? {
          mailbox,
          epoch: snapshot.epoch,
          through: snapshot.sequence,
          notifiedAt: now,
        }
      : previous;
  return {
    decision: ready ? "wake" : "wait",
    evidence: {
      mailbox,
      pending: rows.length,
      fresh: fresh.length,
      oldestNewAt,
      reminder: !!reminder,
    },
    state,
  };
}
