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

async function execute(pi: ReturnType<typeof makePi>, params: unknown) {
  return pi.tools
    .get("goal")
    .execute("call-1", params, undefined, undefined, {});
}

test("goal get returns current state without mutating", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  store.setGoal("Finish goal extension", 100);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await execute(pi, { action: "get" });

  assert.match(result.content[0].text, /Goal \[active\] Finish goal extension/);
  assert.equal(pi.entries.length, 0);
  assert.deepEqual([...pi.tools.keys()], ["goal"]);
});

test("goal advertises action-specific fields without a stale config cap", () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const tool = pi.tools.get("goal");
  assert.deepEqual(tool.parameters.properties.action.enum, [
    "get",
    "complete",
    "yield",
  ]);
  assert.equal(tool.parameters.properties.evidence.maxLength, undefined);
  assert.equal(tool.parameters.properties.reason.maxLength, undefined);
  assert.match(tool.promptGuidelines.join("\n"), /effective configured limit/);
});

test("goal enforces the effective runtime cap", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  store.setGoal("Finish goal extension", 100);
  store.startAutoRun();
  registerGoalTools(pi, store, { evidenceMaxChars: 5 });

  const result = await execute(pi, {
    action: "yield",
    reason: "123456",
  });

  assert.match(result.content[0].text, /reason must be at most 5 characters/);
  assert.equal(store.getAutoRun()?.status, "running");
});

test("goal validates action-specific parameters atomically", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 1);
  store.setGoal("Finish goal extension", 100);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const invalid = await execute(pi, {
    action: "unknown",
    evidence: "done",
    reason: "stop",
  });
  assert.match(invalid.content[0].text, /action must be one of/);

  const missingEvidence = await execute(pi, {
    action: "complete",
    evidence: "   ",
    reason: "unexpected",
  });
  assert.match(missingEvidence.content[0].text, /evidence is required/);
  assert.match(missingEvidence.content[0].text, /reason is not accepted/);

  const missingReason = await execute(pi, {
    action: "yield",
    reason: "   ",
    evidence: "unexpected",
  });
  assert.match(missingReason.content[0].text, /reason is required/);
  assert.match(missingReason.content[0].text, /evidence is not accepted/);
  assert.equal(pi.entries.length, 0);
});

test("goal complete records evidence and persists state", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 2);
  store.setGoal("Finish goal extension", 100);
  store.startAutoRun();
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await execute(pi, {
    action: "complete",
    evidence: "typecheck and tests pass",
  });

  assert.match(result.content[0].text, /Goal \[complete\]/);
  assert.equal(store.getGoal()?.completionEvidence, "typecheck and tests pass");
  assert.equal(store.getAutoRun()?.stopReason, "goal_complete");
  assert.equal(pi.entries.length, 1);
  assert.equal(pi.entries[0].type, "goal-state");
});

test("goal yield stops automation without completing the goal", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 3);
  store.setGoal("Finish goal extension", 100);
  store.startAutoRun();
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await execute(pi, {
    action: "yield",
    reason: "Need user approval",
  });

  assert.match(result.content[0].text, /Goal \[active\]/);
  assert.match(result.content[0].text, /agent_yield · Need user approval/);
  assert.equal(store.getGoal()?.status, "active");
  assert.equal(store.getAutoRun()?.status, "stopped");
  assert.equal(store.getAutoRun()?.stopReason, "agent_yield");
  assert.equal(store.getAutoRun()?.stopDetail, "Need user approval");
  assert.equal(pi.entries.length, 1);
});

test("goal yield rejects a completed goal", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 3);
  store.setGoal("Finish goal extension", 100);
  store.complete("verified", 100);
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await execute(pi, {
    action: "yield",
    reason: "Need user approval",
  });

  assert.match(result.content[0].text, /only an active goal can yield/);
  assert.equal(store.getGoal()?.status, "complete");
  assert.equal(pi.entries.length, 0);
});

test("goal yield is idempotent when automation is already stopped", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 3);
  store.setGoal("Finish goal extension", 100);
  store.startAutoRun();
  store.stopAutoRun("user_input");
  registerGoalTools(pi, store, { evidenceMaxChars: 100 });

  const result = await execute(pi, {
    action: "yield",
    reason: "Need user approval",
  });

  assert.match(result.content[0].text, /already stopped/);
  assert.equal(store.getAutoRun()?.stopReason, "user_input");
  assert.equal(pi.entries.length, 0);
});
