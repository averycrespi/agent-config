import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_SUBAGENTS_CONFIG,
  loadSubagentsConfig,
  normalizeSubagentsConfig,
  registerSubagentsConfigCommand,
} from "./config.ts";

for (const value of [1, 4, 16]) {
  test(`config retains valid maxConcurrency ${value}`, () => {
    assert.equal(
      normalizeSubagentsConfig({ maxConcurrency: value }, {}).maxConcurrency,
      value,
    );
  });
}

test("config exposes centralized policy defaults", () => {
  assert.deepEqual(normalizeSubagentsConfig({}, {}), DEFAULT_SUBAGENTS_CONFIG);
  assert.equal(
    DEFAULT_SUBAGENTS_CONFIG.modelTierSmall,
    "openai-codex/gpt-5.6-luna",
  );
  assert.equal(
    DEFAULT_SUBAGENTS_CONFIG.modelTierMedium,
    "openai-codex/gpt-5.6-terra",
  );
  assert.equal(
    DEFAULT_SUBAGENTS_CONFIG.modelTierLarge,
    "openai-codex/gpt-5.6-sol",
  );
  assert.deepEqual(DEFAULT_SUBAGENTS_CONFIG.allowedCapabilities, [
    "read-filesystem",
    "exec-shell",
    "read-broker",
    "read-web",
  ]);
  assert.deepEqual(DEFAULT_SUBAGENTS_CONFIG.allowedThinkingLevels, [
    "low",
    "medium",
    "high",
  ]);
});

test("global config normalizes selectors and allowlists", () => {
  assert.deepEqual(
    normalizeSubagentsConfig(
      {
        maxConcurrency: 8,
        modelTierSmall: "p/s",
        modelTierMedium: "p/m",
        modelTierLarge: "p/l",
        allowedCapabilities: ["read-web", "read-web", "read-filesystem"],
        allowedThinkingLevels: ["max", "high", "max"],
      },
      {},
    ),
    {
      maxConcurrency: 8,
      modelTierSmall: "p/s",
      modelTierMedium: "p/m",
      modelTierLarge: "p/l",
      allowedCapabilities: ["read-web", "read-filesystem"],
      allowedThinkingLevels: ["max", "high"],
    },
  );
});

test("every field has an environment override", () => {
  assert.deepEqual(
    normalizeSubagentsConfig(
      { maxConcurrency: 2 },
      {
        SUBAGENTS_MAX_CONCURRENCY: "7",
        SUBAGENTS_MODEL_TIER_SMALL: "env/s",
        SUBAGENTS_MODEL_TIER_MEDIUM: "env/m",
        SUBAGENTS_MODEL_TIER_LARGE: "env/l",
        SUBAGENTS_ALLOWED_CAPABILITIES: "read-broker,read-web",
        SUBAGENTS_ALLOWED_THINKING_LEVELS: "low,max",
      },
    ),
    {
      maxConcurrency: 7,
      modelTierSmall: "env/s",
      modelTierMedium: "env/m",
      modelTierLarge: "env/l",
      allowedCapabilities: ["read-broker", "read-web"],
      allowedThinkingLevels: ["low", "max"],
    },
  );
});

test("invalid values warn and preserve valid fallback policy", () => {
  const warnings: string[] = [];
  const value = normalizeSubagentsConfig(
    {
      maxConcurrency: "many",
      modelTierMedium: "invalid",
      allowedCapabilities: ["write"],
      allowedThinkingLevels: ["ultra"],
    },
    {
      SUBAGENTS_MAX_CONCURRENCY: "99",
      SUBAGENTS_MODEL_TIER_LARGE: "bad",
      SUBAGENTS_ALLOWED_CAPABILITIES: "unknown",
      SUBAGENTS_ALLOWED_THINKING_LEVELS: "ultra",
    },
    warnings,
  );
  assert.equal(value.maxConcurrency, 16);
  assert.equal(value.modelTierMedium, DEFAULT_SUBAGENTS_CONFIG.modelTierMedium);
  assert.deepEqual(
    value.allowedCapabilities,
    DEFAULT_SUBAGENTS_CONFIG.allowedCapabilities,
  );
  assert.deepEqual(
    value.allowedThinkingLevels,
    DEFAULT_SUBAGENTS_CONFIG.allowedThinkingLevels,
  );
  assert.match(warnings.join("\n"), /invalid global modelTierMedium/);
  assert.match(warnings.join("\n"), /SUBAGENTS_ALLOWED_THINKING_LEVELS/);
});

test("project settings cannot widen global subagent policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagents-config-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        "extension:subagents": {
          maxConcurrency: 6,
          allowedCapabilities: ["read-filesystem"],
          modelTierMedium: "global/model",
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:subagents": {
          maxConcurrency: 16,
          allowedCapabilities: ["exec-shell"],
          modelTierMedium: "project/model",
        },
      }),
    );
    const loaded = await loadSubagentsConfig(cwd, [], { agentDir, env: {} });
    assert.equal(loaded.maxConcurrency, 6);
    assert.deepEqual(loaded.allowedCapabilities, ["read-filesystem"]);
    assert.equal(loaded.modelTierMedium, "global/model");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("subagents config command reports effective global policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagents-command-"));
  const agentDir = join(root, "agent");
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const commands = new Map<string, any>();
  const messages: string[] = [];
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ "extension:subagents": { modelTierMedium: "p/m" } }),
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;
    registerSubagentsConfigCommand({
      registerCommand(name: string, command: any) {
        commands.set(name, command);
      },
    } as any);
    await commands.get("subagents-config").handler("", {
      cwd: root,
      ui: { notify: (message: string) => messages.push(message) },
    });
    assert.match(messages[0]!, /"modelTierMedium": "p\/m"/);
    assert.match(messages[0]!, /"allowedCapabilities"/);
    assert.match(messages[0]!, /"allowedThinkingLevels"/);
  } finally {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});
