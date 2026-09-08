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
    DEFAULT_SUBAGENTS_CONFIG.profileFastModel,
    "openai-codex/gpt-5.6-luna",
  );
  assert.equal(DEFAULT_SUBAGENTS_CONFIG.profileFastEffort, "medium");
  assert.equal(
    DEFAULT_SUBAGENTS_CONFIG.profileBalancedModel,
    "openai-codex/gpt-5.6-sol",
  );
  assert.equal(DEFAULT_SUBAGENTS_CONFIG.profileBalancedEffort, "medium");
  assert.equal(
    DEFAULT_SUBAGENTS_CONFIG.profileStrongModel,
    "openai-codex/gpt-6-astra",
  );
  assert.equal(DEFAULT_SUBAGENTS_CONFIG.profileStrongEffort, "high");
  assert.deepEqual(DEFAULT_SUBAGENTS_CONFIG.allowedCapabilities, [
    "read-filesystem",
    "write-filesystem",
    "exec-shell",
    "read-mcp",
    "read-web",
  ]);
  assert.equal("allowedEffortLevels" in DEFAULT_SUBAGENTS_CONFIG, false);
});

test("global config normalizes selectors and capability allowlist", () => {
  assert.deepEqual(
    normalizeSubagentsConfig(
      {
        maxConcurrency: 8,
        profileFastModel: "p/f",
        profileFastEffort: "low",
        profileBalancedModel: "p/b",
        profileBalancedEffort: "medium",
        profileStrongModel: "p/s",
        profileStrongEffort: "max",
        allowedCapabilities: ["read-web", "read-web", "write-filesystem"],
      },
      {},
    ),
    {
      maxConcurrency: 8,
      profileFastModel: "p/f",
      profileFastEffort: "low",
      profileBalancedModel: "p/b",
      profileBalancedEffort: "medium",
      profileStrongModel: "p/s",
      profileStrongEffort: "max",
      allowedCapabilities: ["read-web", "write-filesystem"],
    },
  );
});

test("every field has an environment override", () => {
  assert.deepEqual(
    normalizeSubagentsConfig(
      { maxConcurrency: 2 },
      {
        SUBAGENTS_MAX_CONCURRENCY: "7",
        SUBAGENTS_PROFILE_FAST_MODEL: "env/f",
        SUBAGENTS_PROFILE_FAST_EFFORT: "low",
        SUBAGENTS_PROFILE_BALANCED_MODEL: "env/b",
        SUBAGENTS_PROFILE_BALANCED_EFFORT: "medium",
        SUBAGENTS_PROFILE_STRONG_MODEL: "env/s",
        SUBAGENTS_PROFILE_STRONG_EFFORT: "max",
        SUBAGENTS_ALLOWED_CAPABILITIES: "read-mcp,write-filesystem",
      },
    ),
    {
      maxConcurrency: 7,
      profileFastModel: "env/f",
      profileFastEffort: "low",
      profileBalancedModel: "env/b",
      profileBalancedEffort: "medium",
      profileStrongModel: "env/s",
      profileStrongEffort: "max",
      allowedCapabilities: ["read-mcp", "write-filesystem"],
    },
  );
});

test("removed effort allowlists are ignored and diagnosed", () => {
  const warnings: string[] = [];
  const value = normalizeSubagentsConfig(
    {
      allowedEffortLevels: ["low"],
      allowedThinkingLevels: ["medium"],
    },
    {
      SUBAGENTS_ALLOWED_EFFORT_LEVELS: "high",
      SUBAGENTS_ALLOWED_THINKING_LEVELS: "max",
    },
    warnings,
  );
  assert.equal("allowedEffortLevels" in value, false);
  assert.match(warnings.join("\n"), /allowedEffortLevels was removed/);
  assert.match(warnings.join("\n"), /allowedThinkingLevels was removed/);
  assert.match(
    warnings.join("\n"),
    /SUBAGENTS_ALLOWED_EFFORT_LEVELS was removed/,
  );
  assert.match(
    warnings.join("\n"),
    /SUBAGENTS_ALLOWED_THINKING_LEVELS was removed/,
  );
});

