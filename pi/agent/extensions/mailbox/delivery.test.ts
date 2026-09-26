import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Delivery } from "./delivery.ts";
import { MailboxStore, _durability, type Message } from "./store.ts";
import { DEFAULTS, validateConfig } from "./config.ts";
import { claimConsumer } from "./consumer.ts";
import { SESSION } from "./fixture.ts";
function fixture(t: TestContext, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "mailbox-delivery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new MailboxStore(root);
  let now = 10000;
  const wakes: { rows: Message[]; at: number }[] = [],
    warnings: number[] = [];
  const handoff = (rows: Message[], at: number) => {
    wakes.push({ rows, at });
  };
  const engine = new Delivery(
    store,
    SESSION,
    { ...DEFAULTS, ...options },
    handoff,
    (n) => warnings.push(n),
    () => now,
  );
  return {
    store,
    engine,
    wakes,
    warnings,
    handoff,
    time: (n: number) => {
      now = n;
    },
    send: (body = "body") => store.send(SESSION, "instruction", body, SESSION),
  };
}
test("fixed window does not slide with arrivals; holds accrue no attempts or visibility", (t) => {
  const h = fixture(t);
  const a = h.send();
  assert.equal(h.engine.tick(null).wakeAt, 15000);
  for (let time = 11000; time <= 20000; time += 1000) {
    h.time(time);
    h.send();
    assert.equal(h.engine.tick("idle").wakeAt, 15000);
  }
  assert.equal(h.wakes.length, 0);
  assert.equal(h.store.list(SESSION).messages[0].attempts, 0);
  assert.equal(h.store.list(SESSION).messages[0].visibleUntil, null);
  h.engine.tick("draft");
  h.engine.tick("dialog");
  h.engine.tick(null);
  assert.equal(h.wakes.length, 1);
  assert.equal(h.wakes[0].rows.length, 11);
  const actual = h.store.list(SESSION).messages[0];
  assert.equal(actual.id, a.id);
  assert.equal(actual.visibleUntil, 320000);
  assert.equal(actual.attempts, 1);
  h.engine.tick(null);
  assert.equal(h.wakes.length, 1);
});
test("zero window, byte overflow, ACK recheck and atomic clear preserve later sends", (t) => {
  const h = fixture(t, { batchWindowMs: 0 });
  const a = h.send("a".repeat(8192)),
    b = h.send("b".repeat(8192));
  h.engine.tick("draft");
  h.store.ack(SESSION, [a.id]);
  h.engine.tick(null);
  assert.deepEqual(
    h.wakes[0].rows.map((r) => r.id),
    [b.id],
  );
  h.send("c".repeat(8192));
  h.send("d".repeat(8192));
  h.engine.tick(null);
  h.engine.tick(null);
  assert.equal(h.wakes.length, 3);
  h.send();
  h.engine.tick("idle");
  assert.equal(h.engine.clear(), 4);
  h.engine.tick(null);
  assert.equal(h.wakes.length, 3);
  const fresh = h.send();
  h.engine.tick(null);
  assert.deepEqual(
    h.wakes.at(-1)!.rows.map((r) => r.id),
    [fresh.id],
  );
});
test("stable ID/sender/time redeliver, reset visibility, stop at limit and warn once; new mail unaffected", (t) => {
  const h = fixture(t, { batchWindowMs: 0, visibilityTimeoutMs: 1000 });
  const sent = h.send();
  h.engine.tick(null);
  h.time(10999);
  h.engine.tick(null);
  assert.equal(h.wakes.length, 1);
  h.time(11000);
  h.engine.tick(null);
  h.time(11999);
  h.engine.tick(null);
  assert.equal(h.wakes.length, 2);
  h.time(12000);
  const status = h.engine.tick(null);
  assert.equal(status.limited, 1);
  assert.deepEqual(h.warnings, [1]);
  h.time(999999);
  h.engine.tick(null);
  assert.equal(h.wakes.length, 3);
  for (let i = 0; i < 3; i++) {
    const row = h.wakes[i].rows[0];
    assert.equal(row.id, sent.id);
    assert.equal(row.sender, SESSION);
    assert.equal(row.at, sent.at);
    assert.equal(row.attempts, i + 1);
  }
  h.send();
  h.engine.tick(null);
  assert.equal(h.wakes.length, 4);
  assert.equal(h.store.list(SESSION).pending, 2);
  h.store.ack(SESSION, [sent.id]);
  assert.equal(h.engine.tick(null).limited, 0);
});
test("uncertain handoff delays same-ID redelivery; durable orphan intent never blindly replays", (t) => {
  const h = fixture(t, { batchWindowMs: 0 });
  h.send();
  const engine = new Delivery(
    h.store,
    SESSION,
    { ...DEFAULTS, batchWindowMs: 0 },
    () => {
      throw Error("unknown");
    },
    () => {},
    () => 10000,
  );
  assert.equal(engine.tick(null).uncertain, 1);
  assert.equal(h.store.list(SESSION).messages[0].attempts, 1);
  engine.tick(null);
  assert.equal(h.store.list(SESSION).messages[0].attempts, 1);
  h.engine.clear();
  h.send();
  t.mock.method(_durability, "syncDirectory", () => {
    throw Error("disk");
  });
  h.engine.tick(null);
  assert.equal(h.wakes.length, 0);
  const restored = new MailboxStore(h.store.root).snapshot(SESSION)[0];
  assert.equal(restored.uncertain, true);
  assert.equal(restored.visibleUntil, null);
});
test("ACK and clear cannot interleave inside handoff; pending clear invalidates cursors", (t) => {
  const h = fixture(t);
  const sent = h.send();
  h.send();
  const cursor = h.store.list(SESSION, 1).nextCursor!;
  h.store.deliver(SESSION, 3, 1000, (rows) => {
    assert.equal(rows.length, 2);
    assert.throws(() => h.store.ack(SESSION, [sent.id]), /storage_failed/);
    assert.throws(() => h.store.clear(SESSION), /storage_failed/);
    assert.throws(() => h.send(), /storage_failed/);
  });
  assert.equal(h.store.clear(SESSION), 2);
  h.send();
  assert.throws(() => h.store.list(SESSION, 1, cursor), /invalid_input/);
});
test("exclusive consumer releases idempotently; duplicate consumer cannot take ownership", (t) => {
  const h = fixture(t);
  const release = claimConsumer(h.store, SESSION);
  const original = readFileSync(
    join(h.store.root, `${SESSION}.consumer/owner.json`),
  );
  assert.throws(() => claimConsumer(h.store, SESSION));
  assert.deepEqual(
    readFileSync(join(h.store.root, `${SESSION}.consumer/owner.json`)),
    original,
  );
  release();
  release();
  claimConsumer(h.store, SESSION)();
});
test("configuration rejects weakening inputs rather than silently falling back", () => {
  assert.deepEqual(validateConfig({}), DEFAULTS);
  assert.equal(validateConfig({ batchWindowMs: 0 }).batchWindowMs, 0);
  for (const value of [
    { batchWindowMs: -1 },
    { maxDeliveryAttempts: 0 },
    { maxDeliveryAttempts: Infinity },
    { visibilityTimeoutMs: 0 },
    { unexpected: true },
    { batchWindowMs: "0" },
  ])
    assert.throws(() => validateConfig(value));
});
