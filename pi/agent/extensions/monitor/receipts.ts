import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Receipt } from "./engine.ts";

export const RECEIPT_TYPE = "monitor:receipt-v1";
export const MAX_RECOVERY_ENTRIES = 4096;

/** Avoid materializing Pi's entire branch before applying the recovery cap. */
export function readReceiptBranch(
  manager: Pick<ExtensionContext["sessionManager"], "getLeafId" | "getEntry">,
) {
  const entries = [];
  let id = manager.getLeafId();
  while (id && entries.length < MAX_RECOVERY_ENTRIES) {
    const entry = manager.getEntry(id);
    if (!entry) break;
    entries.push(entry);
    id = entry.parentId;
  }
  return entries.reverse();
}
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const text = (maxLength: number) => Type.String({ maxLength });
const schema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
    name: text(80),
    description: text(200),
    message: text(2000),
    state: Type.Union(
      [
        "waiting",
        "observing",
        "condition",
        "deadline",
        "failure_limit",
        "unsafe_failure",
        "cancelled",
        "invalidated",
      ].map((s) => Type.Literal(s)),
    ),
    notification: Type.Union(
      ["none", "pending", "handed_to_pi", "handoff_unknown", "suppressed"].map(
        (s) => Type.Literal(s),
      ),
    ),
    createdAt: integer,
    deadline: integer,
    nextAt: integer,
    endedAt: Type.Optional(integer),
    intervalMs: integer,
    pollTimeoutMs: integer,
    failureLimit: integer,
    limits: Type.Object(
      { maxCalls: integer, maxConcurrency: integer, timeoutMs: integer },
      { additionalProperties: false },
    ),
    polls: integer,
    calls: integer,
    failures: integer,
    inFlight: Type.Boolean(),
    evidence: Type.Optional(text(4096)),
    evidencePoll: Type.Optional(integer),
    failure: Type.Optional(
      Type.Object(
        {
          code: text(160),
          protocolCode: Type.Optional(Type.Literal("invalid_observation")),
          codes: Type.Array(text(160), { maxItems: 128 }),
          partialExecution: Type.Boolean(),
          effectsMayPersist: Type.Boolean(),
          outcomeUnknown: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** Walk newest-first to retain the last receipt per ID without an unbounded index. */
export function restoreReceipts(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
  limit: number,
): Receipt[] {
  const receipts = new Map<string, Receipt>();
  const floor = Math.max(0, entries.length - MAX_RECOVERY_ENTRIES);
  for (let i = entries.length - 1; i >= floor && receipts.size < limit; i--) {
    const e = entries[i];
    if (
      e.type !== "custom" ||
      e.customType !== RECEIPT_TYPE ||
      !Value.Check(schema, e.data)
    )
      continue;
    const r = e.data as Receipt;
    if (!receipts.has(r.id)) receipts.set(r.id, structuredClone(r));
  }
  return [...receipts.values()].reverse();
}
