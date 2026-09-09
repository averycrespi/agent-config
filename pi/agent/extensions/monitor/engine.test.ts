import assert from "node:assert/strict";
import test from "node:test";
import { MonitorEngine, type Clock, type Receipt } from "./engine.ts";
import { parseConfig } from "./config.ts";
import type { CodeLimits, RunResult } from "../code-mode/api.ts";
import { restoreReceipts, RECEIPT_TYPE } from "./receipts.ts";
import { notificationContent } from "./tool.ts";

export class FakeClock implements Clock {
  time = 1000;
  sequence = 0;
  tasks = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  set(fn: () => void, ms: number) {
    const id = ++this.sequence;
    this.tasks.set(id, { at: this.time + ms, fn });
    return id;
  }
  clear(id: unknown) {
    this.tasks.delete(id as number);
  }
  async advance(ms = 0) {
    this.time += ms;
    for (let round = 0; round < 30; round++) {
      await Promise.resolve();
      const due = [...this.tasks].find(([, t]) => t.at <= this.time);
      if (due) {
        this.tasks.delete(due[0]);
        due[1].fn();
      }
    }
  }
}
const limits = { maxCalls: 4, maxConcurrency: 2, timeoutMs: 1000 };
const input = {
  name: "checks",
  description: "Observe example checks",
  message: "Report the evidence",
  source: 'return {decision:"wait", evidence:null};',
  interval_ms: 1000,
  timeout_ms: 10000,
};
const success = (decision = "wait", evidence: unknown = null): RunResult => ({
  status: "success",
  json: JSON.stringify({ decision, evidence }),
  traces: [],
  partialExecution: false,
  effectsMayPersist: false,
  outcomeUnknown: false,
});
const failure = (safe = true): RunResult => ({
  status: "failed",
  code: "nested_call_failed",
  json: success().json,
  traces: [
    {
      id: 1,
      tool: "(not dispatched)",
      state: "failed",
      dispatched: !safe,
      startedMs: 0,
      durationMs: 1,
      code: safe ? "transport_error" : "provider_error",
      repeatSafe: safe,
    },
  ],
  partialExecution: !safe,
  effectsMayPersist: !safe,
  outcomeUnknown: !safe,
});
function harness(
  execute: (
    source: string,
    limits: CodeLimits,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<RunResult> = async () => success(),
  settings = {},
) {
  const clock = new FakeClock();
  const messages: Receipt[] = [];
  const persisted: Receipt[] = [];
  const starts: number[] = [];
  const engine = new MonitorEngine(
    parseConfig(settings, {}),
    {
      execute: (...args) => {
        starts.push(clock.now());
        return execute(...args);
      },
      persist: (r) => persisted.push(r),
      handoff: (r) => messages.push(r),
      changed() {},
    },
    clock,
  );
  return { engine, clock, messages, persisted, starts };
}

test("wait observations send zero messages; notify stops and hands off once", async () => {
  let polls = 0;
  const h = harness(async () =>
    success(++polls === 4 ? "notify" : "wait", { polls }),
  );
  const r = h.engine.start(input, limits).receipt!;
  assert.equal(r.limits.maxCalls, 4);
  for (let i = 0; i < 3; i++) {
    await h.clock.advance(i ? 1000 : 0);
    assert.equal(h.messages.length, 0);
  }
  assert.equal(h.starts.length, 3);
  assert.equal(h.engine.get(r.id)!.polls, 3);
  assert.equal(h.persisted.at(-1)!.evidence, '{"polls":3}');
  await h.clock.advance(1000);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].state, "condition");
  assert.equal(h.engine.get(r.id)!.notification, "handed_to_pi");
  await h.clock.advance(20000);
  assert.equal(h.messages.length, 1);
  assert.equal(h.starts.length, 4);
});

test("invalid starts collect errors, mutate nothing, reject duplicate active names and enforce effective bounds", () => {
  const h = harness();
  assert.ok(
    h.engine.start(
      {
        name: " ",
        source: "",
        interval_ms: NaN,
        timeout_ms: Infinity,
        poll_timeout_ms: 0,
        failure_limit: -1,
      },
      limits,
    ).errors.length >= 7,
  );
  assert.equal(h.engine.list().length, 0);
  assert.equal(h.persisted.length, 0);
  for (const key of [
    "interval_ms",
    "timeout_ms",
    "poll_timeout_ms",
    "failure_limit",
  ])
    assert.ok(h.engine.start({ ...input, [key]: null }, limits).errors.length);
  for (let i = 0; i < 4; i++)
    assert.equal(
      h.engine.start({ ...input, name: `monitor-${i}` }, limits).errors.length,
      0,
    );
  assert.ok(
    h.engine.start(input, limits).errors.some((e) => e.includes("limit")),
  );
  assert.ok(
    h.engine
      .start({ ...input, name: "monitor-0" }, limits)
      .errors.some((e) => e.includes("name")),
  );
  assert.ok(
    h.engine
      .start(input, { ...limits, maxCalls: Infinity })
      .errors.some((e) => e.includes("Code limits")),
  );
});

