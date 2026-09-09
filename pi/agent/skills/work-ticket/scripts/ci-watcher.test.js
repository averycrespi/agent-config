import assert from "node:assert/strict";
import test from "node:test";
import {
  updateMonitor,
  validateMonitor,
  remainingWaitMs,
  WAIT_MS,
} from "./ci-monitor.js";

const head = "a".repeat(40);
const pr = "https://github.com/example/project/pull/1";
const id = "11111111-2222-3333-4444-555555555555";
const watch = { operation: "watch", pr, head, required: ["Tests"] };
const observe = (state) => ({
  operation: "observe",
  observation: {
    head,
    requirementsKnown: true,
    checks: [{ name: "Tests", state }],
    reference: "fresh gateway batch",
  },
});
function pending() {
  return updateMonitor(updateMonitor(null, watch, 0), observe("pending"), 0);
}
function prepare() {
  return updateMonitor(pending(), { operation: "prepare" }, 1000);
}
function receipt(s, overrides = {}) {
  return {
    id,
    createdAt: 2000,
    deadline: 2000 + s.watcher.timeoutMs,
    ...overrides,
  };
}
function attach(s, r = receipt(s)) {
  return updateMonitor(s, { operation: "attach", pr, head, receipt: r }, 3000);
}
function reconcile(s, r, now = 90000) {
  return updateMonitor(
    s,
    {
      operation: "reconcile",
      pr,
      head,
      receipt: r,
      reference: "host Monitor get receipt",
    },
    now,
  );
}

test("registration is bounded by remaining allowance and pins the host identity", () => {
  const s = prepare();
  assert.equal(s.watcher.timeoutMs, WAIT_MS - 1000);
  const r = receipt(s);
  const attached = attach(s, r);
  assert.equal(attached.watcher.id, id);
  assert.equal(attached.waitUsedMs, 1000);
  assert.equal(remainingWaitMs(attached, 5000), WAIT_MS - 4000);
  assert.deepEqual(
    attach(attached, r),
    attached,
    "identical attach is harmless",
  );
  for (const bad of [
    { ...r, id: "bad" },
    { ...r, createdAt: 999 },
    { ...r, createdAt: 4000 },
    { ...r, deadline: r.deadline + 1 },
  ])
    assert.throws(() => attach(s, bad), /Monitor/);
  assert.throws(
    () =>
      updateMonitor(
        s,
        { operation: "attach", pr, head: "b".repeat(40), receipt: r },
        3000,
      ),
    /identity/,
  );
  const original = structuredClone(attached);
  for (const operation of [
    "prepare",
    "pause",
    "wait",
    "watch",
    "observe",
    "extend",
  ])
    assert.throws(
      () => updateMonitor(attached, { operation }, 10000),
      /reconcile or cancel/,
    );
  assert.deepEqual(attached, original);
});

test("terminal receipt charges polls but excludes notification queue time; early reconciliation unlocks a fresh check", () => {
  const s = prepare(),
    r = receipt(s);
  const terminal = { ...r, state: "condition", endedAt: 12000 };
  const done = reconcile(attach(s, r), terminal);
  assert.equal(done.waitUsedMs, 11000);
  assert.equal(done.disposition, "paused", "notify is not a readiness verdict");
  assert.equal(done.observation.outcome, "pending");
  assert.equal(done.watcher, null);
  assert.equal(done.nextPollAt, null);
  assert.deepEqual(
    reconcile(done, terminal, 100000),
    done,
    "same receipt never charges twice",
  );
  const early = reconcile(attach(s, r), terminal, 12000);
  assert.equal(
    updateMonitor(early, observe("passed"), 12000).disposition,
    "passed",
  );
  assert.equal(
    updateMonitor(early, observe("failed"), 12000).disposition,
    "repair",
  );
});

test("active, stale, conflicting and malformed receipts cannot qualify or alter accounting", () => {
  const s = prepare(),
    r = receipt(s),
    active = attach(s, r);
  const terminal = { ...r, state: "condition", endedAt: 12000 };
  for (const bad of [
    { ...terminal, id: "22222222-2222-3333-4444-555555555555" },
    { ...terminal, deadline: r.deadline + 1 },
    { ...terminal, createdAt: 1 },
    { ...terminal, state: "waiting" },
    { ...terminal, endedAt: 999 },
    { ...terminal, endedAt: 90001 },
    { ...terminal, endedAt: undefined },
  ])
    assert.throws(() => reconcile(active, bad), /Monitor/);
  const done = reconcile(active, terminal);
  assert.throws(
    () => reconcile(done, { ...terminal, endedAt: 14000 }),
    /conflicting/,
  );
  assert.throws(() => validateMonitor({ ...active, waitingSince: 0 }), /clock/);
  assert.throws(
    () =>
      validateMonitor({
        ...active,
        watcher: { ...active.watcher, timeoutMs: -1 },
      }),
    /intent/,
  );
});

