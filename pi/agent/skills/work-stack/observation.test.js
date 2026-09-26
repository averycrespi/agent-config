import assert from "node:assert/strict";
import test from "node:test";
import { MonitorEngine } from "../../extensions/monitor/engine.ts";
import { registration } from "../../extensions/monitor/contract.ts";

test("unknown parent handoff stays in original Monitor receipt without shadow accounting or replay", async (t) => {
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
  const r = await engine.start(
    registration({
      name: "parent",
      message: "Reconcile mailbox",
      providers: ["mailbox"],
      events: [{ provider: "mailbox", event: "changed", args: ["stack"] }],
      cycle_timeout_ms: 6000,
      lifetime_ms: 6000,
      max_wakes: 1,
    }),
  );
  await attempted;
  const receipt = engine.get(r.id);
  assert.equal(receipt.lastAttention.disposition, "handoff_unknown");
  assert.equal(receipt.wakes, 1);
  engine.settled();
  engine.cancel(r.id);
  assert.equal(calls, 1);
  assert.equal(engine.get(r.id).wakes, 1);
  assert.equal(engine.get(r.id).deadline, r.deadline);
});
