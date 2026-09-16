import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundEngine } from "../../../extensions/background/engine.ts";
import { registration } from "../../../extensions/background/contract.ts";
import { parseReceipt } from "../../../extensions/background/receipts.ts";
import { updateMonitor, validateMonitor } from "./ci-background.js";

const pr = "https://github.com/example/project/pull/1",
  head = "a".repeat(40);
const observation = (state, sourceHead = head) => ({
  operation: "observe",
  observation: {
    head: sourceHead,
    requirementsKnown: true,
    checks: [{ name: "Verify", state }],
    reference: "authoritative fixture batch",
  },
});
async function fixture() {
  let now = 0,
    result = "pending",
    busy = true,
    nextId = 0;
  const timers = new Map(),
    messages = [];
  let ledger = updateMonitor(
    null,
    { operation: "watch", pr, head, required: ["Verify"] },
    now,
  );
  const update = (request) => (ledger = updateMonitor(ledger, request, now));
  update(observation("pending"));
  const engine = new BackgroundEngine(
    {
      idle: () => !busy,
      persist() {},
      changed() {},
      handoff(r) {
        messages.push(r);
        busy = true;
      },
      subscribe: async () => {
        throw Error("unexpected subscription");
      },
      evaluate: async () => ({
        status: "success",
        json: JSON.stringify({
          decision: result === "pending" ? "wait" : "wake",
          evidence: { head, result },
        }),
        traces: [],
        effectsMayPersist: false,
        partialExecution: false,
        outcomeUnknown: false,
      }),
    },
    {
      now: () => now,
      set(fn, ms) {
        const id = ++nextId;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (id) => timers.delete(id),
    },
  );
  const start = async () => {
    update({ operation: "prepare" });
    const w = ledger.watcher;
    const r = await engine.start(
      registration({
        name: "CI fixture",
        message: "Reconcile exact head",
        providers: [],
        interval_ms: 60000,
        source: "fixture",
        cycle_timeout_ms: w.cycleMs,
        lifetime_ms: w.timeoutMs,
        max_wakes: 1,
      }),
    );
    update({ operation: "attach", pr, head, receipt: r });
    return r.id;
  };
  const advance = async (ms) => {
    const target = now + ms;
    for (let n = 0; n < 1000; n++) {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const task = [...timers]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!task) {
        now = target;
        return;
      }
      timers.delete(task[0]);
      now = task[1].at;
      task[1].fn();
    }
    throw Error("timer spin");
  };
  const reconcile = (id) => {
    const receipt = engine.get(id);
    assert.ok(parseReceipt(receipt));
    return update({
      operation: "reconcile",
      pr,
      head,
      receipt,
      reference: "actual engine receipt",
    });
  };
  return {
    engine,
    start,
    advance,
    reconcile,
    update,
    messages,
    result: (value) => {
      result = value;
    },
    idle() {
      busy = false;
      engine.settled();
    },
    get ledger() {
      return ledger;
    },
  };
}

test("migrated CI polling waits without messages, then reconciles success/failure and exact head", async () => {
  for (const outcome of ["passed", "failed"]) {
    const f = await fixture();
    const id = await f.start();
    await f.advance(60000);
    assert.equal(f.messages.length, 0);
    assert.equal(f.engine.get(id).status, "active");
    f.result(outcome);
    await f.advance(60000);
    const r = f.engine.get(id);
    assert.equal(r.endedAt, 120000);
    assert.equal(r.attention.reason, "condition");
    assert.equal(f.messages.length, 0, "active owner is not steered");
    await f.advance(300000);
    f.idle();
    await f.advance(0);
    assert.equal(f.messages.length, 1);
    assert.equal(
      f.reconcile(id).waitUsedMs,
      120000,
      "queued attention does not consume wait",
    );
    assert.equal(
      f.ledger.disposition,
      "paused",
      "notification never qualifies CI",
    );
    assert.equal(
      f.update(observation(outcome)).disposition,
      outcome === "passed" ? "passed" : "repair",
    );
    f.engine.close(false);
  }
  const f = await fixture();
  const id = await f.start();
  f.engine.cancel(id);
  f.reconcile(id);
  assert.equal(
    f.update(observation("passed", "b".repeat(40))).disposition,
    "blocked",
  );
  f.engine.close(false);
});

test("25-minute attention renews only the remaining cumulative allowance", async () => {
  const f = await fixture(),
    id = await f.start();
  await f.advance(1500000);
  assert.equal(f.engine.get(id).attention.reason, "timeout");
  f.reconcile(id);
  assert.equal(f.ledger.waitUsedMs, 1500000);
  f.update(observation("pending"));
  const second = await f.start();
  assert.equal(f.ledger.watcher.timeoutMs, 300000);
  await f.advance(300000);
  assert.equal(f.engine.get(second).attention.reason, "budget_exhausted");
  f.reconcile(second);
  assert.equal(f.update(observation("pending")).disposition, "limit");
  assert.equal(f.update({ operation: "prepare" }).watcher, null);
  f.engine.close(false);
});

test("raw active or legacy receipts cannot settle a new job; interruption retains usage", async () => {
  const f = await fixture(),
    id = await f.start();
  const active = f.engine.get(id);
  assert.throws(() => f.reconcile(id), /remains active/);
  assert.throws(
    () =>
      f.update({
        operation: "reconcile",
        pr,
        head,
        receipt: {
          id,
          createdAt: active.createdAt,
          deadline: active.deadline,
          state: "condition",
          endedAt: 0,
        },
        reference: "legacy",
      }),
    /Background/,
  );
  await f.advance(5000);
  f.engine.close(true);
  f.reconcile(id);
  assert.equal(f.ledger.waitUsedMs, 5000);
  const old = structuredClone(f.ledger);
  delete old.lastWatcher.backend;
  delete old.lastWatcher.cycleMs;
  validateMonitor(old);
  assert.equal(
    old.waitUsedMs,
    5000,
    "historical ledger remains readable without refunds",
  );
});
