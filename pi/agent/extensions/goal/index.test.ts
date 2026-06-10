import { test } from "node:test";
import assert from "node:assert/strict";
import { createGoalExtension } from "./index.ts";

function makePi() {
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  const widgets: Array<{ key: string; content: any; options?: any }> = [];
  const entries: Array<{ type: string; data: unknown }> = [];
  const sentMessages: Array<{ content: unknown; options: unknown }> = [];
  return {
    hasUI: true,
    commands,
    handlers,
    widgets,
    entries,
    sentMessages,
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    registerTool() {},
    on(name: string, handler: any) {
      handlers.set(name, handler);
    },
    setWidget(key: string, content: any, options?: any) {
      widgets.push({ key, content, options });
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
    sendUserMessage(content: unknown, options?: unknown) {
      sentMessages.push({ content, options });
    },
  } as any;
}

function makeCtx(branch: unknown[] = []) {
  const notifications: Array<{ msg: string; level: string }> = [];
  return {
    cwd: "/repo",
    hasUI: true,
    notifications,
    ui: {
      notify(msg: string, level: string) {
        notifications.push({ msg, level });
      },
      setWidget() {},
    },
    sessionManager: { getBranch: () => branch },
    hasPendingMessages: async () => false,
  } as any;
}

test("/goal-config displays effective config", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: false,
        showWidget: true,
        objectiveMaxChars: 123,
        evidenceMaxChars: 456,
        compactSummaryEnabled: true,
        checkpointCommits: false,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 7,
        autoRunMaxActiveMinutes: 8,
      },
      warnings: [],
    }),
  })(pi);

  await pi.commands.get("goal-config").handler("", ctx);

  assert.match(ctx.notifications.at(-1)?.msg, /goal effective config:/);
  assert.match(ctx.notifications.at(-1)?.msg, /"objectiveMaxChars": 123/);
  assert.match(ctx.notifications.at(-1)?.msg, /"checkpointCommits": false/);
});

test("commands mutate goal state and persist snapshots", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: true,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);

  await pi.commands.get("goal-set").handler("  Ship goal extension  ", ctx);
  assert.match(
    ctx.notifications.at(-1)?.msg,
    /Goal \[active\] Ship goal extension/,
  );
  assert.equal(pi.entries.at(-1)?.type, "goal-state");
  assert.deepEqual(pi.widgets.at(-1)?.options, { placement: "belowEditor" });

  await pi.commands.get("goal-pause").handler("", ctx);
  assert.match(ctx.notifications.at(-1)?.msg, /Goal \[paused\]/);

  await pi.commands.get("goal-resume").handler("", ctx);
  assert.match(ctx.notifications.at(-1)?.msg, /Goal \[active\]/);

  await pi.commands.get("goal-clear").handler("", ctx);
  assert.match(ctx.notifications.at(-1)?.msg, /cleared/i);
});

test("restore scans branch snapshots and before_agent_start injects only active goals", async () => {
  const pi = makePi();
  const branch = [
    {
      type: "custom",
      customType: "goal-state",
      data: {
        goal: {
          id: "g1",
          objective: "Finish docs",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
  ];
  const ctx = makeCtx(branch);
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);

  const result = await pi.handlers.get("before_agent_start")(
    { systemPrompt: "base" },
    ctx,
  );
  assert.match(result.systemPrompt, /Active Goal/);
  assert.match(result.systemPrompt, /Finish docs/);
  assert.match(result.systemPrompt, /TODOs are done/i);
  assert.match(result.systemPrompt, /commit/i);
  assert.match(result.systemPrompt, /Stage files by name/i);
});

test("compaction returns goal-aware summary when enabled", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("goal-set").handler("Finish compaction", ctx);

  const result = await pi.handlers.get("session_before_compact")(
    { preparation: { firstKeptEntryId: "e1", tokensBefore: 123 } },
    ctx,
  );
  assert.equal(result.compaction.firstKeptEntryId, "e1");
  assert.match(result.compaction.summary, /## Active Goal/);
  assert.match(result.compaction.summary, /Finish compaction/);
});

test("before_agent_start omits commit guidance when checkpointCommits is disabled", async () => {
  const pi = makePi();
  const ctx = makeCtx([
    {
      type: "custom",
      customType: "goal-state",
      data: {
        goal: {
          id: "g1",
          objective: "Finish docs",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
  ]);
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: false,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);

  const result = await pi.handlers.get("before_agent_start")(
    { systemPrompt: "base" },
    ctx,
  );

  assert.doesNotMatch(result.systemPrompt, /Stage files by name/i);
});

test("message_end records usage for active goals", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("goal-set").handler("Track usage", ctx);

  await pi.handlers.get("message_end")(
    { message: { role: "assistant", usage: { totalTokens: 250 } } },
    ctx,
  );
  await pi.commands.get("goal-show").handler("", ctx);

  assert.match(ctx.notifications.at(-1)?.msg, /250 tokens/);
  assert.match(ctx.notifications.at(-1)?.msg, /1 turn/);
});

test("/goal sets active goal, starts auto-run, and sends kickoff", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);

  await pi.commands.get("goal").handler("  Finish auto-run  ", ctx);

  assert.match(ctx.notifications.at(-1)?.msg, /Auto-run: running/);
  assert.equal(pi.sentMessages.length, 1);
  assert.match(String(pi.sentMessages[0].content), /Finish auto-run/);
  assert.equal(pi.entries.at(-1)?.type, "goal-state");
});

test("agent_end schedules bounded continuation", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("goal").handler("Keep working", ctx);

  await pi.handlers.get("agent_end")({}, ctx);

  assert.equal(pi.sentMessages.length, 2);
  assert.deepEqual(pi.sentMessages.at(-1)?.options, { deliverAs: "followUp" });
  assert.match(String(pi.entries.at(-1)?.data), /object Object/);
  assert.equal((pi.entries.at(-1)?.data as any).autoRun.continuationTurns, 1);
});

