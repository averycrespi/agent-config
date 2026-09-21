import {
  updateMonitor as updateLedger,
  validateMonitor as validateLedger,
  remainingWaitMs,
} from "./ci-monitor.js";

export { remainingWaitMs };

export function remainingBounds(s, now = Date.now()) {
  if (!s.bounds)
    return { recoveryRequired: true, remainingMs: 0, wakesRemaining: 0 };
  return {
    recoveryRequired: false,
    deadline: s.bounds.deadline,
    remainingMs: Math.max(
      0,
      Math.min(remainingWaitMs(s, now), s.bounds.deadline - now),
    ),
    wakesRemaining: Math.max(
      0,
      s.bounds.wakeLimit - s.bounds.attempts.filter((a) => !a.unused).length,
    ),
    unresolved: s.bounds.attempts.filter((a) => a.uncertain).map((a) => a.id),
  };
}
const CYCLE_MS = 25 * 60_000;

// The persisted schema-v2 ledger retains historical state names. Backend identity
// prevents interpreting a legacy receipt as a new Background observation.
export function validateMonitor(s) {
  validateLedger(s);
  if (s.bounds !== undefined) {
    const b = s.bounds;
    if (
      !b ||
      !Number.isSafeInteger(b.startedAt) ||
      b.startedAt < 0 ||
      !Number.isSafeInteger(b.deadline) ||
      b.deadline < b.startedAt ||
      !Number.isSafeInteger(b.wakeLimit) ||
      b.wakeLimit < 1 ||
      !Array.isArray(b.attempts) ||
      b.attempts.length > 1000 ||
      new Set(b.attempts.map((a) => a.id)).size !== b.attempts.length ||
      b.attempts.some(
        (a) =>
          typeof a.id !== "string" ||
          !a.id ||
          a.id.length > 100 ||
          typeof a.unused !== "boolean" ||
          typeof a.uncertain !== "boolean" ||
          (a.unused && a.uncertain),
      )
    )
      throw new Error("invalid CI absolute/wake accounting");
  }
  for (const w of [s.watcher, s.lastWatcher]) {
    if (!w || w.backend === undefined) continue;
    if (
      w.backend !== "background" ||
      !Number.isSafeInteger(w.cycleMs) ||
      w.cycleMs < 1000 ||
      w.cycleMs !== Math.min(w.timeoutMs, CYCLE_MS)
    )
      throw new Error("invalid Background registration intent");
  }
}

