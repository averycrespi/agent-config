import assert from "node:assert/strict";
import test from "node:test";
import { updateMonitor, POLL_MS, WAIT_MS } from "./ci-monitor.js";
const head = "a".repeat(40);
const watch = {
  operation: "watch",
  pr: "https://github.com/example/project/pull/1",
  head,
  required: ["Tests", "Required"],
};
const observe = (state, overrides = {}) => ({
  operation: "observe",
  observation: {
    head,
    requirementsKnown: true,
    checks: [
      { name: "Tests", state },
      { name: "Required", state },
    ],
    reference: "gateway result for current attempt",
    ...overrides,
  },
});

test("required exact-head CI passes; absent, stale, inaccessible, ambiguous and canceled results never pass", () => {
  const s = updateMonitor(null, watch, 0);
  assert.equal(updateMonitor(s, observe("passed"), 0).disposition, "passed");
  assert.equal(updateMonitor(s, observe("failed"), 0).disposition, "repair");
  for (const override of [
    { checks: [] },
    { head: "b".repeat(40) },
    { requirementsKnown: false },
    { checks: [{ name: "Tests", state: "passed" }] },
  ])
    assert.equal(
      updateMonitor(s, observe("passed", override), 0).disposition,
      "blocked",
    );
  for (const outcome of ["canceled", "unknown"])
    assert.equal(updateMonitor(s, observe(outcome), 0).disposition, "blocked");
  assert.throws(
    () =>
      updateMonitor(
        s,
        observe("passed", {
          checks: [
            { name: "Tests", state: "passed" },
            { name: "Tests", state: "failed" },
          ],
        }),
        0,
      ),
    /duplicate/,
  );
  assert.throws(
    () => updateMonitor(null, { ...watch, required: [] }, 0),
    /invalid/,
  );
});

test("poll cadence, cumulative wait and final observation remain bounded through interruption", () => {
  let s = updateMonitor(null, watch, 0);
  s = updateMonitor(s, observe("pending"), 0);
  assert.equal(s.nextPollAt, POLL_MS);
  assert.throws(
    () => updateMonitor(s, observe("passed"), POLL_MS - 1),
    /not due/,
  );
  s = updateMonitor(
    JSON.parse(JSON.stringify(s)),
    { operation: "pause" },
    POLL_MS,
  );
  assert.equal(s.waitUsedMs, POLL_MS);
  s = updateMonitor(s, observe("pending"), POLL_MS + 10000);
  assert.equal(
    s.waitUsedMs,
    POLL_MS,
    "active gateway call did not consume waiting",
  );
  s = updateMonitor(s, { operation: "pause" }, WAIT_MS + 10000);
  assert.equal(s.waitUsedMs, WAIT_MS);
  s = updateMonitor(s, observe("pending"), WAIT_MS + 10001);
  assert.equal(s.disposition, "limit");
  assert.equal(s.waitingSince, null);
  const passed = updateMonitor(s, observe("passed"), WAIT_MS + 10002);
  assert.equal(
    passed.disposition,
    "passed",
    "a final observation may discover success",
  );
  assert.equal(
    updateMonitor(s, { operation: "wait" }, WAIT_MS + 10003).disposition,
    "limit",
  );
});

test("repair time and pushes do not reset cumulative waiting; ownership resume preserves it", () => {
  let s = updateMonitor(null, watch, 0);
  s = updateMonitor(s, observe("pending"), 0);
  s = updateMonitor(s, { operation: "pause" }, 120000);
  const changed = { ...watch, previousHead: head, head: "b".repeat(40) };
  s = updateMonitor(s, changed, 10000000);
  assert.equal(s.waitUsedMs, 120000);
  assert.equal(s.observation, null);
  assert.equal(s.nextPollAt, null);
  const reread = updateMonitor(s, changed, 20000000);
  assert.equal(reread.waitUsedMs, 120000);
  assert.throws(
    () =>
      updateMonitor(
        s,
        { ...changed, pr: "https://github.com/example/project/pull/2" },
        20000000,
      ),
    /reconciliation/,
  );
  assert.throws(
    () => updateMonitor(s, { ...changed, required: ["Tests"] }, 20000000),
    /requirements/,
  );
  assert.throws(
    () =>
      updateMonitor(s, { ...watch, previousHead: "c".repeat(40) }, 20000000),
    /previous/,
  );
});

test("explicit additions preserve consumption and do not fabricate passing evidence", () => {
  let s = updateMonitor(null, watch, 0);
  s = updateMonitor(s, observe("pending"), 0);
  s = updateMonitor(s, observe("pending"), WAIT_MS);
  s = updateMonitor(
    s,
    { operation: "extend", additionalMs: 60000 },
    WAIT_MS + 1,
  );
  assert.equal(s.waitUsedMs, WAIT_MS);
  assert.equal(s.waitLimitMs, WAIT_MS + 60000);
  assert.equal(s.disposition, "paused");
  assert.equal(s.observation.outcome, "pending");
  s = updateMonitor(s, { operation: "wait" }, WAIT_MS + 1);
  assert.equal(
    updateMonitor(s, observe("pending"), WAIT_MS + 60001).disposition,
    "limit",
  );
  assert.throws(
    () =>
      updateMonitor(
        s,
        { operation: "extend", additionalMs: -1 },
        WAIT_MS + 60001,
      ),
    /positive/,
  );
  assert.throws(() => updateMonitor(s, { operation: "pause" }, 0), /backwards/);
});

test("explicit PR/requirement reconciliation preserves budgets and drops stale observations", () => {
  let s = updateMonitor(null, watch, 0);
  s = updateMonitor(s, observe("pending"), 0);
  s = updateMonitor(
    s,
    {
      ...watch,
      pr: "https://github.com/example/project/pull/2",
      previousPr: watch.pr,
      previousHead: head,
      required: ["Tests", "Required", "New check"],
      reconciliation:
        "New authorized PR and authoritative required-check inventory observed",
    },
    120000,
  );
  assert.equal(s.waitUsedMs, 120000);
  assert.equal(s.waitLimitMs, WAIT_MS);
  assert.equal(s.observation, null);
  assert.equal(
    updateMonitor(s, observe("passed"), 120000).disposition,
    "blocked",
    "old check set cannot qualify the new requirements",
  );
});

test("recovered waiting is not refunded by a fresh watch", () => {
  const s = updateMonitor(null, { ...watch, waitUsedMs: WAIT_MS }, 0);
  assert.equal(updateMonitor(s, observe("pending"), 0).disposition, "limit");
  assert.equal(updateMonitor(s, observe("passed"), 0).disposition, "passed");
});
