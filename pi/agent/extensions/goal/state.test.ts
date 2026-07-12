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
