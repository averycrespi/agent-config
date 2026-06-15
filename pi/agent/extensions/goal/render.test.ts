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
  assert.match(paused[1], /auto-run disabled \(goal paused\)/);
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
