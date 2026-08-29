import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGoalStore,
  formatGoalState,
  parsePersistedGoalState,
} from "./state.ts";

test("goal store trims objectives and tracks lifecycle", () => {
  const store = createGoalStore(() => 1000);

  const goal = store.setGoal("  Ship the feature  ", 100);
  assert.equal(goal.objective, "Ship the feature");
  assert.equal(goal.status, "active");
  assert.equal(goal.createdAt, 1000);

  store.pause();
  assert.equal(store.getGoal()?.status, "paused");

  store.resume();
  assert.equal(store.getGoal()?.status, "active");

  store.startAutoRun();
  assert.equal(store.getAutoRun()?.status, "running");

  store.complete(" tests and docs verify every requirement ", 100);
  assert.equal(store.getGoal()?.status, "complete");
  assert.equal(store.getAutoRun()?.status, "stopped");
  assert.equal(store.getAutoRun()?.stopReason, "goal_complete");
  assert.equal(
    store.getGoal()?.completionEvidence,
    "tests and docs verify every requirement",
  );
  assert.equal(store.getGoal()?.completedAt, 1000);
});

test("goal store rejects empty and oversized objectives", () => {
  const store = createGoalStore(() => 1);

  assert.throws(() => store.setGoal("   ", 10), /Objective is required/);
  assert.throws(() => store.setGoal("abcd", 3), /at most 3 characters/);
});

test("persisted goal state parser rejects invalid snapshots", () => {
  assert.equal(
    parsePersistedGoalState({ goal: { objective: "x" } }),
    undefined,
  );
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-1",
      objective: "Finish docs",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    },
  });
  assert.equal(parsed?.goal?.id, "goal-1");
  assert.equal(parsed?.goal?.usage?.turns, 0);
});

test("persisted parser ignores removed review metadata", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-legacy-review",
      objective: "Restore without review state",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      review: {
        status: "fix_required",
        attemptCount: 1,
        fixRoundsUsed: 0,
        claimEvidence: "legacy claim",
        startedAt: 1,
        updatedAt: 2,
      },
    },
  });

  assert.equal(parsed?.goal?.id, "goal-legacy-review");
  assert.equal("review" in parsed!.goal!, false);
});

test("persisted parser ignores malformed legacy review metadata", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-malformed-review",
      objective: "Keep active state",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      review: { status: "reviewing", claimEvidence: "missing counters" },
    },
    autoRun: {
      status: "running",
      updatedAt: 2,
      continuationTurns: 0,
    },
  });

  assert.equal(parsed?.goal?.status, "active");
  assert.equal("review" in parsed!.goal!, false);
  assert.equal(parsed?.autoRun?.status, "running");
});

test("persisted parser safely normalizes an interrupted legacy review", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-interrupted-review",
      objective: "Restore safely",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      review: {
        status: "reviewing",
        attemptToken: "token",
        attemptCount: 1,
        fixRoundsUsed: 0,
        claimEvidence: "legacy claim",
        startedAt: 1,
        updatedAt: 2,
      },
    },
    autoRun: {
      status: "running",
      updatedAt: 2,
      continuationTurns: 0,
    },
  });

  assert.equal(parsed?.goal?.status, "paused");
  assert.equal("review" in parsed!.goal!, false);
  assert.equal(parsed?.autoRun?.status, "stopped");
  assert.equal(parsed?.autoRun?.stopReason, "goal_paused");
});

test("persisted goal state parser accepts auto-run snapshots", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-1",
      objective: "Finish docs",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    },
    autoRun: {
      status: "stopped",
      updatedAt: 3,
      continuationTurns: 10,
      stopReason: "turn_budget",
    },
  });

  assert.equal(parsed?.autoRun?.status, "stopped");
  assert.equal(parsed?.autoRun?.stopReason, "turn_budget");
  assert.equal(parsed?.autoRun?.stopDetail, undefined);
});

test("agent yield remains active, persists detail, and renews cleanly", () => {
  const store = createGoalStore(() => 4);
  store.setGoal("Wait for credentials", 100);
  store.startAutoRun();
  store.stopAutoRun("agent_yield", "Credentials are unavailable");

  assert.equal(store.getGoal()?.status, "active");
  assert.deepEqual(store.getAutoRun(), {
    status: "stopped",
    startedAt: 4,
    updatedAt: 4,
    continuationTurns: 0,
    stopReason: "agent_yield",
    stopDetail: "Credentials are unavailable",
  });
  assert.match(
    formatGoalState(store.getState()),
    /agent_yield · Credentials are unavailable/,
  );

  store.startAutoRun();
  assert.equal(store.getAutoRun()?.status, "running");
  assert.equal(store.getAutoRun()?.stopReason, undefined);
  assert.equal(store.getAutoRun()?.stopDetail, undefined);
});

