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

test("persisted parser ignores invalid nested review without losing legacy goal", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-legacy",
      objective: "Keep valid state",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      review: { status: "reviewing", claimEvidence: "missing counters" },
    },
  });

  assert.equal(parsed?.goal?.id, "goal-legacy");
  assert.equal(parsed?.goal?.review, undefined);
});

test("persisted parser preserves review claims above the default evidence limit", () => {
  const claimEvidence = "e".repeat(5_000);
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-large",
      objective: "Configured large evidence",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      review: {
        status: "fix_required",
        attemptCount: 1,
        fixRoundsUsed: 0,
        claimEvidence,
        summary: "Requires a fix",
        findings: [
          {
            severity: "important",
            confidence: 90,
            description: "Issue",
            evidence: "artifact",
          },
        ],
        startedAt: 1,
        updatedAt: 2,
      },
    },
  });

  assert.equal(parsed?.goal?.review?.claimEvidence.length, 5_000);
  assert.equal(parsed?.goal?.review?.status, "fix_required");
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

test("review transitions pass, require a fix, and exhaust bounded rounds", () => {
  let now = 10;
  const store = createGoalStore(() => now++);
  const goal = store.setGoal("Ship safely", 100);
  store.startAutoRun();

  const first = store.beginReview("focused checks pass", 100);
  assert.equal(first?.review.status, "reviewing");
  assert.equal(first?.review.attemptCount, 1);
  const blocked = store.applyReviewBlock(
    goal.id,
    first!.review.attemptToken!,
    "One issue remains",
    [
      {
        severity: "important",
        confidence: 95,
        description: "Missing case",
        evidence: "test absent",
      },
    ],
    1,
  );
  assert.equal(blocked, "applied");
  assert.equal(store.getGoal()?.status, "active");
  assert.equal(store.getGoal()?.review?.status, "fix_required");

  const second = store.beginReview("case added", 100);
  assert.equal(second?.review.fixRoundsUsed, 0);
  store.applyReviewBlock(
    goal.id,
    second!.review.attemptToken!,
    "Still broken",
    [
      {
        severity: "blocker",
        confidence: 100,
        description: "Failure",
        evidence: "test fails",
      },
    ],
    1,
  );
  assert.equal(store.getGoal()?.status, "paused");
  assert.equal(store.getGoal()?.review?.status, "exhausted");
  assert.equal(store.getGoal()?.review?.fixRoundsUsed, 1);
  assert.equal(store.getAutoRun()?.stopReason, "review_exhausted");
});

test("zero fix rounds exhausts on the initial blocking review", () => {
  const store = createGoalStore(() => 1);
  const goal = store.setGoal("No fix loop", 100);
  const claim = store.beginReview("checked", 100)!;
  store.applyReviewBlock(
    goal.id,
    claim.review.attemptToken!,
    "Blocked",
    [
      {
        severity: "important",
        confidence: 90,
        description: "Issue",
        evidence: "artifact",
      },
    ],
    0,
  );
  assert.equal(store.getGoal()?.status, "paused");
  assert.equal(store.getGoal()?.review?.status, "exhausted");
  assert.equal(store.getGoal()?.review?.fixRoundsUsed, 0);
});

test("a reviewing claim cannot start a concurrent reviewer", () => {
  const store = createGoalStore(() => 1);
  store.setGoal("One reviewer", 100);
  const first = store.beginReview("first", 100);
  const second = store.beginReview("second", 100);

  assert.equal(first?.review.status, "reviewing");
  assert.equal(second, undefined);
  assert.equal(store.getGoal()?.review?.attemptCount, 1);
  assert.equal(store.getGoal()?.review?.claimEvidence, "first");
});

test("review compare-and-apply rejects stale results", () => {
  const store = createGoalStore(() => 1);
  const goal = store.setGoal("Avoid stale writes", 100);
  const claim = store.beginReview("checked", 100)!;
  store.pause();
  assert.equal(
    store.applyReviewPass(goal.id, claim.review.attemptToken!, "Clean", []),
    "stale",
  );
  assert.equal(store.getGoal()?.status, "paused");
});

test("review failure pauses without consuming a fix round and can be approved", () => {
  const store = createGoalStore(() => 2);
  const goal = store.setGoal("Review me", 100);
  store.startAutoRun();
  const claim = store.beginReview("evidence", 100)!;
  assert.equal(
    store.applyReviewFailure(
      goal.id,
      claim.review.attemptToken!,
      "timeout",
      "Reviewer timed out",
    ),
    "applied",
  );
  assert.equal(store.getGoal()?.review?.fixRoundsUsed, 0);
  assert.equal(store.getGoal()?.status, "paused");
  assert.equal(store.getAutoRun()?.stopReason, "review_unavailable");
  assert.equal(store.approveReview("human verified", 100), "applied");
  assert.equal(store.getGoal()?.status, "complete");
  assert.equal(store.getGoal()?.completionEvidence, "evidence");
  assert.equal(store.getGoal()?.review?.status, "overridden");
});

test("restoring an in-flight review fails closed atomically", () => {
  const parsed = parsePersistedGoalState({
    goal: {
      id: "goal-1",
      objective: "Recover",
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      review: {
        status: "reviewing",
        attemptToken: "token",
        attemptCount: 1,
        fixRoundsUsed: 0,
        claimEvidence: "checked",
        startedAt: 2,
        updatedAt: 2,
      },
    },
    autoRun: { status: "running", updatedAt: 2, continuationTurns: 0 },
  });
  const store = createGoalStore(() => 3);
  store.replaceState(parsed!);

  assert.equal(store.getGoal()?.status, "paused");
  assert.equal(store.getGoal()?.review?.status, "unavailable");
  assert.equal(store.getAutoRun()?.status, "stopped");
  assert.equal(store.getAutoRun()?.stopReason, "review_unavailable");
});

test("resume resets the review cycle and persisted review data is cloned", () => {
  const store = createGoalStore(() => 4);
  const goal = store.setGoal("Retry", 100);
  const claim = store.beginReview("checked", 100)!;
  store.applyReviewFailure(
    goal.id,
    claim.review.attemptToken!,
    "spawn",
    "no reviewer",
  );
  const snapshot = store.getState();
  snapshot.goal!.review!.summary = "mutated";
  assert.notEqual(store.getGoal()?.review?.summary, "mutated");
  store.resume();
  assert.equal(store.getGoal()?.review, undefined);
  assert.equal(store.getGoal()?.status, "active");
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