export function updateMonitor(previous, request, now = Date.now()) {
  if (previous) validateMonitor(previous);
  let input = request;
  if (request.operation === "adopt-bounds") {
    if (
      !previous ||
      previous.bounds ||
      previous.watcher ||
      typeof request.reference !== "string" ||
      !request.reference.trim()
    )
      throw new Error("explicit reconciled legacy bounds recovery required");
    const adopted = structuredClone(previous);
    adopted.bounds = structuredClone(request.bounds);
    validateMonitor(adopted);
    if (
      adopted.bounds.startedAt > now ||
      adopted.bounds.deadline > adopted.bounds.startedAt + 30 * 60_000 ||
      adopted.bounds.wakeLimit > 6
    )
      throw new Error(
        "recover original bounds first; additions require scoped override",
      );
    adopted.bounds.recoveryReference = request.reference;
    return adopted;
  }
  if (request.operation === "resolve-handoff") {
    const resolved = structuredClone(previous);
    const attempt = resolved?.bounds?.attempts.find((a) => a.id === request.id);
    if (
      !attempt ||
      previous.watcher ||
      typeof request.reference !== "string" ||
      !request.reference.trim()
    )
      throw new Error("explicit originating handoff reconciliation required");
    attempt.uncertain = false;
    attempt.resolutionReference = request.reference;
    return resolved;
  }
  if (["extend-wakes", "extend-deadline"].includes(request.operation)) {
    if (
      !previous?.bounds ||
      previous.watcher ||
      !Number.isSafeInteger(request.additional) ||
      request.additional < 1
    )
      throw new Error("positive wake addition requires reconciled bounds");
    const extended = structuredClone(previous);
    if (request.operation === "extend-wakes")
      extended.bounds.wakeLimit += request.additional;
    else extended.bounds.deadline += request.additional;
    validateMonitor(extended);
    return extended;
  }
  if (request.operation === "prepare") {
    if (!previous?.bounds)
      throw new Error(
        "legacy CI bounds require explicit recovery; never infer a fresh allowance",
      );
    const bounds = remainingBounds(previous, now);
    if (!previous.watcher && bounds.unresolved.length)
      throw new Error("reconcile pending/unknown handoff before replacement");
    if (bounds.remainingMs < 1000 || bounds.wakesRemaining < 1) {
      const limited = updateLedger(previous, { operation: "pause" }, now);
      limited.disposition = "limit";
      return limited;
    }
  }
  const w = previous?.watcher ?? previous?.lastWatcher;
  if (
    ["attach", "reconcile"].includes(request.operation) &&
    w?.backend === "background"
  ) {
    const r = request.receipt;
    if (
      !r ||
      r.recurring !== false ||
      r.maxWakes !== 1 ||
      r.cycleMs !== w.cycleMs ||
      !["active", "finished", "cancelled", "invalidated"].includes(r.status)
    )
      throw new Error("expected one-shot Background host receipt");
    if (request.operation === "reconcile") {
      if (r.status === "active")
        throw new Error("Background observation remains active");
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
          "Background terminal reason/time unavailable; reconcile inactivity before recover",
        );
      input = { ...request, receipt: { ...r, state } };
    }
  }
  const result = updateLedger(previous, input, now);
  if (request.operation === "extend" && result.bounds)
    result.bounds.deadline += request.additionalMs;
  if (!previous && request.operation === "watch") {
    result.bounds = {
      startedAt: now,
      deadline: now + 30 * 60_000,
      wakeLimit: 6,
      attempts: [],
    };
  }
  if (request.operation === "prepare" && result.watcher) {
    result.watcher.timeoutMs = Math.min(
      result.watcher.timeoutMs,
      result.bounds.deadline - now,
    );
    const attempt = `reservation-${result.bounds.attempts.length + 1}`;
    result.bounds.attempts.push({
      id: attempt,
      unused: false,
      uncertain: true,
    });
    result.watcher.attempt = attempt;
    result.watcher.backend = "background";
    result.watcher.cycleMs = Math.min(result.watcher.timeoutMs, CYCLE_MS);
  }
  if (request.operation === "attach" && result.bounds && result.watcher) {
    if (result.watcher.deadline > result.bounds.deadline)
      throw new Error(
        "Background deadline exceeds retained absolute ceiling; cancel/reconcile exact job",
      );
    const attempt = result.bounds.attempts.find(
      (a) => a.id === result.watcher.attempt,
    );
    if (!attempt) throw new Error("missing CI wake reservation");
    attempt.jobId = result.watcher.id;
  }
  if (request.operation === "reconcile" && result.bounds) {
    const receipt = request.receipt;
    const attempt = result.bounds.attempts.find((a) => a.jobId === receipt.id);
    if (!attempt) throw new Error("missing CI receipt reservation");
    // Only a terminal, suppressed/no-attention host receipt proves no handoff.
    // Missing/unknown/pending delivery remains charged, even after recovery.
    const attention = receipt.attention ?? receipt.lastAttention;
    attempt.uncertain =
      receipt.inFlight !== false ||
      receipt.outcomeUnknown !== false ||
      !Number.isSafeInteger(receipt.wakes) ||
      ["pending", "handoff_unknown"].includes(attention?.disposition);
    if (
      receipt.wakes === 0 &&
      !attempt.uncertain &&
      (!attention || attention.disposition === "suppressed")
    )
      attempt.unused = true;
  }
  validateMonitor(result);
  return result;
}