test("agent yield detail is terminal-safe in formatted state", () => {
  const store = createGoalStore(() => 4);
  store.setGoal("Wait safely", 100);
  store.startAutoRun();
  store.stopAutoRun("agent_yield", "Need\n\u001b[31mapproval");

  const formatted = formatGoalState(store.getState());
  assert.equal(formatted.split("\n").length, 2);
  assert.doesNotMatch(formatted, /\u001b/);
  assert.match(formatted, /Need approval/);
});

test("persisted parser safely normalizes agent yield invariants", () => {
  const runningYield = parsePersistedGoalState({
    autoRun: {
      status: "running",
      updatedAt: 3,
      continuationTurns: 1,
      stopReason: "agent_yield",
      stopDetail: "Need approval",
    },
  });
  const oversizedYield = parsePersistedGoalState(
    {
      autoRun: {
        status: "stopped",
        updatedAt: 3,
        continuationTurns: 1,
        stopReason: "agent_yield",
        stopDetail: "123456",
      },
    },
    5,
  );

  assert.equal(runningYield?.autoRun?.status, "stopped");
  assert.equal(runningYield?.autoRun?.stopReason, "agent_yield");
  assert.equal(oversizedYield?.autoRun?.stopDetail, "12345");
});

test("persisted parser restores agent yield details", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-yield",
      objective: "Wait safely",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    },
    autoRun: {
      status: "stopped",
      updatedAt: 3,
      continuationTurns: 1,
      stopReason: "agent_yield",
      stopDetail: "Need user approval",
    },
  });

  assert.equal(parsed?.goal?.status, "active");
  assert.equal(parsed?.autoRun?.stopReason, "agent_yield");
  assert.equal(parsed?.autoRun?.stopDetail, "Need user approval");
});

test("persisted goal state parser accepts aborted auto-run snapshots", () => {
  const parsed = parsePersistedGoalState({
    autoRun: {
      status: "stopped",
      updatedAt: 3,
      continuationTurns: 0,
      stopReason: "aborted",
    },
  });

  assert.equal(parsed?.autoRun?.stopReason, "aborted");
});

test("persisted parser normalizes obsolete review stop reasons", () => {
  const parsed = parsePersistedGoalState({
    autoRun: {
      status: "stopped",
      updatedAt: 3,
      continuationTurns: 1,
      stopReason: "review_exhausted",
    },
  });

  assert.equal(parsed?.autoRun?.stopReason, "goal_paused");
});

test("formatGoalState includes auto-run status", () => {
  const store = createGoalStore(() => 1);
  store.setGoal("Fix auth", 100);
  store.startAutoRun();
  store.recordAutoRunContinuation();

  assert.match(formatGoalState(store.getState()), /Auto-run: running/);
  assert.match(formatGoalState(store.getState()), /1 continuation turn/);
});

test("formatGoalState includes completion evidence", () => {
  const store = createGoalStore(() => 1);
  store.setGoal("Fix auth", 100);
  store.complete("unit tests cover expiry", 100);

  assert.match(formatGoalState(store.getState()), /Goal \[complete\] Fix auth/);
  assert.match(
    formatGoalState(store.getState()),
    /Evidence: unit tests cover expiry/,
  );
});

test("goal store tracks active elapsed time and assistant token usage", () => {
  let now = 1000;
  const store = createGoalStore(() => now);

  store.setGoal("Measure usage", 100);
  now = 4000;
  store.recordAssistantUsage(120);

  assert.equal(store.getGoal()?.usage?.turns, 1);
  assert.equal(store.getGoal()?.usage?.totalTokens, 120);
  assert.equal(store.getGoal()?.usage?.activeElapsedMs, 3000);

  store.pause();
  now = 9000;
  assert.equal(store.getGoal()?.usage?.activeElapsedMs, 3000);

  store.resume();
  now = 11000;
  store.complete("verified", 100);
  assert.equal(store.getGoal()?.usage?.activeElapsedMs, 5000);
});

test("persisted active-time snapshots do not recount elapsed time after restore", () => {
  let now = 1000;
  const original = createGoalStore(() => now);

  original.setGoal("Measure usage", 100);
  now = 4000;
  const snapshot = original.getState();

  now = 5000;
  const restored = createGoalStore(() => now);
  restored.replaceState(snapshot);

  assert.equal(restored.getGoal()?.usage?.activeElapsedMs, 4000);
});

test("goal store adds nested tokens without incrementing assistant turns", () => {
  const store = createGoalStore(() => 1000);

  store.setGoal("Measure nested usage", 100);
  store.recordAssistantUsage(120);
  store.recordTokenUsage(80);

  assert.equal(store.getGoal()?.usage?.turns, 1);
  assert.equal(store.getGoal()?.usage?.totalTokens, 200);
});

test("legacy persisted goal snapshots default usage counters", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-1",
      objective: "Finish docs",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    },
  });

  assert.equal(parsed?.goal?.usage?.turns, 0);
  assert.equal(parsed?.goal?.usage?.totalTokens, 0);
  assert.equal(parsed?.goal?.usage?.activeElapsedMs, 0);
});
