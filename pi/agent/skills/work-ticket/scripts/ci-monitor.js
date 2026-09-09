export const POLL_MS = 60_000;
export const WAIT_MS = 30 * 60_000;
const HEAD = /^[a-f0-9]{40,64}$/;
const STATES = new Set(["passed", "pending", "failed", "canceled", "unknown"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TERMINAL = new Set([
  "condition",
  "deadline",
  "failure_limit",
  "unsafe_failure",
  "cancelled",
  "invalidated",
]);
const timestamp = (n) => Number.isSafeInteger(n) && n >= 0;
const reference = (s) => typeof s === "string" && s.trim() && s.length <= 2000;

function validateWatcher(w) {
  requireThat(
    w &&
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(w.pr) &&
      HEAD.test(w.head) &&
      timestamp(w.preparedAt) &&
      Number.isSafeInteger(w.timeoutMs) &&
      w.timeoutMs >= 1000 &&
      w.timeoutMs <= 86400000,
    "invalid Monitor registration intent",
  );
  requireThat(
    w.id === null
      ? w.createdAt === null && w.deadline === null
      : UUID.test(w.id) &&
          timestamp(w.createdAt) &&
          w.createdAt >= w.preparedAt &&
          timestamp(w.deadline) &&
          w.deadline > w.createdAt &&
          w.deadline - w.createdAt <= w.timeoutMs,
    "invalid Monitor registration receipt",
  );
}

export function remainingWaitMs(s, now = Date.now()) {
  const elapsed =
    s.waitingSince === null ? 0 : Math.max(0, now - s.waitingSince);
  return Math.max(0, s.waitLimitMs - s.waitUsedMs - elapsed);
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateMonitor(s) {
  requireThat(
    s &&
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(s.pr) &&
      HEAD.test(s.head) &&
      Array.isArray(s.required) &&
      s.required.length > 0 &&
      s.required.length <= 100 &&
      s.required.every(
        (x) => typeof x === "string" && x.trim() && x.length <= 200,
      ) &&
      new Set(s.required).size === s.required.length &&
      Number.isSafeInteger(s.waitUsedMs) &&
      s.waitUsedMs >= 0 &&
      Number.isSafeInteger(s.waitLimitMs) &&
      s.waitLimitMs > 0 &&
      [s.waitingSince, s.nextPollAt].every(
        (x) => x === null || (Number.isSafeInteger(x) && x >= 0),
      ) &&
      [
        "poll",
        "waiting",
        "paused",
        "passed",
        "repair",
        "blocked",
        "limit",
      ].includes(s.disposition),
    "invalid CI monitoring record",
  );
  if (s.watcher != null) {
    validateWatcher(s.watcher);
    requireThat(
      s.watcher.pr === s.pr &&
        s.watcher.head === s.head &&
        s.waitingSince === (s.watcher.createdAt ?? s.watcher.preparedAt),
      "invalid Monitor waiting clock",
    );
  }
  if (s.lastWatcher != null) {
    validateWatcher(s.lastWatcher);
    requireThat(
      timestamp(s.lastWatcher.endedAt) &&
        s.lastWatcher.endedAt >=
          (s.lastWatcher.createdAt ?? s.lastWatcher.preparedAt) &&
        (TERMINAL.has(s.lastWatcher.state) ||
          s.lastWatcher.state === "unavailable") &&
        reference(s.lastWatcher.reference),
      "invalid reconciled Monitor receipt",
    );
  }
}

// Observations are supplied by the gateway caller; this module never authenticates or polls.
export function updateMonitor(previous, request, now = Date.now()) {
  requireThat(Number.isSafeInteger(now) && now >= 0, "invalid monitor clock");
  if (previous) validateMonitor(previous);
  let s = previous ? structuredClone(previous) : null;
  if (!s) {
    requireThat(
      request.operation === "watch",
      "start CI monitoring with watch",
    );
    s = {
      pr: request.pr,
      head: request.head,
      required: request.required,
      waitUsedMs: request.waitUsedMs ?? 0,
      waitLimitMs: WAIT_MS,
      waitingSince: null,
      nextPollAt: null,
      disposition: "poll",
      observation: null,
      watcher: null,
      lastWatcher: null,
    };
    validateMonitor(s);
    return s;
  }
  s.watcher ??= null;
  s.lastWatcher ??= null;
  if (s.watcher) {
    requireThat(
      ["attach", "reconcile", "recover"].includes(request.operation),
      "reconcile or cancel the registered Monitor before changing CI state",
    );
    requireThat(
      now >= s.waitingSince,
      "clock moved backwards; reconcile monitoring clock",
    );
  }
  if (!s.watcher && s.waitingSince !== null) {
    requireThat(
      now >= s.waitingSince,
      "clock moved backwards; reconcile monitoring clock",
    );
    s.waitUsedMs += now - s.waitingSince;
    s.waitingSince = now;
  }
  switch (request.operation) {
    case "prepare": {
      requireThat(
        s.observation?.head === s.head && s.observation?.outcome === "pending",
        "Monitor registration requires pending CI on the watched head",
      );
      const remaining = s.waitLimitMs - s.waitUsedMs;
      if (remaining < 1000) {
        s.disposition = "limit";
        s.waitingSince = null;
        s.nextPollAt = null;
        break;
      }
      s.watcher = {
        pr: s.pr,
        head: s.head,
        preparedAt: now,
        timeoutMs: Math.min(remaining, 86400000),
        id: null,
        createdAt: null,
        deadline: null,
      };
      s.waitingSince = now;
      s.disposition = "waiting";
      break;
    }
    case "attach": {
      requireThat(
        s.watcher && request.head === s.head && request.pr === s.pr,
        "Monitor registration identity mismatch",
      );
      const r = request.receipt;
      const w = {
        ...s.watcher,
        id: r?.id,
        createdAt: r?.createdAt,
        deadline: r?.deadline,
      };
      validateWatcher(w);
      requireThat(
        w.id !== null && w.createdAt <= now,
        "Monitor registration must come from an observed host receipt",
      );
      requireThat(
        s.watcher.id === null ||
          JSON.stringify(w) === JSON.stringify(s.watcher),
        "Monitor already attached; reconcile before replacement",
      );
      s.watcher = w;
      // Registration setup is not a running watcher. Until attached, interruption
      // recovery conservatively uses preparedAt instead of guessing a start time.
      s.waitingSince = w.createdAt;
      break;
    }
    case "reconcile": {
      const r = request.receipt;
      const w = s.watcher ?? s.lastWatcher;
      requireThat(
        w?.id &&
          r?.id === w.id &&
          r.createdAt === w.createdAt &&
          r.deadline === w.deadline &&
          request.head === w.head &&
          request.pr === w.pr,
        "terminal Monitor receipt identity mismatch",
      );
      requireThat(
        TERMINAL.has(r.state) && reference(request.reference),
        "terminal Monitor receipt and evidence reference required",
      );
      // Abrupt restoration can invalidate a receipt without an endedAt timestamp.
      const endedAt =
        r.endedAt ?? (r.state === "invalidated" ? now : undefined);
      requireThat(
        timestamp(endedAt) && endedAt >= w.createdAt && endedAt <= now,
        "invalid terminal Monitor timestamp",
      );
      if (!s.watcher) {
        requireThat(
          r.state === w.state &&
            (r.endedAt === undefined || endedAt === w.endedAt),
          "conflicting terminal Monitor receipt",
        );
        break;
      }
      s.waitUsedMs += endedAt - w.createdAt;
      s.lastWatcher = {
        ...w,
        endedAt,
        state: r.state,
        reference: request.reference,
      };
      s.watcher = null;
      s.waitingSince = null;
      s.nextPollAt = null;
      s.disposition = "paused";
      break;
    }
    case "recover": {
      requireThat(
        s.watcher && reference(request.reference),
        "unavailable Monitor needs registration intent and concrete inactive/absent evidence",
      );
      const w = s.watcher;
      s.waitUsedMs += now - (w.createdAt ?? w.preparedAt);
      s.lastWatcher = {
        ...w,
        endedAt: now,
        state: "unavailable",
        reference: request.reference,
      };
      s.watcher = null;
      s.waitingSince = null;
      s.nextPollAt = null;
      s.disposition = "paused";
      break;
    }
    case "watch": {
      const changedPr = request.pr !== s.pr;
      const changedRequirements =
        JSON.stringify(request.required) !== JSON.stringify(s.required);
      if (changedPr || changedRequirements) {
        requireThat(
          request.previousPr === s.pr &&
            typeof request.reconciliation === "string" &&
            request.reconciliation.trim(),
          "changed PR/requirements need previousPr and concrete reconciliation evidence",
        );
      }
      if (request.head !== s.head || changedPr || changedRequirements) {
        requireThat(
          request.previousHead === s.head && HEAD.test(request.head),
          "new head requires the previous monitored head",
        );
        s.pr = request.pr;
        s.required = request.required;
        s.head = request.head;
        s.observation = null;
        s.waitingSince = null;
        s.nextPollAt = null;
        s.disposition = "poll";
      }
      break;
    }
    case "pause":
      s.waitingSince = null;
      s.disposition = "paused";
      break;
    case "wait":
      requireThat(
        s.observation?.head === s.head && s.observation?.outcome === "pending",
        "waiting requires pending CI on the monitored head",
      );
      s.waitingSince ??= now;
      s.nextPollAt ??= now + POLL_MS;
      s.disposition = "waiting";
      break;
    case "observe": {
      requireThat(
        s.nextPollAt === null ||
          now >= s.nextPollAt ||
          s.waitUsedMs >= s.waitLimitMs,
        "CI poll is not due yet",
      );
      const o = request.observation;
      requireThat(
        o &&
          typeof o.reference === "string" &&
          o.reference.trim() &&
          o.reference.length <= 2000,
        "CI observation reference required",
      );
      requireThat(
        Array.isArray(o.checks) &&
          o.checks.length <= 200 &&
          o.checks.every(
            (c) => c && typeof c.name === "string" && STATES.has(c.state),
          ),
        "invalid normalized CI checks",
      );
      requireThat(
        new Set(o.checks.map((c) => c.name)).size === o.checks.length,
        "ambiguous duplicate CI checks; resolve current attempts first",
      );
      const states = s.required.map(
        (name) => o.checks.find((c) => c.name === name)?.state ?? "unknown",
      );
      const outcome =
        o.head !== s.head ||
        o.requirementsKnown !== true ||
        states.some((x) => ["unknown", "canceled"].includes(x))
          ? "blocked"
          : states.includes("failed")
            ? "failed"
            : states.every((x) => x === "passed")
              ? "passed"
              : "pending";
      s.observation = { head: o.head, reference: o.reference, outcome };
      s.disposition = {
        blocked: "blocked",
        failed: "repair",
        passed: "passed",
        pending: "waiting",
      }[outcome];
      s.waitingSince = outcome === "pending" ? now : null;
      s.nextPollAt = now + POLL_MS;
      break;
    }
    case "extend":
      requireThat(
        Number.isSafeInteger(request.additionalMs) && request.additionalMs > 0,
        "positive monitoring allowance addition required",
      );
      s.waitLimitMs += request.additionalMs;
      if (s.disposition === "limit") s.disposition = "paused";
      break;
    default:
      throw new Error("unknown CI operation");
  }
  if (
    s.waitUsedMs >= s.waitLimitMs &&
    ["waiting", "poll"].includes(s.disposition)
  ) {
    s.disposition = "limit";
    s.waitingSince = null;
  }
  validateMonitor(s);
  return s;
}
