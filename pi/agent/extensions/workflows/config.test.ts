import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKFLOW_CONFIG,
  normalizeWorkflowConfig,
  readEnvSettings,
} from "./config.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

test("workflow config exposes all defaults", () => {
  assert.equal(DEFAULT_WORKFLOW_CONFIG.workflowTimeoutMs, ONE_HOUR_MS);
  assert.deepEqual(normalizeWorkflowConfig({}), DEFAULT_WORKFLOW_CONFIG);
  assert.equal(DEFAULT_WORKFLOW_CONFIG.maxConcurrency, 4);
  assert.equal(DEFAULT_WORKFLOW_CONFIG.maxTokensPerRun, 0);
  assert.equal(DEFAULT_WORKFLOW_CONFIG.maxAgentsPerRun, 100);
  assert.equal(
    DEFAULT_WORKFLOW_CONFIG.modelTierSmall,
    "openai-codex/gpt-5.6-luna",
  );
  assert.equal(
    DEFAULT_WORKFLOW_CONFIG.modelTierBig,
    "openai-codex/gpt-5.6-sol",
  );
});

test("workflow config accepts settings and environment overrides", () => {
  assert.deepEqual(
    normalizeWorkflowConfig({
      workflowTimeoutMs: 12_000,
      agentTimeoutMs: "5000",
      maxConcurrency: 8,
      maxTokensPerRun: "0",
      maxAgentsPerRun: 12,
      modelTierSmall: " openai/small ",
      modelTierBig: "anthropic/big",
    }),
    {
      workflowTimeoutMs: 12_000,
      agentTimeoutMs: 5_000,
      maxConcurrency: 8,
      maxTokensPerRun: 0,
      maxAgentsPerRun: 12,
      modelTierSmall: "openai/small",
      modelTierBig: "anthropic/big",
    },
  );

  assert.deepEqual(
    readEnvSettings({
      WORKFLOWS_WORKFLOW_TIMEOUT_MS: "9000",
      WORKFLOWS_AGENT_TIMEOUT_MS: "3000",
      WORKFLOWS_MAX_CONCURRENCY: "6",
      WORKFLOWS_MAX_TOKENS_PER_RUN: "10000",
      WORKFLOWS_MAX_AGENTS_PER_RUN: "0",
      WORKFLOWS_MODEL_TIER_SMALL: " openai/small ",
      WORKFLOWS_MODEL_TIER_BIG: " ",
    } as NodeJS.ProcessEnv),
    {
      workflowTimeoutMs: 9_000,
      agentTimeoutMs: 3_000,
      maxConcurrency: 6,
      maxTokensPerRun: 10_000,
      maxAgentsPerRun: 0,
      modelTierSmall: "openai/small",
      modelTierBig: "",
    },
  );
});

test("workflow config rejects invalid settings with warnings", () => {
  const warnings: string[] = [];
  assert.deepEqual(
    normalizeWorkflowConfig(
      {
        workflowTimeoutMs: 0,
        agentTimeoutMs: "not-a-number",
        maxConcurrency: 0,
        maxTokensPerRun: -1,
        maxAgentsPerRun: 1.5,
        modelTierSmall: 42,
      },
      warnings,
    ),
    DEFAULT_WORKFLOW_CONFIG,
  );
  assert.deepEqual(warnings, [
    "Ignoring invalid workflowTimeoutMs; using default.",
    "Ignoring invalid agentTimeoutMs; using default.",
    "Ignoring invalid maxConcurrency; using default.",
    "Ignoring invalid maxTokensPerRun; using default.",
    "Ignoring invalid maxAgentsPerRun; using default.",
    "Ignoring invalid modelTierSmall; using default.",
  ]);
});

test("workflow config clamps concurrency above the host ceiling", () => {
  const settingsWarnings: string[] = [];
  assert.equal(
    normalizeWorkflowConfig({ maxConcurrency: 99 }, settingsWarnings)
      .maxConcurrency,
    16,
  );
  assert.deepEqual(settingsWarnings, ["Clamping maxConcurrency to 16."]);

  const envWarnings: string[] = [];
  assert.deepEqual(
    readEnvSettings(
      { WORKFLOWS_MAX_CONCURRENCY: "99" } as NodeJS.ProcessEnv,
      envWarnings,
    ),
    { maxConcurrency: 16 },
  );
  assert.deepEqual(envWarnings, ["Clamping WORKFLOWS_MAX_CONCURRENCY to 16."]);
});

test("invalid environment values do not override lower-precedence settings", () => {
  const warnings: string[] = [];
  assert.deepEqual(
    readEnvSettings(
      {
        WORKFLOWS_MAX_CONCURRENCY: "nope",
        WORKFLOWS_MAX_TOKENS_PER_RUN: "-1",
        WORKFLOWS_MAX_AGENTS_PER_RUN: "1.2",
      } as NodeJS.ProcessEnv,
      warnings,
    ),
    {},
  );
  assert.deepEqual(warnings, [
    "Ignoring invalid WORKFLOWS_MAX_CONCURRENCY.",
    "Ignoring invalid WORKFLOWS_MAX_TOKENS_PER_RUN.",
    "Ignoring invalid WORKFLOWS_MAX_AGENTS_PER_RUN.",
  ]);
});
