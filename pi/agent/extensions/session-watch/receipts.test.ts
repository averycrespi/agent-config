import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { restore, RECEIPT_TYPE } from "./receipts.ts";
import { WatchEngine, type Receipt } from "./engine.ts";
import { pause } from "./test-support.ts";

const base = (): Receipt => ({
  id: randomUUID(),
  target: { incarnation: randomUUID(), sessionId: randomUUID() },
  name: "api-worker",
  events: ["agent_settled"],
  createdAt: 1000,
  startedAt: 1010,
  deadline: 5000,
  state: "active",
  notification: "none",
});
const event = {
  name: "agent_settled" as const,
  sequence: 1,
  at: 1020,
  metadata: {},
};
function recover(data: unknown) {
  return restore({
    getLeafId: () => "one",
    getEntry: () => ({
      id: "one",
      parentId: null,
      timestamp: "",
      type: "custom",
      customType: RECEIPT_TYPE,
      data,
    }),
  });
}

test("restore rejects contradictory state, delivery, event, label and timing evidence", () => {
  const a = base();
  const matched = {
    ...a,
    state: "match",
    notification: "pending",
    endedAt: 1030,
    event,
  };
  for (const patch of [
    { ...matched, event: undefined },
    { ...matched, events: ["agent_start"] },
    { ...matched, state: "deadline", endedAt: 6000 },
    { ...matched, state: "failure" },
    { ...matched, state: "cancelled", notification: "suppressed" },
    { ...a, state: "cancelled", notification: "handed_to_pi", endedAt: 1030 },
    {
      ...a,
      state: "invalidated",
      notification: "handoff_unknown",
      endedAt: 1030,
    },
    { ...a, notification: "pending" },
    { ...a, endedAt: 1030 },
    { ...a, event },
    { ...a, state: "failure", notification: "pending", endedAt: 5000 },
    { ...a, state: "failure", notification: "pending", endedAt: 5001 },
    { ...matched, notification: "none" },
    { ...matched, endedAt: undefined },
    { ...matched, endedAt: 5000 },
    { ...matched, event: { ...event, at: 1009 } },
    { ...matched, event: { ...event, at: 1031 } },
    { ...a, startedAt: 999 },
    { ...a, startedAt: 5000 },
    { ...a, deadline: 1500 },
    { ...a, deadline: 1000 + 86400001 },
    { ...a, createdAt: -1 },
    { ...a, name: "\x1b[2Japi-worker" },
    { ...a, name: " api-worker " },
    { ...a, name: "" },
    { ...a, state: "failure", notification: "pending", endedAt: 1009 },
    { ...a, state: "deadline", notification: "pending", endedAt: 4999 },
  ])
    assert.deepEqual(recover(patch), [], JSON.stringify(patch));
});

test("restore preserves every coherent state and notification disposition", () => {
  const a = base();
  assert.deepEqual(recover(a), [a]);
  for (const state of ["match", "deadline", "failure"] as const) {
    for (const notification of [
      "pending",
      "handoff_unknown",
      "handed_to_pi",
      "suppressed",
    ] as const) {
      const r = {
        ...a,
        state,
        notification,
        endedAt: state === "deadline" ? 5000 : 1030,
        ...(state === "match" ? { event } : {}),
      };
      assert.deepEqual(recover(r), [r]);
    }
  }
  for (const state of ["cancelled", "invalidated"] as const) {
    const r = { ...a, state, notification: "suppressed", endedAt: 6000 };
    assert.deepEqual(recover(r), [r]);
  }
});

test("authentic persisted engine transitions survive coherent receipt validation", async () => {
  const saved: Receipt[] = [];
  const engine = new WatchEngine("fixture", randomUUID(), {
    async observe(_root, target) {
      return {
        target: { incarnation: target, sessionId: randomUUID() },
        startedAt: Date.now(),
        result: Promise.resolve({
          name: "agent_settled",
          sequence: 1,
          at: Date.now(),
          metadata: {},
        }),
        close() {},
      };
    },
    persist(r) {
      saved.push(r);
    },
    handoff() {},
    changed() {},
    event() {},
  });
  await engine.start({
    target: randomUUID(),
    events: ["agent_settled"],
    timeout_ms: 1000,
    message: "Inspect",
  });
  await pause();
  engine.close();
  assert.deepEqual(
    saved.map((r) => r.notification),
    ["none", "pending", "handoff_unknown", "handed_to_pi"],
  );
  for (const r of saved) assert.deepEqual(recover(r), [r]);
});
