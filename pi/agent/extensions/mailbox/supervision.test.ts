import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MailboxStore } from "./store.ts";
import {
  batchPolicy,
  observeBatch,
  type BatchCheckpoint,
} from "./supervision.ts";
import { mailboxSupervision, MAILBOX_WAKE_GUIDANCE } from "./api.ts";
import { temporaryRoot } from "../monitor/test-support.ts";

const epoch = "11111111-1111-1111-1111-111111111111";
const policy = { count: 3, ageMs: 1000, reminderMs: 5000 };
const snapshot = (rows: { seq: number; at: number }[]) => ({
  epoch,
  sequence: rows.at(-1)?.seq ?? 0,
  rows,
});

test("initial, burst, nonempty age, continuous arrivals and missed ACK cooldown", () => {
  let state: BatchCheckpoint | null = null;
  const rows: { seq: number; at: number }[] = [];
  const observe = (at: number) => {
    const value = observeBatch("p", snapshot(rows), state, policy, at);
    state = value.state;
    return value;
  };
  assert.equal(observe(100000).decision, "wait");
  rows.push({ seq: 1, at: 100000 });
  assert.equal(observe(100999).decision, "wait");
  rows.push({ seq: 2, at: 100999 });
  assert.equal(observe(101000).decision, "wake");
  assert.equal(observe(101001).decision, "wait");
  assert.equal(observe(105999).decision, "wait");
  assert.equal(observe(106000).evidence.reminder, true);
  assert.equal(observe(106001).decision, "wait");
  rows.push(
    { seq: 3, at: 106002 },
    { seq: 4, at: 106002 },
    { seq: 5, at: 106002 },
  );
  assert.equal(observe(106002).decision, "wake");
  assert.equal(observe(106003).decision, "wait");
  assert.equal(observe(106003).state?.through, 5);
});

test("snapshot observes beyond body pagination; ACK races and mixed batches retain eligibility without writes", (t) => {
  const tmp = temporaryRoot();
  t.after(tmp.remove);
  const store = new MailboxStore(tmp.root);
  const sent = Array.from({ length: 110 }, () =>
    store.send("p", "result", "x".repeat(8000)),
  );
  const before = readFileSync(join(tmp.root, "p.json"));
  const at = Date.now();
  const first = store.observe("p", null, policy, at);
  assert.equal(first.decision, "wake");
  assert.equal(first.evidence.pending, 110);
  assert.ok(store.list("p", 50).messages.length < 50);
  assert.deepEqual(readFileSync(join(tmp.root, "p.json")), before);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 4096);
  store.ack(
    "p",
    sent.slice(0, 100).map((m) => m.id),
  );
  store.ack(
    "p",
    sent.slice(100).map((m) => m.id),
  );
  assert.equal(
    store.observe("p", first.state, policy, at + 6000).decision,
    "wait",
  );
  const newMessage = store.send("p", "question", "new during handling");
  const fresh = store.observe("p", first.state, policy, newMessage.at + 999);
  assert.equal(fresh.decision, "wait");
  assert.equal(fresh.evidence.fresh, 1);
  assert.equal(
    store.observe("p", first.state, policy, newMessage.at + 1000).decision,
    "wake",
  );
  // ACK between an observation and its caller committing state cannot hide subsequent sends.
  store.ack("p", [newMessage.id]);
  const later = store.send("p", "result", "after snapshot");
  const after = store.observe("p", fresh.state, policy, later.at + 1000);
  assert.equal(after.decision, "wake");
  assert.equal(after.evidence.fresh, 1);
  assert.equal(store.list("p").messages[0].id, later.id);
});

test("incarnation changes requalify, invalid policy/state fail closed, no report copies", () => {
  const old = { mailbox: "p", epoch, through: 9, notifiedAt: 1000 };
  const next = {
    epoch: "22222222-2222-2222-2222-222222222222",
    sequence: 1,
    rows: [{ seq: 1, at: 1000 }],
  };
  assert.equal(observeBatch("p", next, old, policy, 2000).decision, "wake");
  assert.throws(
    () => observeBatch("other", next, old, policy, 2000),
    /invalid_input/,
  );
  assert.throws(
    () => observeBatch("p", snapshot([]), old, policy, 2000),
    /invalid_input/,
  );
  for (const p of [
    { count: 0 },
    { count: 1001 },
    { ageMs: 999 },
    { reminderMs: 60000 },
    { ageMs: NaN },
    { unknown: 1 },
  ]) {
    assert.throws(() => batchPolicy(p), /invalid_input/);
  }
  assert.deepEqual(batchPolicy({ count: 1 }), {
    count: 1,
    ageMs: 60000,
    reminderMs: 300000,
  });
  const recipe = mailboxSupervision({
    mailbox: "p",
    policy,
    instructions: "Read the current index.",
  });
  assert.equal(recipe.recurring, true);
  assert.ok(recipe.message.startsWith(MAILBOX_WAKE_GUIDANCE));
  assert.equal(
    recipe.source,
    'return await mailbox.observe("p", state, {"count":3,"ageMs":1000,"reminderMs":5000});',
  );
  assert.equal(Object.hasOwn(recipe, "lifetime_ms"), false);
  assert.equal(
    Object.hasOwn(
      mailboxSupervision({ mailbox: "p", events: false }),
      "events",
    ),
    false,
  );
});
