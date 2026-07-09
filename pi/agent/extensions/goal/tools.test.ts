import { test } from "node:test";
import assert from "node:assert/strict";
import { createGoalStore } from "./state.ts";
import { registerGoalTools } from "./tools.ts";

function makePi() {
  const tools = new Map<string, any>();
  const entries: Array<{ type: string; data: unknown }> = [];
  return {
    tools,
    entries,
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
  } as any;
}

test("goal_get returns current goal without mutating", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  store.setGoal("Finish goal extension", 100);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await pi.tools
    .get("goal_get")
    .execute("call-1", {}, undefined, undefined, {});

  assert.match(result.content[0].text, /Goal \[active\] Finish goal extension/);
  assert.equal(pi.entries.length, 0);
});

test("goal_update advertises concise evidence cap", () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const tool = pi.tools.get("goal_update");
  assert.equal(tool.parameters.properties.evidence.maxLength, 100);
  assert.match(tool.description, /up to 100 characters/);
  assert.match(tool.promptSnippet, /at most 100 characters/);
  assert.match(tool.promptGuidelines.join("\n"), /at most 100 characters/);
});

test("goal_update requires complete status and non-empty evidence", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  store.setGoal("Finish goal extension", 100);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const badStatus = await pi.tools
    .get("goal_update")
    .execute(
      "call-1",
      { status: "paused", evidence: "done" },
      undefined,
      undefined,
      {},
    );
  assert.match(badStatus.content[0].text, /Error: status must be "complete"/);

  const missingEvidence = await pi.tools
    .get("goal_update")
    .execute(
      "call-2",
      { status: "complete", evidence: "   " },
      undefined,
      undefined,
      {},
    );
  assert.match(missingEvidence.content[0].text, /Error: evidence is required/);
});

test("goal_update completes active goal with evidence and persists state", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 2);
  store.setGoal("Finish goal extension", 100);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await pi.tools
    .get("goal_update")
    .execute(
      "call-1",
      { status: "complete", evidence: "typecheck and tests pass" },
      undefined,
      undefined,
      {},
    );

  assert.match(result.content[0].text, /Goal \[complete\]/);
  assert.equal(store.getGoal()?.completionEvidence, "typecheck and tests pass");
  assert.equal(pi.entries.length, 1);
  assert.equal(pi.entries[0].type, "goal-state");
});
