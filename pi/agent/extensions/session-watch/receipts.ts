import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { filters, record, uuid, validNotice } from "./events.ts";
import { label, type Receipt } from "./engine.ts";
import { finiteTimeout } from "./transport.ts";
export const RECEIPT_TYPE = "session-watch:receipt-v1";

function valid(value: unknown): value is Receipt {
  const r = record(value),
    target = record(r.target);
  const keys = [
    "id",
    "target",
    "name",
    "events",
    "createdAt",
    "startedAt",
    "deadline",
    "endedAt",
    "state",
    "notification",
    "event",
  ];
  const shape =
    Object.keys(r).every((k) => keys.includes(k)) &&
    uuid(r.id) &&
    uuid(target.incarnation) &&
    uuid(target.sessionId) &&
    Object.keys(target).length === 2 &&
    typeof r.name === "string" &&
    r.name.length <= 80 &&
    filters(r.events) &&
    [r.createdAt, r.startedAt, r.deadline].every(
      (n) => Number.isSafeInteger(n) && (n as number) >= 0,
    ) &&
    (r.endedAt === undefined || Number.isSafeInteger(r.endedAt)) &&
    [
      "active",
      "match",
      "deadline",
      "failure",
      "cancelled",
      "invalidated",
    ].includes(r.state as string) &&
    [
      "none",
      "pending",
      "handoff_unknown",
      "handed_to_pi",
      "suppressed",
    ].includes(r.notification as string) &&
    (r.event === undefined || validNotice(r.event));
  if (!shape) return false;
  const receipt = r as unknown as Receipt;
  const {
    createdAt,
    startedAt,
    deadline,
    endedAt,
    state,
    notification,
    event,
  } = receipt;
  if (
    !receipt.name ||
    receipt.name !== label(receipt.name) ||
    !finiteTimeout(deadline - createdAt) ||
    startedAt < createdAt ||
    startedAt >= deadline
  )
    return false;
  if (state === "active")
    return (
      notification === "none" && endedAt === undefined && event === undefined
    );
  if (endedAt === undefined || endedAt < startedAt || notification === "none")
    return false;
  if (
    ["cancelled", "invalidated"].includes(state) &&
    notification !== "suppressed"
  )
    return false;
  if (state === "match") {
    return (
      event !== undefined &&
      receipt.events.includes(event.name) &&
      event.at >= startedAt &&
      event.at <= endedAt &&
      endedAt < deadline
    );
  }
  return (
    event === undefined &&
    (state !== "deadline" || endedAt >= deadline) &&
    (state !== "failure" || endedAt < deadline)
  );
}
/** Latest 32 receipts in at most 4096 ancestors; no transcript materialization/replay. */
export function restore(
  manager: Pick<ExtensionContext["sessionManager"], "getLeafId" | "getEntry">,
): Receipt[] {
  const result = new Map<string, Receipt>();
  let id = manager.getLeafId();
  for (let i = 0; id && i < 4096 && result.size < 32; i++) {
    const entry = manager.getEntry(id);
    if (!entry) break;
    if (
      entry.type === "custom" &&
      entry.customType === RECEIPT_TYPE &&
      valid(entry.data) &&
      !result.has(entry.data.id)
    )
      result.set(entry.data.id, structuredClone(entry.data));
    id = entry.parentId;
  }
  return [...result.values()].reverse();
}