test("aggregate concurrency, nonoverlap, queue lifetime and no catch-up bursts", async () => {
  const resolves: Array<(r: RunResult) => void> = [];
  const h = harness(() => new Promise((resolve) => resolves.push(resolve)), {
    maxConcurrentPolls: 1,
  });
  const a = h.engine.start(input, limits).receipt!;
  const b = h.engine.start(
    { ...input, name: "queued", timeout_ms: 1000 },
    limits,
  ).receipt!;
  await h.clock.advance();
  assert.equal(resolves.length, 1);
  await h.clock.advance(5000);
  assert.equal(resolves.length, 1);
  assert.equal(h.engine.get(b.id)!.state, "deadline");
  assert.equal(h.messages.length, 1);
  resolves.shift()!(success());
  await h.clock.advance();
  assert.equal(h.engine.get(a.id)!.nextAt, h.clock.now() + 1000);
  assert.equal(h.starts.length, 1);
  await h.clock.advance(999);
  assert.equal(h.starts.length, 1);
  await h.clock.advance(1);
  assert.equal(h.starts.length, 2);
  h.engine.close();
  resolves.shift()!(success());
  await h.engine.settled();
});

test("deadline aborts active work, waits for cleanup and preserves unknown effects in single handoff", async () => {
  let resolve!: (r: RunResult) => void;
  let signal!: AbortSignal;
  const h = harness((_s, _l, s) => {
    signal = s;
    return new Promise((r) => (resolve = r));
  });
  const r = h.engine.start({ ...input, timeout_ms: 1000 }, limits).receipt!;
  await h.clock.advance();
  await h.clock.advance(1000);
  assert.equal(signal.aborted, true);
  assert.equal(h.messages.length, 0);
  resolve({ ...failure(false), status: "cancelled" });
  await h.clock.advance();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].state, "deadline");
  assert.equal(h.messages[0].failure!.outcomeUnknown, true);
  assert.equal(h.engine.get(r.id)!.calls, 1);
});

test("safe failure budget is cumulative across waits; unsafe and malformed returns never repeat", async () => {
  let i = 0;
  const h = harness(async () => (++i === 2 ? success() : failure()), {
    failureLimit: 2,
  });
  const r = h.engine.start(input, limits).receipt!;
  await h.clock.advance();
  await h.clock.advance(1000);
  await h.clock.advance(1000);
  assert.equal(h.engine.get(r.id)!.failures, 2);
  assert.equal(h.messages[0].state, "failure_limit");
  for (const result of [
    failure(false),
    {
      ...failure(),
      traces: [
        {
          ...failure().traces[0],
          repeatSafe: false,
          code: "invalid_arguments",
        },
      ],
    },
    { ...success(), json: '{"decision":"wait"}' },
    success("invalid"),
    success("wait", "x".repeat(5000)),
    { ...failure(), code: "invalid_source" },
    { ...failure(), code: "script_error" },
    { ...failure(), traces: [] },
    { ...success(), status: "timeout" as const },
  ]) {
    const h = harness(async () => result);
    h.engine.start(input, limits);
    await h.clock.advance();
    await h.clock.advance(20000);
    assert.equal(h.starts.length, 1);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].state, "unsafe_failure");
  }
});

test("malformed protocol after caught transient failure never replays", async () => {
  for (const json of [
    undefined,
    "null",
    '{"decision":"wait"}',
    success("invalid").json,
  ]) {
    const h = harness(async () => ({ ...failure(), json }));
    h.engine.start(input, limits);
    await h.clock.advance();
    await h.clock.advance(1000);
    assert.equal(h.starts.length, 1);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].state, "unsafe_failure");
    assert.equal(h.messages[0].failure!.code, "nested_call_failed");
    assert.equal(h.messages[0].failure!.protocolCode, "invalid_observation");
    assert.deepEqual(h.messages[0].failure!.codes, ["transport_error"]);
    const restored = restoreReceipts(
      h.persisted.map((data) => ({
        type: "custom",
        customType: RECEIPT_TYPE,
        data,
      })),
      16,
    )[0];
    assert.deepEqual(restored.failure, h.messages[0].failure);
    const content = notificationContent(restored);
    for (const code of [
      "nested_call_failed",
      "invalid_observation",
      "transport_error",
    ])
      assert.ok(content.includes(code));
  }
});