test("tool_call blocks ask_user only while goal auto-run is running", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  const toolCall = pi.handlers.get("tool_call");
  assert.ok(toolCall);

  assert.equal(
    await toolCall({ toolName: "ask_user", toolCallId: "call-0" }, ctx),
    undefined,
  );

  await pi.commands.get("goal").handler("Avoid interactive waits", ctx);

  const blocked = await toolCall(
    { toolName: "ask_user", toolCallId: "call-1" },
    ctx,
  );
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /ask_user is unavailable/i);

  assert.equal(
    await toolCall({ toolName: "read", toolCallId: "call-2" }, ctx),
    undefined,
  );

  await pi.commands.get("goal-stop").handler("", ctx);
  assert.equal(
    await toolCall({ toolName: "ask_user", toolCallId: "call-3" }, ctx),
    undefined,
  );
});

test("/goal-stop leaves goal active and stops auto-run", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("goal").handler("Stop later", ctx);

  await pi.commands.get("goal-stop").handler("", ctx);
  await pi.handlers.get("agent_end")({}, ctx);

  assert.match(ctx.notifications.at(-1)?.msg, /stopped/i);
  assert.equal((pi.entries.at(-1)?.data as any).goal.status, "active");
  assert.equal((pi.entries.at(-1)?.data as any).autoRun.status, "stopped");
  assert.equal(pi.sentMessages.length, 1);
});

test("agent_end stops auto-run at turn budget", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 1,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("goal").handler("Budgeted", ctx);
  await pi.handlers.get("agent_end")({}, ctx);

  await pi.handlers.get("agent_end")({}, ctx);

  assert.equal((pi.entries.at(-1)?.data as any).goal.status, "active");
  assert.equal((pi.entries.at(-1)?.data as any).autoRun.status, "stopped");
  assert.equal(
    (pi.entries.at(-1)?.data as any).autoRun.stopReason,
    "turn_budget",
  );
  assert.equal(pi.sentMessages.length, 2);
});

test("user input stops auto-run but extension input does not", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  createGoalExtension({
    loadConfig: async () => ({
      config: {
        injectActiveGoal: true,
        showWidget: false,
        objectiveMaxChars: 100,
        evidenceMaxChars: 100,
        compactSummaryEnabled: true,
        checkpointCommits: true,
        showUsage: true,
        autoRunEnabled: true,
        autoRunMaxTurns: 10,
        autoRunMaxActiveMinutes: 60,
      },
      warnings: [],
    }),
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("goal").handler("Handle interruption", ctx);

  await pi.handlers.get("input")({ source: "extension" }, ctx);
  assert.equal((pi.entries.at(-1)?.data as any).autoRun.status, "running");

  await pi.handlers.get("input")({ source: "interactive" }, ctx);
  assert.equal((pi.entries.at(-1)?.data as any).autoRun.status, "stopped");
  assert.equal(
    (pi.entries.at(-1)?.data as any).autoRun.stopReason,
    "user_input",
  );
});
