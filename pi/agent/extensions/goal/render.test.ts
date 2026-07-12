import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGoalWidgetLines } from "./render.ts";
import type { Goal, GoalAutoRunState } from "./state.ts";

const baseGoal: Goal = {
  id: "goal-1",
  objective: "Fix auth token expiry handling across middleware and tests",
  status: "active",
  createdAt: 1,
  updatedAt: 1,
};

const goalWithUsage: Goal = {
  ...baseGoal,
  usage: {
    activeElapsedMs: 20 * 60_000,
    totalTokens: 18_400,
    turns: 5,
    startedAt: 1,
    activeSince: 1,
  },
};

function runningAutoRun(): GoalAutoRunState {
  const startedAt = Date.now() - 20 * 60_000;
  return {
    status: "running",
    startedAt,
    updatedAt: startedAt,
    continuationTurns: 3,
  };
}

test("renders compact active goal widget within width", () => {
  const lines = renderGoalWidgetLines(baseGoal, 32);

  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("[active] Goal:"));
  assert.ok(lines[0].length <= 32);
  assert.equal(lines[1], "─".repeat(32));
});

test("omits completion evidence from complete goal widget", () => {
  const lines = renderGoalWidgetLines(
    {
      ...baseGoal,
      status: "complete",
      completedAt: 2,
      completionEvidence: "tests pass and README documents behavior in detail",
    },
    40,
  );

  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("[complete] Goal:"));
  assert.doesNotMatch(lines.join("\n"), /Evidence:/);
  assert.equal(lines[1], "─".repeat(40));
});

test("appends running auto-run details to the usage line", () => {
  const lines = renderGoalWidgetLines(goalWithUsage, 120, undefined, {
    showUsage: true,
    autoRun: runningAutoRun(),
    autoRunEnabled: true,
    autoRunMaxContinuations: 10,
    autoRunMaxActiveMinutes: 60,
  });

  assert.equal(
    lines[1],
    "Usage: 20m active · 18.4k tokens · 5 turns · auto-run enabled (3/10 continuations, 40m left)",
  );
});

test("appends disabled auto-run reasons to the usage line", () => {
  const configDisabled = renderGoalWidgetLines(goalWithUsage, 120, undefined, {
    showUsage: true,
    autoRun: runningAutoRun(),
    autoRunEnabled: false,
    autoRunMaxContinuations: 10,
    autoRunMaxActiveMinutes: 60,
  });
  const stopped = renderGoalWidgetLines(goalWithUsage, 120, undefined, {
    showUsage: true,
    autoRun: {
      status: "stopped",
      updatedAt: 1,
      continuationTurns: 10,
      stopReason: "turn_budget",
    },
    autoRunEnabled: true,
    autoRunMaxContinuations: 10,
    autoRunMaxActiveMinutes: 60,
  });
  const aborted = renderGoalWidgetLines(goalWithUsage, 120, undefined, {
    showUsage: true,
    autoRun: {
      status: "stopped",
      updatedAt: 1,
      continuationTurns: 0,
      stopReason: "aborted",
    },
    autoRunEnabled: true,
    autoRunMaxContinuations: 10,
    autoRunMaxActiveMinutes: 60,
  });
  const paused = renderGoalWidgetLines(
    { ...goalWithUsage, status: "paused" },
    120,
    undefined,
    {
      showUsage: true,
      autoRun: runningAutoRun(),
      autoRunEnabled: true,
      autoRunMaxContinuations: 10,
      autoRunMaxActiveMinutes: 60,
    },
  );

  assert.match(configDisabled[1], /auto-run disabled \(config\)/);
  assert.match(stopped[1], /auto-run disabled \(continuation budget\)/);
  assert.match(aborted[1], /auto-run disabled \(aborted\)/);
  assert.match(paused[1], /auto-run disabled \(goal paused\)/);
});

test("renders compact review phases without full findings", () => {
  const reviewing = renderGoalWidgetLines(
    {
      ...baseGoal,
      review: {
        status: "reviewing",
        attemptToken: "t",
        attemptCount: 1,
        fixRoundsUsed: 0,
        claimEvidence: "proof",
        startedAt: 1,
        updatedAt: 1,
        findings: [
          {
            severity: "important",
            confidence: 99,
            description: "secret detailed finding",
            evidence: "artifact",
          },
        ],
      },
    },
    30,
  );
  const paused = renderGoalWidgetLines(
    {
      ...baseGoal,
      status: "paused",
      review: {
        status: "unavailable",
        attemptCount: 1,
        fixRoundsUsed: 0,
        claimEvidence: "proof",
        startedAt: 1,
        updatedAt: 1,
        failure: { kind: "timeout", message: "long failure details" },
      },
    },
    30,
  );

  assert.match(reviewing[1], /Review: reviewing/);
  assert.doesNotMatch(reviewing.join("\n"), /secret detailed finding/);
  assert.match(paused[1], /review paused/);
  assert.ok(reviewing.every((line) => line.length <= 30));
});

test("appends idle auto-run state to the usage line", () => {
  const lines = renderGoalWidgetLines(goalWithUsage, 120, undefined, {
    showUsage: true,
    autoRunEnabled: true,
    autoRunMaxContinuations: 10,
    autoRunMaxActiveMinutes: 60,
  });

  assert.match(lines[1], /auto-run idle/);
});
