import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BackgroundEngine } from "../../extensions/background/engine.ts";
import { registration } from "../../extensions/background/contract.ts";
import {
  Bridge,
  subscribeEvents,
} from "../../extensions/background/session-transport.ts";
import { temporaryRoot } from "../../extensions/background/test-support.ts";
import { updateMonitor } from "../work-ticket/scripts/ci-background.js";

const filters = [
  "agent_settled",
  "ask-user:input_requested",
  "session_shutdown",
];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test(
  "stable exact-incarnation observation catches registration gaps without completing pending child CI",
  { timeout: 10000 },
  async (t) => {
    const temp = temporaryRoot();
    const child = new Bridge(temp.root, randomUUID());
    await child.start();
    const keepalive = setInterval(() => {}, 1000);
    t.after(() => {
      child.close();
      clearInterval(keepalive);
      temp.remove();
    });
    const pr = "https://github.com/example/project/pull/1",
      head = "a".repeat(40);
    let ledger = updateMonitor(
      null,
      { operation: "watch", pr, head, required: ["Verify"] },
      0,
    );
    ledger = updateMonitor(
      ledger,
      {
        operation: "observe",
        observation: {
          head,
          requirementsKnown: true,
          checks: [{ name: "Verify", state: "pending" }],
          reference: "synthetic pending CI",
        },
      },
      0,
    );
    ledger = updateMonitor(ledger, { operation: "prepare" }, 0);
    ledger = updateMonitor(
      ledger,
      {
        operation: "attach",
        pr,
        head,
        receipt: {
          id: randomUUID(),
          createdAt: 0,
          deadline: 1800000,
          cycleMs: 1500000,
          recurring: false,
          maxWakes: 1,
          status: "active",
        },
      },
      0,
    );
    const retainedCI = structuredClone(ledger);
    const now = Date.now();
    const parentDeadline = now + 30000;
    const jobs = [];
    for (const event of filters) {
      const delivered = deferred(),
        attention = deferred();
      const subscriptions = [];
      let busy = true;
      const engine = new BackgroundEngine(
        {
          idle: () => !busy,
          persist(r) {
            if (r.attention?.disposition === "pending") attention.resolve(r);
          },
          changed() {},
          handoff(r) {
            delivered.resolve(r);
            busy = true;
          },
          evaluate() {
            throw Error("parent must not poll child CI");
          },
          async subscribe(selection, _reg, signal, deadline, emit, lost) {
            subscriptions.push(selection);
            const observed = deferred();
            const sub = await subscribeEvents(
              temp.root,
              selection.args[0],
              selection.args[1],
              deadline - Date.now(),
              (notice) => {
                emit({ ...notice });
                observed.resolve(notice);
              },
              lost,
              signal,
            );
            // Transport filters are installed, but engine registration has not returned.
            child.publish(
              event,
              event === "ask-user:input_requested"
                ? { requestId: randomUUID() }
                : {},
            );
            await observed.promise;
            return {
              coverage: { ...sub.target, startedAt: sub.startedAt },
              close: sub.close,
            };
          },
        },
        {
          // Fix caller/host time together; transport still exercises real ACK ordering.
          now: () => now,
          set: (fn, ms) => setTimeout(fn, ms),
          clear: (timer) => clearTimeout(timer),
        },
      );
      t.after(() => engine.close(false));
      // Events in the uncovered replacement interval must not be replayed.
      child.publish("agent_settled", {});
      const r = await engine.start(
        registration({
          name: "parent session attention",
          message: "Reconcile child, not CI completion",
          providers: ["sessions"],
          events: [
            {
              provider: "sessions",
              event: "lifecycle",
              args: [child.target.incarnation, filters],
            },
          ],
          cycle_timeout_ms: 25000,
          lifetime_ms: parentDeadline - now,
          max_wakes: 1,
        }),
      );
      jobs.push(r.id);
      const pending = await attention.promise;
      assert.equal(pending.status, "finished");
      assert.equal(pending.attention.disposition, "pending");
      assert.equal(pending.wakes, 0);
      assert.equal(pending.evidence.name, event);
      assert.deepEqual(subscriptions[0].args, [
        child.target.incarnation,
        filters,
      ]);
      assert.equal(pending.coverage[0].incarnation, child.target.incarnation);
      assert.equal(pending.coverage[0].sessionId, child.target.sessionId);
      assert.ok(pending.deadline <= parentDeadline);
      assert.deepEqual(
        ledger,
        retainedCI,
        "parent attention neither qualifies nor changes child-owned CI",
      );
      busy = false;
      engine.settled();
      const sent = await delivered.promise;
      assert.equal(sent.wakes, 1);
      const final = engine.get(r.id);
      assert.equal(final.lastAttention.disposition, "handed_to_pi");
      assert.equal(final.lastAttention.admitted, false);
      // Return from handoff is not positive runtime admission or delivery completion.
      engine.admitted(final.lastAttention.id);
      assert.equal(engine.get(r.id).lastAttention.admitted, true);
      engine.settled();
      assert.equal(engine.get(r.id).wakes, 1);
      assert.deepEqual(ledger, retainedCI);
      engine.cancel(r.id);
      engine.close(false);
    }
    assert.equal(new Set(jobs).size, 3);
    const old = child.target.incarnation;
    child.close();
    const replacement = new Bridge(temp.root, child.target.sessionId);
    await replacement.start();
    t.after(() => replacement.close());
    assert.notEqual(replacement.target.incarnation, old);
    await assert.rejects(
      subscribeEvents(
        temp.root,
        old,
        filters,
        1000,
        () => {},
        () => {},
      ),
    );
  },
);

test(
  "unknown parent handoff retains attempted identity and cannot be resent on settlement",
  { timeout: 5000 },
  async (t) => {
    const attempted = deferred();
    const keepalive = setInterval(() => {}, 1000);
    let calls = 0;
    const engine = new BackgroundEngine({
      idle: () => true,
      persist() {},
      changed() {},
      handoff(r) {
        calls++;
        attempted.resolve(r);
        throw Error("synthetic unknown API outcome");
      },
      evaluate() {
        throw Error("no evaluator");
      },
      async subscribe(_selection, _reg, _signal, _deadline, emit) {
        emit({ name: "agent_settled" });
        return { coverage: { fixture: true }, close() {} };
      },
    });
    t.after(() => {
      engine.close(false);
      clearInterval(keepalive);
    });
    const r = await engine.start(
      registration({
        name: "parent",
        message: "Reconcile unknown handoff",
        providers: ["sessions"],
        events: [
          {
            provider: "sessions",
            event: "lifecycle",
            args: [randomUUID(), filters],
          },
        ],
        cycle_timeout_ms: 1000,
        lifetime_ms: 2000,
        max_wakes: 1,
      }),
    );
    await attempted.promise;
    const receipt = engine.get(r.id);
    assert.equal(receipt.lastAttention.disposition, "handoff_unknown");
    assert.equal(receipt.wakes, 1);
    engine.admitted(randomUUID());
    engine.settled();
    engine.cancel(r.id);
    assert.equal(calls, 1);
    assert.equal(engine.get(r.id).lastAttention.id, receipt.lastAttention.id);
    assert.equal(engine.get(r.id).lastAttention.disposition, "handoff_unknown");
  },
);
