import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { snapshotScriptJson } from "../script/api.ts";
import { isId, label, LIMITS, type Receipt } from "./contract.ts";
export const RECEIPT_TYPE = "background:receipt-v1";
// Older successful evaluations retained an own code: undefined in memory,
// although disk JSON omitted it. Normalize only that field, without invoking
// accessors or changing the session manager's retained objects.
function normalizeLegacyAccounting(value: unknown): unknown {
  const plain = (v: unknown): v is object =>
    v !== null &&
    typeof v === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  if (!plain(value)) return value;
  const accounting = Object.getOwnPropertyDescriptor(value, "accounting");
  if (
    !accounting ||
    !accounting.enumerable ||
    !("value" in accounting) ||
    !plain(accounting.value)
  )
    return value;
  const code = Object.getOwnPropertyDescriptor(accounting.value, "code");
  if (
    !code ||
    !code.enumerable ||
    !("value" in code) ||
    code.value !== undefined
  )
    return value;
  const fields = Object.getOwnPropertyDescriptors(accounting.value);
  delete fields.code;
  const receipt = Object.getOwnPropertyDescriptors(value);
  receipt.accounting = {
    ...accounting,
    value: Object.create(Object.getPrototypeOf(accounting.value), fields),
  };
  return Object.create(Object.getPrototypeOf(value), receipt);
}
export function parseReceipt(value: unknown): Receipt | undefined {
  try {
    const r = JSON.parse(
      snapshotScriptJson(normalizeLegacyAccounting(value), 48000),
    ) as Receipt;
    const keys = [
      "id",
      "name",
      "createdAt",
      "endedAt",
      "deadline",
      "cycleDeadline",
      "nextAt",
      "status",
      "recurring",
      "cycleMs",
      "intervalMs",
      "delayMs",
      "eventCount",
      "maxWakes",
      "wakes",
      "evaluations",
      "calls",
      "inFlight",
      "awaitingSettlement",
      "state",
      "evidence",
      "evidenceAt",
      "coverage",
      "gap",
      "interrupted",
      "effectsMayPersist",
      "outcomeUnknown",
      "attention",
      "lastAttention",
      "accounting",
      "failureCode",
    ];
    if (
      !r ||
      Object.keys(r).some((k) => !keys.includes(k)) ||
      !isId(r.id) ||
      typeof r.name !== "string" ||
      !r.name ||
      r.name !== label(r.name) ||
      !["active", "finished", "cancelled", "invalidated"].includes(r.status) ||
      ![
        r.createdAt,
        r.deadline,
        r.cycleDeadline,
        r.cycleMs,
        r.maxWakes,
        r.wakes,
        r.evaluations,
        r.calls,
      ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      r.deadline < r.createdAt ||
      r.deadline - r.createdAt > LIMITS.lifetime ||
      r.cycleMs < 1000 ||
      r.cycleMs > LIMITS.cycle ||
      r.maxWakes < 1 ||
      r.maxWakes > LIMITS.wakes ||
      r.wakes > r.maxWakes ||
      r.evaluations > LIMITS.evaluations ||
      r.calls > LIMITS.evaluations * 8 ||
      ![
        r.recurring,
        r.inFlight,
        r.awaitingSettlement,
        r.gap,
        r.interrupted,
        r.effectsMayPersist,
        r.outcomeUnknown,
      ].every((b) => typeof b === "boolean") ||
      !Array.isArray(r.coverage) ||
      r.coverage.length > 4
    )
      return;
    if (
      (r.endedAt !== undefined && r.status === "active") ||
      [r.nextAt, r.evidenceAt, r.endedAt].some(
        (n) => n !== undefined && (!Number.isSafeInteger(n) || n < r.createdAt),
      )
    )
      return;
    if (
      [r.intervalMs, r.delayMs].some(
        (n) =>
          n !== undefined &&
          (!Number.isSafeInteger(n) || n < 1000 || n > LIMITS.cycle),
      ) ||
      (r.intervalMs !== undefined && r.delayMs !== undefined) ||
      (r.eventCount !== undefined &&
        (!Number.isSafeInteger(r.eventCount) ||
          r.eventCount < 0 ||
          r.eventCount > 4)) ||
      (r.delayMs !== undefined && (r.eventCount ?? 0) > 0)
    )
      return;
    if (
      r.failureCode !== undefined &&
      !/^[a-z][a-z0-9_]{0,159}$/.test(r.failureCode)
    )
      return;
    if (
      (!r.recurring && r.maxWakes !== 1) ||
      (r.lastAttention && r.wakes < 1) ||
      (r.awaitingSettlement && !r.lastAttention)
    )
      return;
    for (const a of [r.attention, r.lastAttention])
      if (
        a &&
        (Object.keys(a).sort().join() !== "admitted,at,disposition,id,reason" ||
          !isId(a.id) ||
          ![
            "condition",
            "timeout",
            "evaluation_failure",
            "coverage_failure",
            "budget_exhausted",
          ].includes(a.reason) ||
          ![
            "pending",
            "suppressed",
            "handoff_unknown",
            "handed_to_pi",
          ].includes(a.disposition) ||
          typeof a.admitted !== "boolean" ||
          !Number.isSafeInteger(a.at) ||
          a.at < r.createdAt ||
          (a.admitted &&
            !["handed_to_pi", "handoff_unknown"].includes(a.disposition)))
      )
        return;
    if (
      r.attention &&
      !["pending", "suppressed"].includes(r.attention.disposition)
    )
      return;
    if (
      r.lastAttention &&
      !["handoff_unknown", "handed_to_pi"].includes(r.lastAttention.disposition)
    )
      return;
    if (r.accounting) {
      const a = r.accounting;
      if (
        Object.keys(a).some(
          (k) =>
            ![
              "status",
              "code",
              "traces",
              "partialExecution",
              "effectsMayPersist",
              "outcomeUnknown",
            ].includes(k),
        ) ||
        !["success", "failed", "cancelled", "timeout"].includes(a.status) ||
        !Array.isArray(a.traces) ||
        a.traces.length > 8 ||
        ![a.partialExecution, a.effectsMayPersist, a.outcomeUnknown].every(
          (b) => typeof b === "boolean",
        ) ||
        (a.code !== undefined && !/^[a-z][a-z0-9_]{0,159}$/.test(a.code))
      )
        return;
      for (const trace of a.traces) {
        if (
          Object.keys(trace).some(
            (k) =>
              ![
                "id",
                "tool",
                "state",
                "dispatched",
                "startedMs",
                "durationMs",
                "code",
                "outcomeUnknown",
              ].includes(k),
          ) ||
          typeof trace.tool !== "string" ||
          (trace.tool !== "(not dispatched)" &&
            !/^[a-z][a-z0-9_]{0,47}\.[a-z][a-z0-9_]{0,47}$/.test(trace.tool)) ||
          !["queued", "running", "succeeded", "failed", "cancelled"].includes(
            trace.state,
          ) ||
          typeof trace.dispatched !== "boolean" ||
          (trace.outcomeUnknown !== undefined &&
            typeof trace.outcomeUnknown !== "boolean") ||
          ![trace.id, trace.startedMs, trace.durationMs].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ) ||
          (trace.code !== undefined &&
            !/^[a-z][a-z0-9_]{0,159}$/.test(trace.code))
        )
          return;
      }
    }
    snapshotScriptJson(r.state, 4096);
    snapshotScriptJson(r.evidence, 4096);
    for (const c of r.coverage) snapshotScriptJson(c, 4096);
    return r;
  } catch {
    return;
  }
}
export function restore(
  manager: Pick<ExtensionContext["sessionManager"], "getLeafId" | "getEntry">,
) {
  const found = new Map<string, Receipt>();
  let id = manager.getLeafId();
  for (let i = 0; id && i < 4096 && found.size < LIMITS.receipts; i++) {
    const entry = manager.getEntry(id);
    if (!entry) break;
    if (entry.type === "custom" && entry.customType === RECEIPT_TYPE) {
      const r = parseReceipt(entry.data);
      if (r && !found.has(r.id)) found.set(r.id, r);
    }
    id = entry.parentId;
  }
  return [...found.values()].reverse();
}
