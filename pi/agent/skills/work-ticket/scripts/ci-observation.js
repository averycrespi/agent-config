import {
  updateMonitor as updateLedger,
  validateMonitor as validateLedger,
  remainingWaitMs,
} from "./ci-monitor.js";

export { remainingWaitMs };
const CYCLE_MS = 25 * 60_000;

// The persisted schema-v2 ledger retains historical state names. Backend identity
// distinguishes retired ledger receipts from current observer receipts. The
// background marker remains recovery-only; never rewrite historical intents.
export function validateMonitor(s) {
  validateLedger(s);
  for (const w of [s.watcher, s.lastWatcher]) {
    if (!w || w.backend === undefined) continue;
    if (
      !["monitor", "background"].includes(w.backend) ||
      !Number.isSafeInteger(w.cycleMs) ||
      w.cycleMs < 1000 ||
      w.cycleMs !== Math.min(w.timeoutMs, CYCLE_MS)
    )
      throw new Error("invalid Monitor registration intent");
  }
}

export function updateMonitor(previous, request, now = Date.now()) {
  if (previous) validateMonitor(previous);
  let input = request;
  const w = previous?.watcher ?? previous?.lastWatcher;
  if (
    ["attach", "reconcile"].includes(request.operation) &&
    ["monitor", "background"].includes(w?.backend)
  ) {
    const r = request.receipt;
    if (
      !r ||
      r.recurring !== false ||
      r.maxWakes !== 1 ||
      r.cycleMs !== w.cycleMs ||
      !["active", "finished", "cancelled", "invalidated"].includes(r.status)
    )
      throw new Error("expected one-shot Monitor host receipt");
    if (request.operation === "reconcile") {
      if (r.status === "active")
        throw new Error("Monitor observation remains active");
      const reason = r.attention?.reason ?? r.lastAttention?.reason;
      const state =
        r.status === "cancelled" || r.status === "invalidated"
          ? r.status
          : {
              condition: "condition",
              timeout: "deadline",
              budget_exhausted: "deadline",
              evaluation_failure: "unsafe_failure",
              coverage_failure: "unsafe_failure",
            }[reason];
      if (!state || (r.status === "finished" && r.endedAt === undefined))
        throw new Error(
          "Monitor terminal reason/time unavailable; reconcile inactivity before recover",
        );
      input = { ...request, receipt: { ...r, state } };
    }
  }
  const result = updateLedger(previous, input, now);
  if (request.operation === "prepare" && result.watcher) {
    result.watcher.backend = "monitor";
    result.watcher.cycleMs = Math.min(result.watcher.timeoutMs, CYCLE_MS);
  }
  validateMonitor(result);
  return result;
}
