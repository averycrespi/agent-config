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
