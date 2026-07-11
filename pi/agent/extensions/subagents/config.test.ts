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
    assert.deepEqual(
      normalizeSubagentsConfig({ maxConcurrency: value }, {}, []),
      { maxConcurrency: value },
    );
  });
}

test("config clamps maxConcurrency to the hard ceiling", () => {
  const warnings: string[] = [];
  assert.deepEqual(
    normalizeSubagentsConfig({ maxConcurrency: 99 }, {}, warnings),
    { maxConcurrency: 16 },
  );
  assert.match(warnings.join("\n"), /clamp.*16/i);
});

test("invalid global config falls back to the default", () => {
  const warnings: string[] = [];
  assert.deepEqual(
    normalizeSubagentsConfig({ maxConcurrency: "many" }, {}, warnings),
    DEFAULT_SUBAGENTS_CONFIG,
  );
  assert.match(warnings.join("\n"), /invalid.*maxConcurrency/i);
});

test("valid environment config wins over global config", () => {
  assert.deepEqual(
    normalizeSubagentsConfig(
      { maxConcurrency: 2 },
      { SUBAGENTS_MAX_CONCURRENCY: "7" },
    ),
    { maxConcurrency: 7 },
  );
});

test("invalid environment config preserves valid global config", () => {
  const warnings: string[] = [];
  assert.deepEqual(
    normalizeSubagentsConfig(
      { maxConcurrency: 6 },
      { SUBAGENTS_MAX_CONCURRENCY: "invalid" },
      warnings,
    ),
    { maxConcurrency: 6 },
  );
  assert.match(warnings.join("\n"), /SUBAGENTS_MAX_CONCURRENCY/);
});

test("project settings do not affect loaded config", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagents-config-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ "extension:subagents": { maxConcurrency: 6 } }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "extension:subagents": { maxConcurrency: 2 } }),
    );

    assert.deepEqual(
      await loadSubagentsConfig(cwd, [], { agentDir, env: {} }),
      { maxConcurrency: 6 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("subagents config command is global-only across cwd values", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagents-command-"));
  const agentDir = join(root, "agent");
  const cwdA = join(root, "a");
  const cwdB = join(root, "b");
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const commands = new Map<string, any>();
  const messages: string[] = [];
  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(cwdA, ".pi"), { recursive: true });
    await mkdir(join(cwdB, ".pi"), { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ "extension:subagents": { maxConcurrency: 8 } }),
    );
    await writeFile(
      join(cwdA, ".pi", "settings.json"),
      JSON.stringify({ "extension:subagents": { maxConcurrency: 1 } }),
    );
    await writeFile(
      join(cwdB, ".pi", "settings.json"),
      JSON.stringify({ "extension:subagents": { maxConcurrency: 16 } }),
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;

    registerSubagentsConfigCommand({
      registerCommand(name: string, command: any) {
        commands.set(name, command);
      },
    } as any);
    const command = commands.get("subagents-config");
    assert.ok(command);
    for (const cwd of [cwdA, cwdB]) {
      await command.handler("", {
        cwd,
        ui: { notify: (message: string) => messages.push(message) },
      });
    }

    assert.equal(messages.length, 2);
    assert.equal(messages[0], messages[1]);
    assert.match(messages[0]!, /"maxConcurrency": 8/);
  } finally {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});
