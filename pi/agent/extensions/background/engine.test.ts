import assert from "node:assert/strict";
import { test } from "node:test";
import { BackgroundEngine, type Clock, type Host } from "./engine.ts";
import { registration, type Receipt, type Trigger } from "./contract.ts";
import type { RunResult, JsonValue } from "../script/api.ts";
const success = (
  decision = "wait",
  evidence: JsonValue = null,
  state?: JsonValue,
): RunResult => ({
  status: "success",
  json: JSON.stringify({
    decision,
    evidence,
    ...(state === undefined ? {} : { state }),
  }),
  traces: [],
  effectsMayPersist: false,
  partialExecution: false,
  outcomeUnknown: false,
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(overrides: Partial<Host> = {}) {
  let now = 10000,
    busy = true,
    n = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    set(fn, delay) {
      const id = ++n;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clear(id) {
      timers.delete(id as number);
    },
  };
  const messages: Receipt[] = [],
    saved: Receipt[] = [],
    inputs: Trigger[] = [];
  let emit!: (v: JsonValue) => void, lost!: () => void;
  let closes = 0;
  const host: Host = {
    idle: () => !busy,
    persist: (r) => saved.push(r),
    changed() {},
    handoff(r) {
      messages.push(r);
      busy = true;
    },
    evaluate: async (_r, trigger) => {
      inputs.push(trigger);
      return success();
    },
    subscribe: async (_s, _r, _signal, _deadline, e, l) => {
      emit = e;
      lost = l;
      return { coverage: { at: now }, close: () => closes++ };
    },
    ...overrides,
  };
  const engine = new BackgroundEngine(host, clock);
  const reg = (extra: Record<string, unknown> = {}) =>
    registration({
      name: "fixture",
      message: "Inspect",
      providers: [],
      cycle_timeout_ms: 5000,
      lifetime_ms: 60000,
      max_wakes: 3,
      recurring: true,
      interval_ms: 1000,
      source: "return null;",
      ...extra,
    });
  async function advance(ms = 0) {
    const target = now + ms;
    for (let steps = 0; ; steps++) {
      await flush();
      const next = [...timers]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (steps > 1000) throw new Error("timer spin");
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = target;
    await flush();
  }
  return {
    engine,
    reg,
    advance,
    messages,
    saved,
    inputs,
    emit: (v: JsonValue) => emit(v),
    lost: () => lost(),
    closes: () => closes,
    idle: () => {
      busy = false;
      engine.settled();
    },
    admit: () => engine.admitted(messages.at(-1)!.lastAttention!.id),
    timers,
  };
}

test("observation end time excludes queued delivery and later cancellation", async () => {
  const f = fixture({ evaluate: async () => success("wake") });
  const r = await f.engine.start(f.reg({ recurring: false, max_wakes: 1 }));
  await f.advance();
  assert.equal(f.engine.get(r.id)!.endedAt, 10000);
  await f.advance(20000);
  f.engine.cancel(r.id);
  assert.equal(f.engine.get(r.id)!.endedAt, 10000);
  const active = await f.engine.start(f.reg());
  await f.advance(1000);
  f.engine.close(true);
  assert.equal(f.engine.get(active.id)!.endedAt, 31000);
});

test("atomic invalid registration and mandatory immutable bounds", () => {
  for (const patch of [
    { cycle_timeout_ms: undefined },
    { cycle_timeout_ms: 1500001 },
    { lifetime_ms: Infinity },
    { max_wakes: 0 },
    { recurring: false, max_wakes: 2 },
    { delay_ms: 1000, interval_ms: 1000 },
    { providers: ["state"] },
    { source: " " },
  ]) {
    assert.throws(() => fixture().reg(patch));
  }
  assert.throws(
    () => registration({}),
    /name[\s\S]*cycle_timeout_ms[\s\S]*lifetime_ms[\s\S]*max_wakes/,
  );
});

test("polling uses zero messages while waiting and no catch-up bursts", async () => {
  const f = fixture();
  await f.engine.start(f.reg());
  await f.advance();
  assert.equal(f.inputs.length, 1);
  assert.equal(f.messages.length, 0);
  await f.advance(999);
  assert.equal(f.inputs.length, 1);
  await f.advance(1);
  assert.equal(f.inputs.length, 2);
  f.engine.close(false);
  await f.advance(100000);
  assert.equal(f.inputs.length, 2);
});

test("equal polling interval/cycle expires after initial pending check despite longer lifetime", async () => {
  const f = fixture({
    evaluate: async () => success("wait", { ci: "pending" }),
  });
  const r = await f.engine.start(
    f.reg({
      recurring: false,
      max_wakes: 1,
      interval_ms: 30000,
      cycle_timeout_ms: 30000,
      lifetime_ms: 900000,
    }),
  );
  await f.advance(30000);
  const ended = f.engine.get(r.id)!;
  assert.equal(ended.evaluations, 1);
  assert.equal(ended.status, "finished");
  assert.equal(ended.attention!.reason, "timeout");
  assert.deepEqual(ended.evidence, { ci: "pending" });
  assert.equal(ended.failureCode, undefined);
  f.idle();
  await f.advance(900000);
  assert.equal(f.messages.length, 1);
  assert.equal(f.engine.get(r.id)!.evaluations, 1);
  f.engine.close(false);
});

test("longer cycle polls after evaluation settlement and observes CI passing beyond 30 seconds", async () => {
  let complete!: (result: RunResult) => void;
  const triggers: Trigger[] = [];
  const f = fixture({
    evaluate: async (_reg, trigger) => {
      triggers.push(trigger);
      if (triggers.length === 1)
        return new Promise((resolve) => {
          complete = resolve;
        });
      return success("wake", { ci: "passed" });
    },
  });
  const r = await f.engine.start(
    f.reg({
      recurring: false,
      max_wakes: 1,
      interval_ms: 30000,
      cycle_timeout_ms: 600000,
      lifetime_ms: 900000,
    }),
  );
  await f.advance(1300);
  complete(success("wait", { ci: "pending" }));
  await f.advance(0);
  await f.advance(29999);
  assert.equal(triggers.length, 1);
  assert.equal(f.engine.get(r.id)!.status, "active");
  await f.advance(1);
  assert.equal(triggers[1].at - triggers[0].at, 31300);
  const ended = f.engine.get(r.id)!;
  assert.equal(ended.attention!.reason, "condition");
  assert.deepEqual(ended.evidence, { ci: "passed" });
  assert.equal(f.messages.length, 0);
  f.idle();
  await f.advance(0);
  assert.equal(f.messages.length, 1);
  f.engine.close(false);
});

test("one-shot condition stops observation, held until settlement and cancelable", async () => {
  const f = fixture({ evaluate: async () => success("wake", { ready: true }) });
  const r = await f.engine.start(f.reg({ recurring: false, max_wakes: 1 }));
  await f.advance();
  assert.equal(f.engine.get(r.id)!.status, "finished");
  assert.equal(f.engine.get(r.id)!.attention!.disposition, "pending");
  assert.equal(f.messages.length, 0);
  f.engine.cancel(r.id);
  f.idle();
  await f.advance();
  assert.equal(f.messages.length, 0);
  assert.equal(f.engine.get(r.id)!.attention!.disposition, "suppressed");
});

test("timer continuation delay begins after positive wake admission then settlement, not API handoff", async () => {
  const f = fixture();
  const r = await f.engine.start(
    f.reg({
      interval_ms: undefined,
      source: undefined,
      delay_ms: 1000,
      cycle_timeout_ms: 10000,
    }),
  );
  f.idle();
  await f.advance(1000);
  assert.equal(f.messages.length, 1);
  f.idle();
  await f.advance(2000);
  assert.equal(f.messages.length, 1, "unrelated settlement cannot rearm");
  f.admit();
  f.idle();
  await f.advance(999);
  assert.equal(f.messages.length, 1);
  await f.advance(1);
  assert.equal(f.messages.length, 2);
  f.admit();
  f.idle();
  await f.advance(1000);
  assert.equal(f.messages.length, 3);
  f.admit();
  f.idle();
  await f.advance(60000);
  assert.equal(f.messages.length, 3);
  assert.equal(f.engine.get(r.id)!.failureCode, "wake_limit");
});

test("timeout is attention with latest committed evidence; finite lifetime includes busy time", async () => {
  const f = fixture({
    evaluate: async () => success("wait", { pending: true }, { seen: 1 }),
  });
  const r = await f.engine.start(f.reg({ lifetime_ms: 6000 }));
  await f.advance(5000);
  assert.equal(f.engine.get(r.id)!.attention!.reason, "timeout");
  assert.equal(f.messages.length, 0);
  assert.deepEqual(f.engine.get(r.id)!.state, { seen: 1 });
  f.idle();
  await f.advance();
  assert.equal(f.messages[0].lastAttention!.reason, "timeout");
  await f.advance(1000);
  assert.equal(f.engine.get(r.id)!.status, "finished");
  assert.equal(f.engine.get(r.id)!.failureCode, "lifetime_limit");
});

test("serial ordered events are preserved during evaluations and agent work; wakes coalesce separately", async () => {
  let complete!: (r: RunResult) => void;
  const seen: Trigger[] = [];
  const f = fixture({
    evaluate: async (_r, trigger) => {
      seen.push(trigger);
      return new Promise((r) => {
        complete = r;
      });
    },
  });
  const r = await f.engine.start(
    f.reg({
      interval_ms: undefined,
      events: [{ provider: "fixture", event: "change", args: [] }],
    }),
  );
  await f.advance();
  f.emit(1);
  f.emit(2);
  f.emit(3);
  await f.advance();
  assert.equal(seen.length, 1);
  complete(success("wake", 0));
  await f.advance();
  complete(success("wake", 1));
  await f.advance();
  complete(success("wake", 2));
  await f.advance();
  complete(success("wake", 3));
  await f.advance();
  assert.deepEqual(
    seen.map((t) => t.payload),
    [undefined, 1, 2, 3],
  );
  assert.equal(f.messages.length, 0);
  f.idle();
  await f.advance();
  assert.equal(f.messages.length, 1);
  assert.equal(f.engine.get(r.id)!.evidence, 3);
});

test("event overflow terminates with explicit coverage loss, retains committed state", async () => {
  let complete!: (r: RunResult) => void;
  const f = fixture({
    evaluate: async () =>
      new Promise((r) => {
        complete = r;
      }),
  });
  const r = await f.engine.start(
    f.reg({
      state: { old: true },
      events: [{ provider: "fixture", event: "change", args: [] }],
    }),
  );
  await f.advance();
  for (let i = 0; i < 33; i++) f.emit(i);
  assert.equal(f.engine.get(r.id)!.status, "finished");
  assert.equal(f.engine.get(r.id)!.gap, true);
  complete(success("wake", "late", { bad: true }));
  await f.advance();
  assert.deepEqual(f.engine.get(r.id)!.state, { old: true });
  f.idle();
  await f.advance();
  assert.equal(f.messages[0].lastAttention!.reason, "coverage_failure");
});

test("caught host failure cannot commit returned state/evidence or retry", async () => {
  let calls = 0;
  const f = fixture({
    evaluate: async () => {
      calls++;
      return {
        ...success("wait", "uncommitted", 99),
        status: "failed",
        code: "nested_call_failed",
        effectsMayPersist: true,
        outcomeUnknown: true,
        partialExecution: true,
      };
    },
  });
  const r = await f.engine.start(f.reg({ state: 1 }));
  await f.advance(10000);
  const receipt = f.engine.get(r.id)!;
  assert.equal(receipt.state, 1);
  assert.equal(receipt.evidence, null);
  assert.equal(receipt.effectsMayPersist, true);
  assert.equal(receipt.outcomeUnknown, true);
  assert.equal(receipt.attention!.reason, "evaluation_failure");
  assert.equal(calls, 1);
});

test("setup coverage precedes evaluation; setup loss releases capacity with no receipt", async () => {
  const f = fixture({
    subscribe: async (_s, _r, _signal, _deadline, emit, lost) => {
      emit(1);
      lost();
      return { coverage: null, close() {} };
    },
  });
  await assert.rejects(
    f.engine.start(
      f.reg({ events: [{ provider: "fixture", event: "change", args: [] }] }),
    ),
  );
  assert.equal(f.engine.list().length, 0);
  assert.equal(f.inputs.length, 0);
});

test("unknown handoff is not retried and lifecycle suppresses stale callbacks", async () => {
  let attempts = 0;
  const f = fixture({
    handoff() {
      attempts++;
      throw new Error("uncertain");
    },
    evaluate: async () => success("wake"),
  });
  const r = await f.engine.start(f.reg());
  f.idle();
  await f.advance(20000);
  assert.equal(attempts, 1);
  assert.equal(
    f.engine.get(r.id)!.lastAttention!.disposition,
    "handoff_unknown",
  );
  f.engine.close(false);
  f.idle();
  await f.advance(10000);
  assert.equal(attempts, 1);
});

test("capacity includes setup and pending attention; canceling tool after admission does not own job", async () => {
  const f = fixture();
  const signal = new AbortController();
  const r = await f.engine.start(f.reg(), signal.signal);
  signal.abort();
  assert.equal(f.engine.get(r.id)!.status, "active");
  for (let i = 0; i < 3; i++) await f.engine.start(f.reg());
  await assert.rejects(f.engine.start(f.reg()), /capacity/);
  f.engine.cancel(r.id);
  await f.engine.start(f.reg());
  f.engine.close(false);
});

test("persistence failure fails closed without handoff", async () => {
  const f = fixture({
    persist() {
      throw new Error("disk");
    },
  });
  await f.engine.start(f.reg());
  f.idle();
  await f.advance(100000);
  assert.equal(f.messages.length, 0);
  assert.equal(f.inputs.length, 0);
});

test("failure after final wake retains suppressed failure attention and accounting without exceeding cap", async () => {
  let calls = 0;
  const f = fixture({
    evaluate: async () =>
      ++calls === 1
        ? success("wake", "first")
        : {
            ...success("wait", "uncommitted", "bad"),
            status: "failed",
            code: "nested_call_failed",
            effectsMayPersist: true,
            partialExecution: true,
            outcomeUnknown: true,
          },
  });
  const r = await f.engine.start(f.reg({ max_wakes: 1, state: "original" }));
  f.idle();
  await f.advance();
  assert.equal(f.messages.length, 1);
  await f.advance(1000);
  const receipt = f.engine.get(r.id)!;
  assert.equal(receipt.status, "finished");
  assert.equal(receipt.lastAttention!.reason, "condition");
  assert.equal(receipt.attention!.reason, "evaluation_failure");
  assert.equal(receipt.attention!.disposition, "suppressed");
  assert.equal(receipt.state, "original");
  assert.equal(receipt.evidence, "first");
  assert.equal(receipt.outcomeUnknown, true);
  f.admit();
  f.idle();
  await f.advance(10000);
  assert.equal(f.messages.length, 1);
});
