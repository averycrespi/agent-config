import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { THRESHOLD_CHARS } from "../_shared/spillover.ts";
import {
  buildAgentDescription,
  normalizeIntent,
  spillSubagentOutput,
  validateSpawnAgentSpecs,
} from "./index.ts";
import type { AgentDefinition } from "./types.ts";

// ─── normalizeIntent ─────────────────────────────────────────────────────────

test("normalizeIntent: trims surrounding whitespace", () => {
  assert.equal(normalizeIntent("  find auth  "), "find auth");
});

test("normalizeIntent: throws on empty string", () => {
  assert.throws(() => normalizeIntent(""), /intent is required/);
});

test("normalizeIntent: throws on whitespace-only string", () => {
  assert.throws(() => normalizeIntent("   \t\n  "), /intent is required/);
});

// ─── buildAgentDescription ───────────────────────────────────────────────────

function agent(name: string, description: string): AgentDefinition {
  return {
    name,
    description,
    tools: [],
    extensions: [],
    systemPrompt: "x",
    disableSkills: false,
    disablePromptTemplates: false,
  };
}

test("buildAgentDescription: empty list returns no-agents-loaded message", () => {
  const text = buildAgentDescription([]);
  assert.match(text, /No agents are currently loaded/);
});

test("buildAgentDescription: non-empty list enumerates name and description", () => {
  const text = buildAgentDescription([
    agent("explore", "Read-only research"),
    agent("code", "Full write access"),
  ]);
  assert.match(text, /Agent type\. Choose based on the task:/);
  assert.match(text, /- explore: Read-only research/);
  assert.match(text, /- code: Full write access/);
});

// ─── validateSpawnAgentSpecs ────────────────────────────────────────────────

test("validateSpawnAgentSpecs: reports all invalid agents before spawn", () => {
  const errors = validateSpawnAgentSpecs(
    [
      { agent: "explore", intent: "   ", prompt: "Inspect files" },
      { agent: "missing", intent: "review", prompt: "Review change" },
    ],
    new Map([["explore", agent("explore", "Read-only research")]]),
  );

  assert.deepEqual(errors, [
    "agents[0].intent is required",
    'agents[1].agent "missing" is not a known agent type',
  ]);
});

test("validateSpawnAgentSpecs: accepts known agents with non-empty intents", () => {
  const errors = validateSpawnAgentSpecs(
    [{ agent: "explore", intent: " inspect ", prompt: "Inspect files" }],
    new Map([["explore", agent("explore", "Read-only research")]]),
  );

  assert.deepEqual(errors, []);
});

// ─── spillSubagentOutput ────────────────────────────────────────────────────

test("spillSubagentOutput spills oversized subagent output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagent-spill-test-"));
  try {
    const largeOutput = "subagent output\n".repeat(
      Math.ceil((THRESHOLD_CHARS + 1) / "subagent output\n".length),
    );

    const result = await spillSubagentOutput(
      [{ type: "text", text: largeOutput }],
      "call/subagent?1",
      dir,
    );

    assert.equal(result.details.outputSpilled, true);
    assert.equal(result.details.originalSize, largeOutput.length);
    assert.match(result.content[0]!.text, /<persisted-output>/);
    assert.match(result.content[0]!.text, /call_subagent_1\.txt/);
    const spillFile = result.details.spillFile as string;
    assert.equal(await readFile(spillFile, "utf8"), largeOutput);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
