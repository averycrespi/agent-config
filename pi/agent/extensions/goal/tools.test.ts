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

test("goal_update review gate persists reviewing then passes clean review", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 2);
  store.setGoal("Finish goal extension", 100);
  let request: any;
  registerGoalTools(pi, store, {
    evidenceMaxChars: 100,
    reviewEnabled: true,
    reviewMaxFixRounds: 1,
    reviewTimeoutSeconds: 30,
    reviewRunner: async (value) => {
      request = value;
      return { kind: "pass", summary: "Clean", findings: [] };
    },
  });

  const result = await pi.tools
    .get("goal_update")
    .execute(
      "call-1",
      { status: "complete", evidence: "tests pass" },
      undefined,
      undefined,
      { cwd: "/repo" },
    );

  assert.equal(request.cwd, "/repo");
  assert.equal(request.evidence, "tests pass");
  assert.equal(request.timeoutSeconds, 30);
  assert.equal(store.getGoal()?.review?.status, "passed");
  assert.equal(store.getGoal()?.status, "complete");
  assert.equal(pi.entries.length, 2);
  assert.equal((pi.entries[0].data as any).goal.review.status, "reviewing");
  assert.match(result.content[0].text, /Review: passed/);
});

test("goal_update keeps first blocking review active and exhausts the next", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 3);
  store.setGoal("Fix all cases", 100);
  const requests: any[] = [];
  const finding = {
    severity: "important" as const,
    confidence: 95,
    description: "Case missing",
    evidence: "test absent",
  };
  registerGoalTools(pi, store, {
    evidenceMaxChars: 100,
    reviewEnabled: true,
    reviewMaxFixRounds: 1,
    reviewTimeoutSeconds: 30,
    reviewRunner: async (request) => {
      requests.push(request);
      return {
        kind: "block",
        summary: "Blocked",
        findings: [finding],
      };
    },
  });
  const tool = pi.tools.get("goal_update");
  const first = await tool.execute(
    "1",
    { status: "complete", evidence: "first" },
    undefined,
    undefined,
    { cwd: "/repo" },
  );
  assert.equal(store.getGoal()?.review?.status, "fix_required");
  assert.match(first.content[0].text, /fix reasonable.*or refute/is);
  const second = await tool.execute(
    "2",
    { status: "complete", evidence: "second" },
    undefined,
    undefined,
    { cwd: "/repo" },
  );
  assert.equal(requests[1].priorFindings.length, 1);
  assert.equal(store.getGoal()?.review?.status, "exhausted");
  assert.equal(store.getGoal()?.status, "paused");
  assert.match(second.content[0].text, /exhausted/i);
});

test("goal_update persists before await and ignores a stale deferred result", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 5);
  store.setGoal("Avoid stale completion", 100);
  let settle!: (result: any) => void;
  let runnerCalls = 0;
  registerGoalTools(pi, store, {
    evidenceMaxChars: 100,
    reviewEnabled: true,
    reviewMaxFixRounds: 1,
    reviewTimeoutSeconds: 30,
    reviewRunner: async () => {
      runnerCalls += 1;
      return await new Promise((resolve) => {
        settle = resolve;
      });
    },
  });

  const pending = pi.tools
    .get("goal_update")
    .execute(
      "1",
      { status: "complete", evidence: "proof" },
      undefined,
      undefined,
      { cwd: "/repo" },
    );
  assert.equal(pi.entries.length, 1);
  assert.equal((pi.entries[0].data as any).goal.review.status, "reviewing");
  const concurrent = await pi.tools
    .get("goal_update")
    .execute(
      "2",
      { status: "complete", evidence: "second proof" },
      undefined,
      undefined,
      { cwd: "/repo" },
    );
  assert.equal(runnerCalls, 1);
  assert.match(concurrent.content[0].text, /review is already in progress/i);
  store.pause();
  settle({ kind: "pass", summary: "Late clean result", findings: [] });
  const result = await pending;

  assert.equal(store.getGoal()?.status, "paused");
  assert.equal(pi.entries.length, 1);
  assert.match(result.content[0].text, /became stale/i);
});

test("goal_update fails closed when review is unavailable", async () => {
  const pi = makePi();
  const store = createGoalStore(() => 4);
  store.setGoal("Review safely", 100);
  registerGoalTools(pi, store, {
    evidenceMaxChars: 100,
    reviewEnabled: true,
    reviewMaxFixRounds: 1,
    reviewTimeoutSeconds: 30,
    reviewRunner: async () => ({
      kind: "failure",
      code: "timeout",
      message: "timed out",
    }),
  });
  const result = await pi.tools
    .get("goal_update")
    .execute(
      "1",
      { status: "complete", evidence: "proof" },
      undefined,
      undefined,
      { cwd: "/repo" },
    );
  assert.equal(store.getGoal()?.status, "paused");
  assert.equal(store.getGoal()?.review?.status, "unavailable");
  assert.match(result.content[0].text, /unavailable/i);
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
