import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLoopStore,
  formatLoopState,
  parsePersistedLoopState,
} from "./state.ts";

const limits = { maxContinuations: 3, maxActiveMinutes: 10 };
const ceilings = { maxContinuations: 20, maxActiveMinutes: 120 };

test("loop store starts one bounded running loop", () => {
  const store = createLoopStore(() => 1_000);

  const loop = store.start("  Continue useful work  ", limits, ceilings, 100);

  assert.equal(loop.message, "Continue useful work");
  assert.equal(loop.status, "running");
  assert.equal(loop.continuationCount, 0);
  assert.equal(loop.activeElapsedMs, 0);
  assert.equal(loop.runningSince, 1_000);
  assert.throws(
    () => store.start("Replace it", limits, ceilings, 100),
    /already exists/,
  );
});

test("loop start validates message, limits, and configured ceilings", () => {
  const store = createLoopStore(() => 1);

  assert.throws(
    () => store.start("   ", limits, ceilings, 100),
    /message is required/i,
  );
  assert.throws(
    () => store.start("abcd", limits, ceilings, 3),
    /at most 3 characters/i,
  );
  assert.throws(
    () =>
      store.start(
        "work",
        { maxContinuations: 21, maxActiveMinutes: 10 },
        ceilings,
        100,
      ),
    /configured ceiling of 20/,
  );
});

test("yield pauses active time and the next user message wakes the loop", () => {
  let now = 1_000;
  const store = createLoopStore(() => now);
  store.start("work", limits, ceilings, 100);

  now = 61_000;
  store.yield("Need a user decision", 100);
  assert.equal(store.getLoop()?.status, "yielded");
  assert.equal(store.getLoop()?.activeElapsedMs, 60_000);
  assert.equal(store.getLoop()?.runningSince, undefined);

  now = 121_000;
  assert.equal(store.wake(), true);
  assert.equal(store.getLoop()?.status, "running");
  assert.equal(store.getLoop()?.runningSince, 121_000);
});

test("normal user input leaves a running loop unchanged", () => {
  const store = createLoopStore(() => 1);
  store.start("work", limits, ceilings, 100);

  assert.equal(store.wake(), false);
  assert.equal(store.getLoop()?.status, "running");
});

test("stop requires explicit resume and resume preserves usage", () => {
  let now = 1_000;
  const store = createLoopStore(() => now);
  store.start("work", limits, ceilings, 100);
  now = 31_000;
  store.stop("agent_stop", "No more useful work", 100);

  assert.equal(store.getLoop()?.status, "stopped");
  assert.equal(store.wake(), false);
  assert.throws(
    () => store.yield("weaken the stop", 100),
    /stopped loop cannot yield/i,
  );
  assert.equal(store.getLoop()?.status, "stopped");
  now = 61_000;
  store.resume();
  assert.equal(store.getLoop()?.status, "running");
  assert.equal(store.getLoop()?.activeElapsedMs, 30_000);
  assert.equal(store.getLoop()?.runningSince, 61_000);
});

test("claimContinuation persists accounting before the caller schedules", () => {
  const store = createLoopStore(() => 1);
  const started = store.start("work", limits, ceilings, 100);

  assert.deepEqual(store.claimContinuation(started.generation), {
    claimed: true,
  });
  assert.equal(store.getLoop()?.continuationCount, 1);
  assert.deepEqual(store.claimContinuation(started.generation), {
    claimed: true,
  });
  assert.deepEqual(store.claimContinuation(started.generation), {
    claimed: true,
  });
  assert.deepEqual(store.claimContinuation(started.generation), {
    claimed: false,
    stopReason: "continuation_limit",
  });
  assert.equal(store.getLoop()?.status, "stopped");
});

test("stale generations cannot claim a replacement loop", () => {
  const store = createLoopStore(() => 1);
  const first = store.start("first", limits, ceilings, 100);
  store.clear();
  const replacement = store.start("replacement", limits, ceilings, 100);

  assert.deepEqual(store.claimContinuation(first.generation), {
    claimed: false,
  });
  assert.equal(store.getLoop()?.generation, replacement.generation);
  assert.equal(store.getLoop()?.continuationCount, 0);
});

test("running-time limit excludes yielded and stopped time", () => {
  let now = 0;
  const store = createLoopStore(() => now);
  store.start(
    "work",
    { maxContinuations: 10, maxActiveMinutes: 1 },
    ceilings,
    100,
  );
  now = 30_000;
  store.yield("wait", 100);
  now = 3_630_000;
  store.wake();
  now = 3_660_000;

  assert.deepEqual(store.claimContinuation(), {
    claimed: false,
    stopReason: "time_limit",
  });
});

test("extend loosens absolute limits without resuming or resetting usage", () => {
  const store = createLoopStore(() => 1);
  store.start("work", limits, ceilings, 100);
  store.claimContinuation();
  store.stop("agent_stop", "done", 100);

  store.extend({ maxContinuations: 5 }, ceilings);
  assert.equal(store.getLoop()?.limits.maxContinuations, 5);
  assert.equal(store.getLoop()?.limits.maxActiveMinutes, 10);
  assert.equal(store.getLoop()?.continuationCount, 1);
  assert.equal(store.getLoop()?.status, "stopped");
  assert.throws(
    () => store.extend({ maxContinuations: 2 }, ceilings),
    /cannot reduce/,
  );
  assert.throws(
    () => store.extend({ maxActiveMinutes: 121 }, ceilings),
    /configured ceiling of 120/,
  );
});

test("clear removes the loop and changes the generation", () => {
  const store = createLoopStore(() => 1);
  const first = store.start("work", limits, ceilings, 100);
  store.clear();
  const second = store.start("work again", limits, ceilings, 100);

  assert.notEqual(first.generation, second.generation);
});

test("persisted running loops restore stopped for safety", () => {
  const parsed = parsePersistedLoopState({
    loop: {
      id: "loop-1",
      generation: 4,
      status: "running",
      message: "continue",
      limits,
      continuationCount: 1,
      activeElapsedMs: 10,
      runningSince: 20,
      createdAt: 1,
      updatedAt: 30,
    },
  });

  assert.equal(parsed?.loop?.status, "stopped");
  assert.equal(parsed?.loop?.stopReason, "session_restored");
  assert.equal(parsed?.loop?.runningSince, undefined);
  assert.equal(
    parsePersistedLoopState({ loop: { status: "running" } }),
    undefined,
  );
});

test("failed stop validation leaves running state unchanged", () => {
  const store = createLoopStore(() => 1);
  store.start("work", limits, ceilings, 100);

  assert.throws(
    () => store.stop("extension_stop", "too long", 3),
    /at most 3 characters/,
  );
  assert.equal(store.getLoop()?.status, "running");
  assert.equal(store.getLoop()?.runningSince, 1);
});

test("formatted state is concise and terminal-safe", () => {
  const store = createLoopStore(() => 1);
  store.start("continue\n\u001b[31mcarefully", limits, ceilings, 100);
  store.stop("agent_stop", "done\n\u001b[31mnow", 100);

  const formatted = formatLoopState(store.getState());
  assert.doesNotMatch(formatted, /\u001b/);
  assert.match(formatted, /Loop \[stopped\]/);
  assert.match(formatted, /1?0m limit/);
});
