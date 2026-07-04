import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKFLOW_CONFIG,
  normalizeWorkflowConfig,
  readEnvSettings,
} from "./config.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

test("workflow config defaults to one-hour workflow timeout", () => {
  assert.equal(DEFAULT_WORKFLOW_CONFIG.workflowTimeoutMs, ONE_HOUR_MS);
  assert.equal(normalizeWorkflowConfig({}).workflowTimeoutMs, ONE_HOUR_MS);
});

test("workflow config accepts positive timeout settings and environment overrides", () => {
  assert.deepEqual(
    normalizeWorkflowConfig({
      workflowTimeoutMs: 12_000,
      agentTimeoutMs: "5000",
    }),
    { workflowTimeoutMs: 12_000, agentTimeoutMs: 5_000 },
  );

  assert.deepEqual(
    readEnvSettings({
      WORKFLOWS_WORKFLOW_TIMEOUT_MS: "9000",
      WORKFLOWS_AGENT_TIMEOUT_MS: "3000",
    } as NodeJS.ProcessEnv),
    { workflowTimeoutMs: 9_000, agentTimeoutMs: 3_000 },
  );
});

test("workflow config rejects invalid timeout settings with warnings", () => {
  const warnings: string[] = [];
  assert.deepEqual(
    normalizeWorkflowConfig(
      { workflowTimeoutMs: 0, agentTimeoutMs: "not-a-number" },
      warnings,
    ),
    DEFAULT_WORKFLOW_CONFIG,
  );
  assert.deepEqual(warnings, [
    "Ignoring invalid workflowTimeoutMs; using default.",
    "Ignoring invalid agentTimeoutMs; using default.",
  ]);
});