test("deadline settlement retains host and protocol failure in history and handoff", async () => {
  let resolve!: (r: RunResult) => void;
  const h = harness(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  h.engine.start({ ...input, timeout_ms: 1000 }, limits);
  await h.clock.advance();
  await h.clock.advance(1000);
  assert.equal(h.messages.length, 0);
  resolve({ ...failure(), json: "null" });
  await h.clock.advance();
  assert.equal(h.starts.length, 1);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].state, "deadline");
  const restored = restoreReceipts(
    h.persisted.map((data) => ({
      type: "custom",
      customType: RECEIPT_TYPE,
      data,
    })),
    16,
  )[0];
  assert.deepEqual(restored.failure, h.messages[0].failure);
  assert.equal(restored.failure!.code, "nested_call_failed");
  assert.equal(restored.failure!.protocolCode, "invalid_observation");
  assert.deepEqual(restored.failure!.codes, ["transport_error"]);
  const content = notificationContent(restored);
  for (const code of [
    "nested_call_failed",
    "invalid_observation",
    "transport_error",
  ])
    assert.ok(content.includes(code));
});

test("cancellation before handoff suppresses only owned notifications; after handoff it remains truthful", async () => {
  const h = harness(async () => success("notify"));
  const r = h.engine.start(input, limits).receipt!;
  // Execute a poll but don't run the separate delivery timer yet.
  const first = [...h.clock.tasks][0];
  h.clock.tasks.delete(first[0]);
  first[1].fn();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.engine.get(r.id)!.notification, "pending");
  h.engine.cancel(r.id);
  await h.clock.advance();
  assert.equal(h.messages.length, 0);
  const next = h.engine.start(input, limits).receipt!;
  await h.clock.advance();
  assert.equal(h.messages.length, 1);
  assert.equal(h.engine.cancel(next.id)![0].notification, "handed_to_pi");
  assert.equal(h.engine.cancel("missing"), undefined);
});

test("shutdown and navigation invalidate callbacks; restore keeps consumed accounting but never restarts", async () => {
  let resolve!: (r: RunResult) => void;
  const h = harness(() => new Promise((r) => (resolve = r)));
  const r = h.engine.start(input, limits).receipt!;
  await h.clock.advance();
  const saved = h.persisted.at(-1)!;
  assert.equal(saved.polls, 1);
  assert.equal(saved.inFlight, true);
  h.engine.close(false);
  resolve(success("notify"));
  await h.clock.advance(10000);
  assert.equal(h.messages.length, 0);
  assert.equal(h.clock.tasks.size, 0);
  const restored = harness();
  restored.engine.restore([saved]);
  assert.equal(restored.engine.get(r.id)!.state, "invalidated");
  assert.equal(restored.engine.get(r.id)!.inFlight, true);
  assert.equal(restored.engine.get(r.id)!.polls, 1);
  await restored.clock.advance(10000);
  assert.equal(restored.starts.length, 0);
  assert.equal(restored.messages.length, 0);
});

test("simultaneous completions serialize; receipts are bounded; ambiguous handoff is not retried", async () => {
  const h = harness(async () => success("notify"), { receiptLimit: 16 });
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 4; i++)
      h.engine.start({ ...input, name: `batch-${batch}-${i}` }, limits);
    await h.clock.advance();
  }
  assert.equal(h.messages.length, 20);
  assert.equal(new Set(h.messages.map((r) => r.id)).size, 20);
  assert.equal(h.engine.list().length, 16);
  let calls = 0;
  const clock = new FakeClock();
  const engine = new MonitorEngine(
    parseConfig({}, {}),
    {
      execute: async () => success("notify"),
      persist() {},
      changed() {},
      handoff() {
        calls++;
        throw new Error("ambiguous");
      },
    },
    clock,
  );
  const r = engine.start(input, limits).receipt!;
  await clock.advance();
  await clock.advance(100000);
  assert.equal(calls, 1);
  assert.equal(engine.get(r.id)!.notification, "handoff_unknown");
});
