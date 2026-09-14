import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { WatchEngine, type Receipt } from "./engine.ts";
import { type Notice } from "./events.ts";
import { type Observation } from "./transport.ts";
import { pause } from "./test-support.ts";
import { restore, RECEIPT_TYPE } from "./receipts.ts";

function fixture() {
  const results: Array<(event?: Notice) => void> = [];
  const messages: Receipt[] = [],
    saved: Receipt[] = [],
    events: any[] = [];
  let closes = 0,
    failPersist = false,
    failSend = false;
  const engine = new WatchEngine("/fixture", randomUUID(), {
    async observe(_root, target) {
      let done!: (n?: Notice) => void;
      const result = new Promise<Notice | undefined>((resolve) => {
        done = resolve;
      });
      results.push(done);
      return {
        target: { incarnation: target, sessionId: randomUUID() },
        startedAt: Date.now(),
        result,
        close() {
          closes++;
          done();
        },
      };
    },
    persist(r) {
      if (failPersist) throw Error("private persistence error");
      saved.push(r);
    },
    handoff(r) {
      messages.push(r);
      if (failSend) throw Error("private send error");
    },
    event(e) {
      events.push(e);
    },
    changed() {},
  });
  return {
    engine,
    results,
    messages,
    saved,
    events,
    get closes() {
      return closes;
    },
    failPersist() {
      failPersist = true;
    },
    failSend() {
      failSend = true;
    },
  };
}
const input = () => ({
  target: randomUUID(),
  events: ["agent_settled"],
  timeout_ms: 10_000,
  message: "Inspect the receipt",
});
const notice = (): Notice => ({
  name: "agent_settled",
  sequence: 1,
  at: Date.now(),
  metadata: {},
});

test("pending uses no messages, first match closes observation and hands off once", async () => {
  const h = fixture();
  const r = await h.engine.start(input());
  await pause();
  assert.equal(h.messages.length, 0);
  h.results[0](notice());
  await pause();
  assert.equal(h.messages.length, 1);
  assert.equal(h.closes, 1);
  assert.equal(h.engine.get(r.id)?.state, "match");
  assert.equal(h.engine.get(r.id)?.notification, "handed_to_pi");
  assert.equal(h.saved.at(-2)?.notification, "handoff_unknown");
  h.results[0](notice());
  await pause();
  assert.equal(h.messages.length, 1);
  assert.equal(h.engine.cancel(r.id)?.notification, "handed_to_pi");
  h.engine.close();
});

test("atomic validation, concurrent capacity, aborted registration and failed handshake leave no receipt", async () => {
  const h = fixture();
  await assert.rejects(
    h.engine.start({}),
    (error) =>
      /target/.test(String(error)) &&
      /events/.test(String(error)) &&
      /timeout/.test(String(error)) &&
      /message/.test(String(error)),
  );
  assert.deepEqual(h.engine.list(), []);
  await Promise.all(Array.from({ length: 4 }, () => h.engine.start(input())));
  await assert.rejects(h.engine.start(input()), /Four occupied/);
  assert.equal(h.engine.list().length, 4);
  h.engine.close();
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    fixture().engine.start(input(), aborted.signal),
    /cancelled/,
  );
  const failed = new WatchEngine("/fixture", randomUUID(), {
    persist() {},
    changed() {},
    event() {},
    handoff() {},
    async observe() {
      throw Error("missing");
    },
  });
  await assert.rejects(failed.start(input()));
  assert.deepEqual(failed.list(), []);
});

test("cancel suppresses pending handoff only, invalidation cleans all watches without messages", async () => {
  const h = fixture();
  const a = await h.engine.start(input()),
    b = await h.engine.start(input());
  h.results[0](notice());
  await Promise.resolve();
  assert.equal(h.engine.get(a.id)?.notification, "pending");
  h.engine.cancel(a.id);
  await pause();
  assert.equal(h.messages.length, 0);
  assert.equal(h.engine.get(b.id)?.state, "active");
  h.engine.close();
  h.results[1](notice());
  await pause();
  assert.equal(h.messages.length, 0);
  assert.equal(h.engine.get(b.id)?.state, "invalidated");
  assert.equal(h.closes, 2);
});

