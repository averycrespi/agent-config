import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { harness, user, assistant } from "./test-support.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { STATE_TYPE } from "./state.ts";

const minute = 60_000;

test("factory opens no resources; opt-in timer invokes native callback API without instructions or messages", async () => {
  const h = harness();
  assert.equal(h.time.timers.size, 0);
  assert.equal(h.subscriptions(), 0);
  const messages = h.sm.buildSessionContext().messages;
  await h.start();
  assert.equal(h.subscriptions(), 1);
  h.time.advance(minute - 1);
  assert.equal(h.requests.length, 0);
  h.time.advance(1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].customInstructions, undefined);
  assert.deepEqual(h.sm.buildSessionContext().messages, messages);
  const saved = h.sm.getEntries().at(-1);
  assert.equal(saved?.type, "custom");
  assert.equal((saved as any).data.outcome, "started");
});

for (const mode of ["rpc", "json", "print"] as const)
  test(`no automatic action or input listener in ${mode}`, async () => {
    const h = harness();
    h.ctx.mode = mode;
    await h.start();
    h.time.advance(minute * 2);
    assert.equal(h.requests.length, 0);
    assert.equal(h.subscriptions(), 0);
  });

for (const config of [
  { enabled: false },
  { valid: false },
  { enabled: true, valid: false },
])
  test(`configuration gate ${JSON.stringify(config)}`, async () => {
    const h = harness({ config });
    await h.start();
    if (!config.valid && config.valid !== undefined) await h.command("on");
    h.time.advance(minute * 2);
    assert.equal(h.requests.length, 0);
  });

for (const usage of [
  undefined,
  { tokens: null, percent: null, contextWindow: 1000 },
  { tokens: 100, percent: null, contextWindow: 1000 },
  { tokens: 400, percent: 40, contextWindow: 1000 },
  { tokens: 500, percent: NaN, contextWindow: 1000 },
])
  test(`unknown or at-threshold usage skips ${JSON.stringify(usage)}`, async () => {
    const h = harness();
    h.usage(usage);
    await h.start();
    h.time.advance(minute);
    assert.equal(h.requests.length, 0);
    assert.equal(h.time.timers.size, 0);
  });

test("usage strictly above threshold compacts", async () => {
  const h = harness();
  h.usage({ tokens: 401, percent: 40.01, contextWindow: 1000 });
  await h.start();
  h.time.advance(minute);
  assert.equal(h.requests.length, 1);
});

for (const event of [
  "input",
  "agent_start",
  "agent_settled",
  "message_start",
  "message_end",
  "user_bash",
  "model_select",
])
  test(`${event} resets continuous inactivity`, async () => {
    const h = harness();
    await h.start();
    h.time.advance(minute - 1);
    await h.emit(event);
    h.time.advance(1);
    assert.equal(h.requests.length, 0);
    h.time.advance(minute - 1);
    assert.equal(h.requests.length, 1);
  });

test("terminal input at timer boundary invalidates even an already-dispatched callback", async () => {
  const h = harness();
  await h.start();
  const stale = [...h.time.timers.values()][0].callback;
  h.time.value = minute;
  h.input();
  stale();
  assert.equal(h.requests.length, 0);
  h.time.advance(minute);
  assert.equal(h.requests.length, 1);
});

test("input during native admission vetoes the owned before-compact hook", async () => {
  const h = harness();
  await h.start();
  h.time.advance(minute);
  h.input();
  assert.deepEqual(await h.emit("session_before_compact"), { cancel: true });
  h.requests[0].onError?.(new Error("Compaction cancelled"));
  await h.command();
  assert.match(h.notifications.at(-1)!, /cancelled/);
  h.time.advance(minute * 2);
  assert.equal(h.requests.length, 1);
});

for (const busy of ["running", "pending"] as const)
  test(`${busy} prevents invocation; settlement starts fresh interval`, async () => {
    const h = harness();
    await h.start();
    h[busy](true);
    h.time.advance(minute);
    assert.equal(h.requests.length, 0);
    h[busy](false);
    await h.emit("agent_settled");
    h.time.advance(minute - 1);
    assert.equal(h.requests.length, 0);
    h.time.advance(1);
    assert.equal(h.requests.length, 1);
  });

test("extension UI prompt pauses scheduling until the coalesced end event", async () => {
  const h = harness();
  await h.start();
  await h.emit("ui_prompt_start");
  h.time.advance(minute * 4);
  assert.equal(h.requests.length, 0);
  await h.emit("ui_prompt_end");
  h.time.advance(minute - 1);
  assert.equal(h.requests.length, 0);
  h.time.advance(1);
  assert.equal(h.requests.length, 1);
});

test("final recheck catches a queued message arriving during eligibility reads", async () => {
  const h = harness();
  await h.start();
  const get = h.ctx.getContextUsage;
  h.ctx.getContextUsage = () => {
    h.pending(true);
    return get();
  };
  h.time.advance(minute);
  assert.equal(h.requests.length, 0);
});