test("interruption charges an open interval conservatively without guessing a terminal time", () => {
  const s = prepare(),
    r = receipt(s);
  const restored = JSON.parse(JSON.stringify(attach(s, r)));
  const done = reconcile(restored, { ...r, state: "invalidated" }, 120000);
  assert.equal(done.waitUsedMs, 119000);
  assert.equal(done.lastWatcher.endedAt, 120000);
  assert.equal(done.disposition, "paused");
  const missing = updateMonitor(
    s,
    {
      operation: "recover",
      reference:
        "Registration outcome reconciled; no live watcher in original session",
    },
    120000,
  );
  assert.equal(missing.waitUsedMs, 120000);
  assert.equal(missing.lastWatcher.state, "unavailable");
  assert.throws(
    () => updateMonitor(s, { operation: "recover" }, 120000),
    /evidence/,
  );
  assert.throws(
    () => updateMonitor(s, { operation: "recover", reference: "proof" }, 0),
    /backwards/,
  );
});

test("cancel, corrective heads and resumed watchers retain cumulative consumption", () => {
  const s = prepare(),
    r = receipt(s);
  let done = reconcile(attach(s, r), {
    ...r,
    state: "cancelled",
    endedAt: 62000,
  });
  assert.equal(done.waitUsedMs, 61000);
  const newHead = "b".repeat(40);
  done = updateMonitor(
    done,
    { ...watch, head: newHead, previousHead: head },
    1000000,
  );
  assert.equal(done.waitUsedMs, 61000, "repair and push time is excluded");
  done = updateMonitor(
    done,
    {
      ...observe("pending"),
      observation: { ...observe("pending").observation, head: newHead },
    },
    1000000,
  );
  done = updateMonitor(done, { operation: "prepare" }, 1000000);
  assert.equal(done.watcher.timeoutMs, WAIT_MS - 61000);
  assert.throws(
    () =>
      updateMonitor(
        done,
        { operation: "attach", pr, head: newHead, receipt: r },
        1000000,
      ),
    /Monitor/,
  );
});

test("deadline permits final qualification, never another watcher without an explicit addition", () => {
  const s = prepare(),
    r = receipt(s);
  const done = reconcile(
    attach(s, r),
    { ...r, state: "deadline", endedAt: r.deadline },
    r.deadline + 60000,
  );
  assert.equal(done.waitUsedMs, WAIT_MS);
  assert.equal(
    updateMonitor(done, observe("passed"), r.deadline + 60000).disposition,
    "passed",
  );
  const stillPending = updateMonitor(
    done,
    observe("pending"),
    r.deadline + 60000,
  );
  assert.equal(stillPending.disposition, "limit");
  const exhausted = updateMonitor(
    stillPending,
    { operation: "prepare" },
    r.deadline + 60000,
  );
  assert.equal(exhausted.watcher, null);
  const extended = updateMonitor(
    exhausted,
    { operation: "extend", additionalMs: 60000 },
    r.deadline + 60000,
  );
  assert.equal(
    updateMonitor(extended, { operation: "prepare" }, r.deadline + 60000)
      .watcher.timeoutMs,
    60000,
  );
});

test("older records keep open waiting consumption when adopting Monitor", () => {
  const legacy = pending();
  delete legacy.watcher;
  delete legacy.lastWatcher;
  validateMonitor(legacy);
  const adopted = updateMonitor(legacy, { operation: "prepare" }, 120000);
  assert.equal(adopted.waitUsedMs, 120000);
  assert.equal(adopted.watcher.timeoutMs, WAIT_MS - 120000);
  const nearLimit = updateMonitor(
    { ...legacy, waitUsedMs: WAIT_MS - 500 },
    { operation: "prepare" },
    0,
  );
  assert.equal(nearLimit.disposition, "limit");
  assert.equal(nearLimit.watcher, null);
});
