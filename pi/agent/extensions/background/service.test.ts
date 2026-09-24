import assert from "node:assert/strict";
import { test } from "node:test";
import { Service } from "./service.ts";
import type { Execution, Outcome } from "./api.ts";
import { LIMITS } from "./store.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  let records: Execution[] = [],
    fail = false,
    idle = false,
    visible = true;
  const sent: Execution[] = [],
    events: string[] = [];
  let uncertain = false;
  const store = {
    read: () => structuredClone(records),
    write: (r: Execution[]) => {
      if (fail) throw Error("disk");
      records = structuredClone(r);
    },
  };
  const hooks = {
    anchor: () => "anchor",
    inBranch: () => visible,
    idle: () => idle,
    changed() {},
    handoff(r: Execution) {
      sent.push(r);
      if (uncertain) throw Error("uncertain");
    },
    event(type: string) {
      events.push(type);
    },
  };
  const service = new Service(store, hooks);
  return {
    service,
    store,
    hooks,
    sent,
    events,
    fail: () => {
      fail = true;
    },
    idle: () => {
      idle = true;
    },
    hide: () => {
      visible = false;
    },
    uncertain: () => {
      uncertain = true;
    },
  };
}
const success: Outcome = {
  status: "success",
  effectsMayPersist: false,
  outcomeUnknown: false,
  result: { answer: 42 },
};
const request = (run: (s: AbortSignal) => Promise<Outcome>) => ({
  owner: "script",
  label: "bounded",
  deadlineMs: Date.now() + 5000,
  run,
});
test("persisted admission precedes work; terminal intent, uncertain handoff and consumption are separate and once-only", async () => {
  const h = harness();
  let started = false;
  const r = h.service.admit(
    request(async () => {
      started = true;
      assert.equal(h.store.read()[0].id, r.id);
      return success;
    }),
  );
  assert.equal(started, false);
  await tick();
  assert.equal(h.service.inspect("script", r.id).notification.intent, true);
  assert.equal(h.sent.length, 0);
  h.uncertain();
  h.idle();
  h.service.flush();
  h.service.flush();
  assert.equal(h.sent.length, 1);
  assert.equal(
    h.service.inspect("script", r.id).notification.handoff,
    "unknown",
  );
  assert.equal(h.service.inspect("script", r.id).notification.consumed, false);
  h.service.consumed(new Set([r.notification.id]));
  assert.equal(h.service.inspect("script", r.id).notification.consumed, true);
  assert.deepEqual(h.service.inspect("script", r.id).result, { answer: 42 });
  h.service.close();
});
test("failed admission starts no work; failed settlement aborts peers and retains honest uncertainty", async () => {
  const h = harness();
  h.fail();
  let called = false;
  assert.throws(
    () =>
      h.service.admit(
        request(async () => {
          called = true;
          return success;
        }),
      ),
    /storage/,
  );
  await tick();
  assert.equal(called, false);
  const j = harness();
  let finish!: (o: Outcome) => void;
  const r = j.service.admit(
    request(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await tick();
  j.fail();
  finish(success);
  await tick();
  const state = j.service.inspect("script", r.id);
  assert.equal(state.persistenceFailed, true);
  assert.equal(state.outcomeUnknown, true);
  assert.throws(
    () => j.service.admit(request(async () => success)),
    /unavailable/,
  );
});
test("cancel requests abort; dismiss rejects active runs, retains evidence and cannot retract handed messages", async () => {
  const h = harness();
  let signal!: AbortSignal;
  let done!: (o: Outcome) => void;
  const r = h.service.admit(
    request((s) => {
      signal = s;
      return new Promise((resolve) => {
        done = resolve;
      });
    }),
  );
  await tick();
  assert.throws(() => h.service.dismiss("script", r.id), /active/);
  h.service.cancel("script", r.id);
  assert.equal(signal.aborted, true);
  done({
    ...success,
    status: "cancelled",
    effectsMayPersist: true,
    outcomeUnknown: true,
  });
  await tick();
  h.idle();
  h.service.flush();
  h.service.dismiss("script", r.id);
  assert.equal(h.sent.length, 1);
  assert.equal(h.service.inspect("script", r.id).dismissed, true);
  assert.deepEqual(h.service.inspect("script", r.id).result, success.result);
  h.service.close();
});
test("navigation/shutdown revoke handles; restored interrupted runs never replay; stale completion cannot overwrite", async () => {
  const h = harness();
  let finish!: (o: Outcome) => void;
  const r = h.service.admit(
    request(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await tick();
  h.service.close();
  finish(success);
  await tick();
  assert.equal(h.store.read()[0].status, "interrupted");
  assert.throws(
    () => h.service.admit(request(async () => success)),
    /unavailable/,
  );
  const restored = new Service(h.store, h.hooks);
  assert.equal(restored.inspect("script", r.id).outcomeUnknown, true);
  h.hide();
  assert.deepEqual(restored.list("script"), []);
  restored.close();
});
test("progress validates atomically, persists partial accounting, and ignores stale callbacks", async () => {
  const h = harness();
  let report!: Parameters<import("./api.ts").Admission["run"]>[1];
  const r = h.service.admit({
    ...request(() => new Promise(() => {})),
    run: async (_s, update) => {
      report = update;
      return await new Promise<Outcome>(() => {});
    },
  });
  await tick();
  report({
    progress: { completed: 1, total: 2, failed: 1 },
    result: { usage: 5 },
  });
  const before = h.service.inspect("script", r.id);
  assert.throws(
    () => report({ progress: { completed: 0, total: 2, failed: 0 } }),
    /invalid_progress/,
  );
  assert.throws(
    () => report({ progress: { completed: 3, total: 2, failed: 0 } }),
    /invalid_progress/,
  );
  assert.deepEqual(h.service.inspect("script", r.id), before);
  assert.deepEqual(h.events, ["admitted"]);
  h.service.close();
  report({
    progress: { completed: 2, total: 2, failed: 1 },
    result: { usage: 10 },
  });
  assert.deepEqual(h.store.read()[0].result, { usage: 5 });
  assert.equal(h.store.read()[0].status, "interrupted");
});

test("finite active and retained limits never silently evict unresolved outcomes", async () => {
  const h = harness();
  for (let i = 0; i < LIMITS.active; i++)
    h.service.admit(request(() => new Promise(() => {})));
  assert.throws(
    () => h.service.admit(request(async () => success)),
    /capacity/,
  );
  h.service.close();
  const j = harness();
  for (let i = 0; i < LIMITS.retained; i++) {
    j.service.admit(request(async () => success));
    await tick();
  }
  assert.equal(j.service.list("script").length, LIMITS.retained);
  assert.throws(
    () => j.service.admit(request(async () => success)),
    /capacity/,
  );
  j.service.close();
});