for (const outcome of [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const)
  test(`no duplicate after ${outcome}, metadata, command toggle, or reload`, async () => {
    const h = harness();
    await h.start();
    h.time.advance(minute);
    if (outcome === "completed") {
      h.sm.appendCompaction("summary", h.sm.getBranch()[0].id, 500);
      await h.emit("session_compact");
      h.requests[0].onComplete?.({
        summary: "summary",
        firstKeptEntryId: h.sm.getBranch()[0].id,
        tokensBefore: 500,
      } as any);
    } else if (outcome !== "interrupted")
      h.requests[0].onError?.(
        new Error(
          outcome === "cancelled"
            ? "Compaction cancelled"
            : "private provider error",
        ),
      );
    h.sm.appendCustomEntry("unrelated", { changed: true });
    await h.command("off");
    await h.command("on");
    h.time.advance(minute * 2);
    assert.equal(h.requests.length, 1);
    await h.emit("session_shutdown");
    const resumed = harness({ session: h.sm });
    await resumed.start();
    await resumed.command();
    assert.match(
      resumed.notifications.at(-1)!,
      new RegExp(outcome === "interrupted" ? "interrupted/unknown" : outcome),
    );
    assert.doesNotMatch(
      resumed.notifications.join("\n"),
      /private provider error/,
    );
    resumed.time.advance(minute * 2);
    assert.equal(resumed.requests.length, 0);
    h.sm.appendMessage(user("new activity"));
    h.sm.appendMessage(assistant("new answer"));
    await resumed.emit("agent_settled");
    resumed.time.advance(minute);
    assert.equal(resumed.requests.length, 1);
  });

test("attempt suppression survives navigation before its metadata and stale callbacks do not write", async () => {
  const h = harness();
  const oldLeaf = h.sm.getLeafId()!;
  await h.start();
  h.time.advance(minute);
  await h.emit("session_before_tree");
  h.sm.branch(oldLeaf);
  await h.emit("session_tree");
  const count = h.sm.getEntries().length;
  h.requests[0].onError?.(new Error("late"));
  assert.equal(h.sm.getEntries().length, count);
  h.time.advance(minute);
  assert.equal(h.requests.length, 1);
  await h.start();
  h.time.advance(minute);
  assert.equal(h.requests.length, 1);
});

for (const event of [
  "session_shutdown",
  "session_before_switch",
  "session_before_fork",
  "session_before_tree",
])
  test(`${event} invalidates timers and outstanding callbacks`, async () => {
    const h = harness();
    await h.start();
    const stale = [...h.time.timers.values()][0].callback;
    await h.emit(event);
    h.time.value = minute;
    stale();
    assert.equal(h.requests.length, 0);
    await h.start();
    h.time.advance(minute);
    assert.equal(h.requests.length, 1);
    await h.emit(event);
    const count = h.sm.getEntries().length;
    h.requests[0].onComplete?.({} as any);
    assert.equal(h.sm.getEntries().length, count);
  });

test("reload starts a fresh interval and cleans up terminal observers", async () => {
  const h = harness();
  await h.start();
  h.time.advance(minute - 1);
  await h.emit("session_shutdown");
  assert.equal(h.subscriptions(), 0);
  h.time.advance(minute * 10);
  await h.start();
  assert.equal(h.subscriptions(), 1);
  h.time.advance(1);
  assert.equal(h.requests.length, 0);
  h.time.advance(minute - 1);
  assert.equal(h.requests.length, 1);
});

test("late config load cannot resurrect a stopped session", async () => {
  let resolve!: (config: typeof DEFAULT_CONFIG) => void;
  const h = harness({
    loadConfig: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const starting = h.start();
  await h.emit("session_shutdown");
  resolve({ ...DEFAULT_CONFIG, enabled: true });
  await starting;
  assert.equal(h.time.timers.size, 0);
  assert.equal(h.subscriptions(), 0);
});

test("invalid metadata fails closed and cannot be overridden on", async () => {
  const h = harness();
  h.sm.appendCustomEntry(STATE_TYPE, { version: 9000 });
  await h.start();
  await h.command("on");
  h.time.advance(minute);
  assert.equal(h.requests.length, 0);
  assert.match(h.notifications.join("\n"), /invalid saved metadata/);
});

test("metadata persistence failure prevents native invocation", async () => {
  const h = harness();
  await h.start();
  h.pi.appendEntry = () => {
    throw new Error("disk error");
  };
  h.time.advance(minute);
  assert.equal(h.requests.length, 0);
  assert.match(h.notifications.join("\n"), /metadata could not be saved/);
});

test("session override and started attempt survive actual file resume without model-context entries", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "idle-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sm = SessionManager.create(dir, dir);
  sm.appendMessage(user("hi"));
  sm.appendMessage(assistant("hello"));
  const before = sm.buildSessionContext().messages;
  const h = harness({ session: sm, config: { enabled: false } });
  await h.start();
  await h.command("on");
  h.time.advance(minute);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(sm.buildSessionContext().messages, before);
  await h.emit("session_shutdown");
  const resumed = harness({
    session: SessionManager.open(sm.getSessionFile()!),
    config: { enabled: false },
  });
  await resumed.start();
  await resumed.command();
  assert.match(resumed.notifications.at(-1)!, /Session override: on/);
  assert.match(resumed.notifications.at(-1)!, /interrupted\/unknown/);
  resumed.time.advance(minute);
  assert.equal(resumed.requests.length, 0);
});
