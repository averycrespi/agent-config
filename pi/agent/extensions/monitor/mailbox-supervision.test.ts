import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { MonitorEngine, type Clock } from "./engine.ts";
import { registration, type Receipt } from "./contract.ts";
import { MailboxStore } from "../mailbox/store.ts";
import { mailboxSupervision, type BatchCheckpoint } from "../mailbox/api.ts";
import { temporaryRoot } from "./test-support.ts";

async function fixture(
  t: TestContext,
  options: { unknown?: boolean; maxWakes?: number; lifetime?: number } = {},
) {
  let now = 10000,
    busy = true,
    seq = 0;
  t.mock.method(Date, "now", () => now);
  const tmp = temporaryRoot();
  const store = new MailboxStore(tmp.root);
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    set(fn, delay) {
      const id = ++seq;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clear(id) {
      timers.delete(id as number);
    },
  };
  const messages: Receipt[] = [];
  const engine = new MonitorEngine(
    {
      idle: () => !busy,
      changed() {},
      persist() {},
      handoff(r, message) {
        assert.match(message, /durably incorporate/);
        assert.match(message, /Unacknowledged messages/);
        messages.push(r);
        busy = true;
        if (options.unknown) throw new Error("uncertain handoff");
      },
      subscribe: async () => ({ coverage: {}, close() {} }),
      evaluate: async (_reg, _trigger, state) => ({
        status: "success",
        json: JSON.stringify(
          store.observe(
            "p",
            state as BatchCheckpoint | null,
            { count: 3, ageMs: 1000, reminderMs: 5000 },
            now,
          ),
        ),
        traces: [],
        effectsMayPersist: false,
        partialExecution: false,
        outcomeUnknown: false,
      }),
    },
    clock,
  );
  t.after(() => {
    engine.close(false);
    tmp.remove();
  });
  async function advance(ms = 0) {
    const target = now + ms;
    for (let steps = 0; ; steps++) {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const next = [...timers]
        .filter(([, v]) => v.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(steps < 1000, "bounded scheduling");
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = target;
  }
  const send = () => store.send("p", "result", "retained report");
  // Initial durable catch-up needs no notification, even for a pre-registration burst.
  for (let i = 0; i < 3; i++) send();
  const receipt = await engine.start(
    registration({
      ...mailboxSupervision({ mailbox: "p", events: false }),
      name: "reports",
      interval_ms: 1000,
      cycle_timeout_ms: 20000,
      lifetime_ms: options.lifetime ?? 60000,
      max_wakes: options.maxWakes ?? 10,
    }),
  );
  const settle = async () => {
    busy = false;
    const last = engine.get(receipt.id)?.lastAttention;
    if (last) engine.admitted(last.id);
    engine.settled();
    await advance();
  };
  return { engine, store, messages, advance, send, settle, id: receipt.id };
}

test("recurring burst coalesces, missed ACK reminds, handling arrivals survive and ACK stops conditions", async (t) => {
  const f = await fixture(t);
  await f.advance();
  assert.equal(f.messages.length, 0);
  f.send(); // Lost event, discovered by polling while attention is pending.
  await f.advance(1000);
  await f.settle();
  assert.equal(f.messages.length, 1);
  assert.equal(f.store.list("p").pending, 4);
  await f.advance(1000);
  await f.settle();
  assert.equal(
    f.messages.length,
    1,
    "covered reports cannot immediately wake again",
  );
  await f.advance(4000);
  assert.equal(
    f.messages.length,
    2,
    "missed ACK causes delayed notification, not report send",
  );
  assert.equal(f.store.list("p").pending, 4);
  f.send();
  await f.advance(1000);
  assert.equal(f.messages.length, 2, "attention waits while handling");
  await f.settle();
  assert.equal(
    f.messages.length,
    3,
    "new report age qualifies independently of old cooldown",
  );
  f.store.ack(
    "p",
    f.store.list("p").messages.map((m) => m.id),
  );
  await f.settle();
  await f.advance(6000);
  assert.equal(f.messages.length, 3, "ACK before reminder removes eligibility");
  assert.equal(
    f.engine.get(f.id)?.status,
    "active",
    "normal handling never re-registers",
  );
});

test("unknown handoff never replays and leaves durable reports", async (t) => {
  const f = await fixture(t, { unknown: true });
  await f.advance();
  await f.settle();
  await f.advance(15000);
  assert.equal(f.messages.length, 1);
  assert.equal(f.engine.get(f.id)?.failureCode, "handoff_unknown");
  assert.equal(f.store.list("p").pending, 3);
});

test("cancellation, wake cap and lifetime end attention without evicting reports", async (t) => {
  const f = await fixture(t, { maxWakes: 2 });
  await f.advance();
  await f.settle();
  await f.settle();
  await f.advance(5000);
  await f.settle();
  await f.advance(10000);
  assert.equal(f.messages.length, 2);
  assert.equal(f.engine.get(f.id)?.failureCode, "wake_limit");
  assert.equal(f.store.list("p").pending, 3);
});

test("cancelled pending attention is suppressed, polling gaps retain all reports", async (t) => {
  const f = await fixture(t);
  await f.advance();
  f.engine.cancel(f.id);
  f.send();
  await f.settle();
  await f.advance(15000);
  assert.equal(f.messages.length, 0);
  assert.equal(f.engine.get(f.id)?.status, "cancelled");
  assert.equal(f.store.list("p").pending, 4);
  assert.equal(
    f.store.observe("p").decision,
    "wake",
    "new explicitly authorized registration can catch up",
  );
});

test("lifetime expiry cannot reset original allowance during unadmitted handoff", async (t) => {
  const f = await fixture(t, { lifetime: 6000 });
  await f.advance();
  await f.settle();
  await f.advance(6000);
  assert.equal(f.engine.get(f.id)?.failureCode, "lifetime_limit");
  assert.equal(f.messages.length, 1, "no replay for unadmitted handoff");
  assert.equal(f.store.list("p").pending, 3);
});
