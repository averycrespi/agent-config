export const POLL_MS = 60_000;
export const WAIT_MS = 30 * 60_000;
const HEAD = /^[a-f0-9]{40,64}$/;
const STATES = new Set(["passed", "pending", "failed", "canceled", "unknown"]);

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
}

// Observations are supplied by the broker caller; this module never authenticates or polls.
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
    };
    validateMonitor(s);
    return s;
  }
  if (s.waitingSince !== null) {
    requireThat(
      now >= s.waitingSince,
      "clock moved backwards; reconcile monitoring clock",
    );
    s.waitUsedMs += now - s.waitingSince;
    s.waitingSince = now;
  }
  switch (request.operation) {
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