test("deadline, disconnect and uncertain handoff are distinct and never replayed", async () => {
  const h = fixture();
  const a = await h.engine.start({ ...input(), timeout_ms: 1000 });
  await pause(1050);
  assert.equal(h.engine.get(a.id)?.state, "deadline");
  const b = await h.engine.start(input());
  h.failSend();
  h.results[1]();
  await pause();
  assert.equal(h.engine.get(b.id)?.state, "failure");
  assert.equal(h.engine.get(b.id)?.notification, "handoff_unknown");
  const count = h.messages.length;
  h.engine.close();
  await pause();
  assert.equal(h.messages.length, count);
  const restored = fixture();
  restored.engine.restore(h.engine.list());
  await pause();
  assert.equal(restored.messages.length, 0);
  assert.equal(restored.engine.get(b.id)?.notification, "handoff_unknown");
  restored.engine.close();
});

test("result classification and receipt timestamp use one clock sample at the deadline edge", async (t) => {
  const h = fixture();
  t.mock.method(Date, "now", () => 1000);
  const r = await h.engine.start({ ...input(), timeout_ms: 1000 });
  let sample = 1999;
  t.mock.method(Date, "now", () => sample++);
  h.results[0]();
  await Promise.resolve();
  assert.equal(h.engine.get(r.id)?.state, "failure");
  assert.equal(h.engine.get(r.id)?.endedAt, 1999);
  h.engine.close();
});

test("persistence failure stops rather than continuing an unrecorded handoff", async () => {
  const h = fixture();
  const a = await h.engine.start(input());
  h.failPersist();
  h.results[0](notice());
  await pause();
  assert.equal(h.messages.length, 0);
  assert.equal(h.engine.get(a.id)?.notification, "suppressed");
  await assert.rejects(h.engine.start(input()), /inactive/);
});

test("restoration is bounded, rejects malformed records and invalidates active subscriptions", async () => {
  const h = fixture();
  const a = await h.engine.start(input());
  h.engine.close();
  let reads = 0;
  const entries: any[] = Array.from({ length: 4100 }, (_, i) => ({
    id: String(i),
    parentId: i ? String(i - 1) : null,
    type: "custom",
    customType: RECEIPT_TYPE,
    data: i === 0 ? a : { ...a, target: { incarnation: "../bad" } },
  }));
  const manager: any = {
    getLeafId: () => "4099",
    getEntry(id: string) {
      reads++;
      return entries[Number(id)];
    },
  };
  assert.deepEqual(restore(manager), []);
  assert.equal(reads, 4096);
  entries[4099].data = a;
  reads = 0;
  const recovered = restore(manager);
  assert.equal(recovered.length, 1);
  const next = fixture();
  next.engine.restore(recovered);
  assert.equal(next.engine.get(a.id)?.state, "invalidated");
  assert.equal(next.engine.get(a.id)?.notification, "suppressed");
  next.engine.close();
});

test("lifecycle interruption during async registration closes provisional transport", async () => {
  let resolve!: (o: Observation) => void,
    closes = 0;
  const engine = new WatchEngine("/fixture", randomUUID(), {
    persist() {},
    changed() {},
    event() {},
    handoff() {},
    observe: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = engine.start(input());
  engine.close();
  resolve({
    target: { incarnation: randomUUID(), sessionId: randomUUID() },
    startedAt: Date.now(),
    result: new Promise(() => {}),
    close() {
      closes++;
    },
  });
  await assert.rejects(pending, /session changed/);
  assert.equal(closes, 1);
  assert.deepEqual(engine.list(), []);
});
