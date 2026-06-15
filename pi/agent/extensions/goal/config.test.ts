import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGoalConfig } from "./config.ts";

test("parseGoalConfig applies defaults and environment overrides", () => {
  const warnings: string[] = [];
  const config = parseGoalConfig({
    settings: { showWidget: false, objectiveMaxChars: 50 },
    env: {
      GOAL_SHOW_WIDGET: "true",
      GOAL_EVIDENCE_MAX_CHARS: "25",
      GOAL_AUTO_RUN_MAX_CONTINUATIONS: "5",
      GOAL_AUTO_RUN_MAX_ACTIVE_MINUTES: "30",
      GOAL_AUTO_RUN_ENABLED: "false",
    },
    warnings,
  });

  assert.equal(config.showWidget, true);
  assert.equal(config.objectiveMaxChars, 50);
  assert.equal(config.evidenceMaxChars, 25);
  assert.equal(config.injectActiveGoal, true);
  assert.equal(config.checkpointCommits, true);
  assert.equal(config.showUsage, true);
  assert.equal(config.autoRunEnabled, false);
  assert.equal(config.autoRunMaxContinuations, 5);
  assert.equal(config.autoRunMaxActiveMinutes, 30);
  assert.deepEqual(warnings, []);
});

test("parseGoalConfig rejects invalid numeric config with warning", () => {
  const warnings: string[] = [];
  const config = parseGoalConfig({
    settings: { objectiveMaxChars: -1, autoRunMaxContinuations: 0 },
    env: {
      GOAL_COMPACT_SUMMARY_ENABLED: "maybe",
      GOAL_CHECKPOINT_COMMITS: "false",
      GOAL_SHOW_USAGE: "false",
      GOAL_AUTO_RUN_MAX_ACTIVE_MINUTES: "never",
    },
    warnings,
  });

  assert.equal(config.objectiveMaxChars, 4000);
  assert.equal(config.compactSummaryEnabled, true);
  assert.equal(config.checkpointCommits, false);
  assert.equal(config.showUsage, false);
  assert.equal(config.autoRunMaxContinuations, 10);
  assert.equal(config.autoRunMaxActiveMinutes, 60);
  assert.match(warnings.join("\n"), /objectiveMaxChars/);
  assert.match(warnings.join("\n"), /autoRunMaxContinuations/);
  assert.match(warnings.join("\n"), /autoRunMaxActiveMinutes/);
  assert.match(warnings.join("\n"), /GOAL_COMPACT_SUMMARY_ENABLED/);
});
