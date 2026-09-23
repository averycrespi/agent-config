import assert from "node:assert/strict";
import { test } from "node:test";
import { BackgroundEngine } from "./engine.ts";
import { registration, type Receipt } from "./contract.ts";
import { temporaryRoot, pause } from "./test-support.ts";
import { MailboxStore } from "../mailbox/store.ts";

const source = "return {decision: 'wait', evidence: null};";
test("durable reports batch once, survive pending attention and registration gaps", async (t) => {
  const tmp = temporaryRoot();
  const store = new MailboxStore(tmp.root);
  let busy = true;
  const messages: Receipt[] = [];
  const engine = new BackgroundEngine({
    idle: () => !busy,
    persist() {},
    changed() {},
    handoff: (r) => {
      messages.push(r);
      busy = true;
    },
    subscribe: async () => ({ coverage: {}, close() {} }),
    evaluate: async (_r, trigger) => {
      const page = store.list("project");
      return {
        status: "success",
        json: JSON.stringify({
          decision:
            page.pending >= 3 ||
            (page.pending > 0 && trigger.at - page.oldestAt! >= 1000)
              ? "wake"
              : "wait",
          evidence: { pending: page.pending },
        }),
        traces: [],
        effectsMayPersist: false,
        partialExecution: false,
        outcomeUnknown: false,
      };
    },
  });
  t.after(() => {
    engine.close(false);
    tmp.remove();
  });
  // Reports before subscription are authoritative even with no notification listener.
  store.send("project", "question", "A");
  store.send("project", "question", "B");
  store.send("project", "result", "C");
  const input = {
    name: "reports",
    message: "Drain and persist before ack",
    providers: [],
    interval_ms: 1000,
    cycle_timeout_ms: 5000,
    lifetime_ms: 6000,
    max_wakes: 1,
    source,
  };
  const first = await engine.start(registration(input));
  for (let i = 0; i < 100 && engine.get(first.id)?.status === "active"; i++)
    await pause(10);
  assert.equal(engine.get(first.id)?.attention?.reason, "condition");
  store.send("project", "result", "D during pending attention");
  assert.equal(messages.length, 0);
  busy = false;
  engine.settled();
  for (let i = 0; i < 100 && !messages.length; i++) await pause(10);
  assert.equal(messages.length, 1);
  assert.equal(store.list("project").pending, 4);
  store.ack(
    "project",
    store.list("project").messages.map((m) => m.id),
  );
  store.send("project", "result", "registration gap");
  const next = await engine.start(registration(input));
  assert.equal(store.list("project").pending, 1);
  assert.equal(engine.get(next.id)?.status, "active");
  engine.close(true);
  assert.equal(new MailboxStore(tmp.root).list("project").pending, 1);
});

test("empty inbox never satisfies age policy; timeout is independent attention", async (t) => {
  const tmp = temporaryRoot();
  const store = new MailboxStore(tmp.root);
  t.after(() => tmp.remove());
  const decision = (now: number, threshold: number) => {
    const p = store.list("project");
    return (
      p.pending >= threshold || (p.pending > 0 && now - p.oldestAt! >= 1000)
    );
  };
  assert.equal(decision(Date.now() + 1000000, 3), false);
  const sent = store.send("project", "result", "one");
  assert.equal(decision(sent.at + 999, 3), false);
  assert.equal(decision(sent.at + 1000, 3), true);
  store.ack("project", [sent.id]);
  assert.equal(decision(sent.at + 1000000, 3), false);
});
