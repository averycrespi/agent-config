import assert from "node:assert/strict";
import test from "node:test";
import { MonitorEngine } from "../../extensions/monitor/engine.ts";
import { registration } from "../../extensions/monitor/contract.ts";
import {
  allowance,
  supervision,
} from "../coordinate-repo/scripts/supervision.js";

test("unknown parent handoff retains attempted identity without resetting shared allowances", async (t) => {
  let done;
  const attempted = new Promise((r) => {
    done = r;
  });
  const keepalive = setInterval(() => {}, 1000);
  let calls = 0;
  const engine = new MonitorEngine({
    idle: () => true,
    persist() {},
    changed() {},
    handoff(r) {
      calls++;
      done(r);
      throw Error("unknown API outcome");
    },
    evaluate() {
      throw Error("no evaluator");
    },
    async subscribe(_s, _r, _signal, _deadline, emit) {
      emit({ mailbox: "stack" });
      return { coverage: { mailbox: "stack" }, close() {} };
    },
  });
  t.after(() => {
    engine.close(false);
    clearInterval(keepalive);
  });
  const now = Date.now();
  let state = supervision(
    allowance(now + 6000, 2),
    {
      action: "reserve",
      group: "stack",
      members: ["ticket-a"],
      reference: "/intent",
    },
    now,
  );
  const bounds = state.groups.stack.pending;
  const r = await engine.start(
    registration({
      name: "parent",
      message: "Reconcile mailbox",
      providers: ["mailbox"],
      events: [{ provider: "mailbox", event: "changed", args: ["stack"] }],
      cycle_timeout_ms: bounds.cycleMs,
      lifetime_ms: bounds.lifetimeMs,
      max_wakes: 1,
    }),
  );
  // Retain the actual registration bounds rather than allowing elapsed setup to extend the deadline.
  assert.ok(r.createdAt >= now);
  await attempted;
  const receipt = engine.get(r.id);
  assert.equal(receipt.lastAttention.disposition, "handoff_unknown");
  assert.equal(receipt.wakes, 1);
  engine.settled();
  engine.cancel(r.id);
  assert.equal(calls, 1);
  assert.equal(
    state.groups.stack.pending.id,
    null,
    "uncertain attachment remains reserved, not replayable",
  );
  assert.throws(
    () =>
      supervision(state, {
        action: "reserve",
        group: "stack",
        members: ["ticket-b"],
        reference: "/replacement",
      }),
    /reconcile/,
  );
});
