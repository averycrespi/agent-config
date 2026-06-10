import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGoalWidgetLines } from "./render.ts";
import type { Goal } from "./state.ts";

const baseGoal: Goal = {
  id: "goal-1",
  objective: "Fix auth token expiry handling across middleware and tests",
  status: "active",
  createdAt: 1,
  updatedAt: 1,
};

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
