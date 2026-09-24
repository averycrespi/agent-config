import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import subagents, { _runSubagent } from "./index.ts";
import { Service } from "../background/service.ts";
import { SERVICE_EVENT, type Execution } from "../background/api.ts";
import { validate } from "../background/store.ts";
import { retainBatchResult } from "./background.ts";

const tick = () => new Promise<void>((r) => setImmediate(r));
const child = (capabilities: string[] = []) => ({
  intent: "fixture",
  prompt: "task",
  profile: "fast",
  capabilities,
});
const usage = {
  input: 3,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const ok = {
  ok: true,
  aborted: false,
  stdout: "answer",
  stderr: "",
  exitCode: 0,
  signal: null,
} as const;
function harness(t: any, available = true) {
  const env = { ...process.env };
  process.env.SUBAGENTS_MAX_CONCURRENCY = "1";
  const events = new EventEmitter();
  let records: Execution[] = [];
  const sent: Execution[] = [];
  const service = new Service(
    {
      read: () => structuredClone(records),
      write: (r) => {
        records = validate(r);
      },
    },
    {
      anchor: () => "anchor",
      inBranch: () => true,
      idle: () => true,
      changed() {},
      event() {},
      handoff: (r) => {
        sent.push(r);
      },
    },
  );
  if (available) events.on(SERVICE_EVENT, (q) => q.accept(service));
  const tools: any[] = [];
  subagents({
    events,
    on() {},
    registerTool: (tool: any) => tools.push(tool),
    registerCommand() {},
  } as any);
  const ctx = {
    cwd: process.cwd(),
    hasUI: false,
    ui: {},
    modelRegistry: { find: () => ({ reasoning: true }) },
  };
  t.after(() => {
    service.close();
    process.env = env;
    mock.restoreAll();
  });
  assert.deepEqual(
    tools.map((t) => t.name),
    ["subagents"],
  );
  return {
    service,
    sent,
    records: () => records,
    call: (params: any) =>
      tools[0].execute(
        `call-${Math.random()}`,
        params,
        undefined,
        undefined,
        ctx,
      ),
  };
}
async function settled(h: ReturnType<typeof harness>, id: string) {
  for (let i = 0; i < 100; i++) {
    const r = h.service.inspect("subagents", id);
    if (r.status !== "running") return r;
    await tick();
  }
  throw Error("fixture did not settle");
}

test("background returns before completion; mixed results and usage stay aligned, notify once, inspection never charges", async (t) => {
  const h = harness(t);
  let finish!: () => void;
  mock.method(_runSubagent, "fn", async (r: any) => {
    r.onEvent({ type: "message_end", message: { role: "assistant", usage } });
    if (r.intent === "fixture")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return r.intent === "bad"
      ? { ...ok, ok: false, errorMessage: "structured_output_missing" }
      : { ...ok, structured: { ok: true, value: { answer: 42 } } };
  });
  const admission = await h.call({
    execution: "background",
    agents: [
      { ...child(), output_schema: { type: "object" } },
      { ...child(), intent: "bad", output_schema: { type: "object" } },
    ],
  });
  assert.equal(admission.usage, undefined);
  const id = admission.details.execution.id;
  for (let i = 0; !finish && i < 100; i++) await tick();
  assert.equal(h.service.inspect("subagents", id).status, "running");
  assert.equal(h.sent.length, 0);
  finish();
  const r = await settled(h, id);
  assert.equal(r.status, "failed");
  const result = r.result as any;
  assert.equal(result.usage.totalTokens, 10);
  assert.equal(result.details.outcomes.length, 2);
  assert.equal(result.details.outcomes[1].usage.totalTokens, 5);
  assert.deepEqual(result.details.structured[0].value, { answer: 42 });
  assert.equal(result.details.structured[1].ok, false);
  assert.equal(result.details.allOk, false);
  assert.deepEqual(r.progress, { total: 2, completed: 2, failed: 1 });
  assert.equal(h.sent.length, 1);
  for (let i = 0; i < 2; i++)
    assert.equal((await h.call({ action: "inspect", id })).usage, undefined);
  h.service.flush();
  assert.equal(h.sent.length, 1);
  await h.call({ action: "dismiss", id });
  assert.equal(h.service.inspect("subagents", id).dismissed, true);
});

test("missing service and invalid batches launch no child and create no record", async (t) => {
  const h = harness(t, false);
  const run = mock.method(_runSubagent, "fn", async () => ok);
  await assert.rejects(
    h.call({ execution: "background", agents: [child()] }),
    /background_unavailable/,
  );
  assert.equal(run.mock.callCount(), 0);
  const other = harness(t);
  for (const execution of ["foreground", "background"]) {
    const invalid = await other.call({
      execution,
      agents: [child(), { ...child(), files: ["/missing-subagent-fixture"] }],
    });
    assert.equal(invalid.details.validationError, true);
    const mutable = await other.call({
      execution,
      agents: [child(["exec-shell"]), child()],
    });
    assert.equal(mutable.details.validationError, true);
  }
  assert.equal(run.mock.callCount(), 0);
  assert.deepEqual(other.records(), []);
});

test("foreground/background share capacity; queued cancellation starts no child", async (t) => {
  const h = harness(t);
  let finish!: () => void;
  const run = mock.method(_runSubagent, "fn", async () => {
    await new Promise<void>((r) => {
      finish = r;
    });
    return ok;
  });
  const foreground = h.call({ agents: [child()] });
  for (let i = 0; !finish && i < 100; i++) await tick();
  const {
    details: { execution },
  } = await h.call({ execution: "background", agents: [child()] });
  await tick();
  assert.equal(run.mock.callCount(), 1);
  await h.call({ action: "cancel", id: execution.id });
  const cancelled = await settled(h, execution.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(run.mock.callCount(), 1);
  finish();
  assert.equal((await foreground).details.allOk, true);
});

test("mutable cross-mode gate remains exclusive; running cancellation drains and retains abort usage", async (t) => {
  const h = harness(t);
  process.env.SUBAGENTS_MAX_CONCURRENCY = "4";
  const finishes: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const run = mock.method(_runSubagent, "fn", async (r: any) => {
    signals.push(r.signal);
    r.onEvent({ type: "message_end", message: { role: "assistant", usage } });
    await new Promise<void>((resolve) => finishes.push(resolve));
    return {
      ...ok,
      ok: !r.signal?.aborted,
      aborted: Boolean(r.signal?.aborted),
    };
  });
  const a = await h.call({
    execution: "background",
    agents: [child(["exec-shell"])],
  });
  for (let i = 0; !finishes.length && i < 100; i++) await tick();
  const b = h.call({ agents: [child(["write-filesystem"])] });
  await tick();
  assert.equal(run.mock.callCount(), 1);
  await h.call({ action: "cancel", id: a.details.execution.id });
  assert.equal(signals[0].aborted, true);
  assert.equal(
    h.service.inspect("subagents", a.details.execution.id).status,
    "running",
  );
  assert.equal(h.sent.length, 0);
  finishes[0]();
  const cancelled = await settled(h, a.details.execution.id);
  assert.equal((cancelled.result as any).usage.totalTokens, 5);
  for (let i = 0; finishes.length < 2 && i < 100; i++) await tick();
  assert.equal(run.mock.callCount(), 2);
  finishes[1]();
  await b;
});

test("session loss keeps reported partial usage, aborts once and never replays late success", async (t) => {
  const h = harness(t);
  let finish!: () => void;
  let signal!: AbortSignal;
  const run = mock.method(_runSubagent, "fn", async (r: any) => {
    signal = r.signal;
    r.onEvent({ type: "message_end", message: { role: "assistant", usage } });
    await new Promise<void>((r) => {
      finish = r;
    });
    return ok;
  });
  const a = await h.call({ execution: "background", agents: [child()] });
  for (let i = 0; !finish && i < 100; i++) await tick();
  h.service.close();
  assert.equal(signal.aborted, true);
  assert.equal(h.records()[0].status, "interrupted");
  assert.equal((h.records()[0].result as any).usage.totalTokens, 5);
  finish();
  await tick();
  assert.equal(
    h.service.inspect("subagents", a.details.execution.id).status,
    "interrupted",
  );
  assert.equal(run.mock.callCount(), 1);
});

test("background deadline aborts the existing executor and waits for cleanup", async (t) => {
  const h = harness(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: () => void;
  let signal!: AbortSignal;
  mock.method(_runSubagent, "fn", async (r: any) => {
    signal = r.signal;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { ...ok, ok: false, aborted: true };
  });
  const a = await h.call({
    execution: "background",
    timeout_ms: 1000,
    agents: [child()],
  });
  for (let i = 0; !finish && i < 100; i++) await tick();
  t.mock.timers.tick(1000);
  assert.equal(signal.aborted, true);
  assert.equal(
    h.service.inspect("subagents", a.details.execution.id).status,
    "running",
  );
  finish();
  assert.equal((await settled(h, a.details.execution.id)).status, "timeout");
});

test("recursion rejects the complete batch before admission", async (t) => {
  const h = harness(t);
  process.env.PI_SUBAGENT_DEPTH = "1";
  const run = mock.method(_runSubagent, "fn", async () => ok);
  const result = await h.call({ execution: "background", agents: [child()] });
  assert.equal(result.details.validationError, true);
  assert.equal(run.mock.callCount(), 0);
  assert.deepEqual(h.records(), []);
});

test("oversized batch retains complete structured/prose/diagnostic output and accounting by reference", async () => {
  const childResult = {
    content: [{ type: "text" as const, text: "文".repeat(50000) }],
    details: {
      ok: false,
      structuredError: "missing",
      logFile: "/example/log.gz",
    },
    usage,
  };
  const batch = {
    ...childResult,
    details: { allOk: false, failed: 1, total: 1, outcomes: [childResult] },
  };
  const retained = await retainBatchResult(batch, "large-fixture");
  assert.equal(retained.usage.totalTokens, 5);
  assert.deepEqual(
    JSON.parse(await readFile(retained.resultFile, "utf8")),
    batch,
  );
});