test("legacy tier selectors migrate as deprecated profile model fallbacks", () => {
  const warnings: string[] = [];
  const value = normalizeSubagentsConfig(
    {
      modelTierSmall: "legacy/fast",
      modelTierMedium: "legacy/balanced",
      profileStrongModel: "new/strong",
      modelTierLarge: "legacy/strong",
    },
    {
      SUBAGENTS_MODEL_TIER_MEDIUM: "env/balanced",
    },
    warnings,
  );
  assert.equal(value.profileFastModel, "legacy/fast");
  assert.equal(value.profileBalancedModel, "env/balanced");
  assert.equal(value.profileStrongModel, "new/strong");
  assert.match(warnings.join("\n"), /modelTierSmall is deprecated/);
  assert.match(
    warnings.join("\n"),
    /SUBAGENTS_MODEL_TIER_MEDIUM is deprecated/,
  );
});

test("invalid values warn and preserve valid fallback policy", () => {
  const warnings: string[] = [];
  const value = normalizeSubagentsConfig(
    {
      maxConcurrency: "many",
      profileBalancedModel: "invalid",
      profileStrongEffort: "ultra",
      allowedCapabilities: ["write"],
    },
    {
      SUBAGENTS_MAX_CONCURRENCY: "99",
      SUBAGENTS_PROFILE_STRONG_MODEL: "bad",
      SUBAGENTS_PROFILE_FAST_EFFORT: "ultra",
      SUBAGENTS_ALLOWED_CAPABILITIES: "unknown",
    },
    warnings,
  );
  assert.equal(value.maxConcurrency, 16);
  assert.equal(
    value.profileBalancedModel,
    DEFAULT_SUBAGENTS_CONFIG.profileBalancedModel,
  );
  assert.equal(
    value.profileStrongEffort,
    DEFAULT_SUBAGENTS_CONFIG.profileStrongEffort,
  );
  assert.deepEqual(value.allowedCapabilities, []);
  assert.match(warnings.join("\n"), /invalid global profileBalancedModel/);
  assert.match(warnings.join("\n"), /invalid global profileStrongEffort/);
});

test("retired capability ceilings fail closed rather than broadening to defaults", () => {
  for (const [settings, env] of [
    [{ allowedCapabilities: ["read-broker"] }, {}],
    [
      { allowedCapabilities: ["read-filesystem"] },
      { SUBAGENTS_ALLOWED_CAPABILITIES: "read-broker" },
    ],
    [{}, { SUBAGENTS_ALLOWED_CAPABILITIES: "" }],
  ] as const) {
    const warnings: string[] = [];
    assert.deepEqual(
      normalizeSubagentsConfig(settings, env, warnings).allowedCapabilities,
      [],
    );
    assert.match(warnings.join("\n"), /denying all capabilities/);
  }
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
          profileBalancedModel: "global/model",
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:subagents": {
          maxConcurrency: 16,
          allowedCapabilities: ["exec-shell"],
          profileBalancedModel: "project/model",
        },
      }),
    );
    const loaded = await loadSubagentsConfig(cwd, [], { agentDir, env: {} });
    assert.equal(loaded.maxConcurrency, 6);
    assert.deepEqual(loaded.allowedCapabilities, ["read-filesystem"]);
    assert.equal(loaded.profileBalancedModel, "global/model");
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
      JSON.stringify({
        "extension:subagents": { profileBalancedModel: "p/m" },
      }),
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
    assert.match(messages[0]!, /"profileBalancedModel": "p\/m"/);
    assert.match(messages[0]!, /"allowedCapabilities"/);
    assert.doesNotMatch(messages[0]!, /"allowedEffortLevels"/);
  } finally {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});
