import { test } from "node:test";
import assert from "node:assert/strict";
import { createContextUsageExtension, renderContextReport } from "./index.ts";

function makePi() {
  const commands = new Map<string, any>();
  return {
    commands,
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  } as any;
}

function makeCtx(branch: unknown[], usage?: unknown) {
  const notifications: Array<{ msg: string; level: string }> = [];
  return {
    model: { contextWindow: 200_000 },
    notifications,
    ui: {
      notify(msg: string, level: string) {
        notifications.push({ msg, level });
      },
    },
    getSystemPrompt: () => "system prompt and project instructions".repeat(100),
    getContextUsage: () => usage,
    sessionManager: { getBranch: () => branch },
  } as any;
}

test("/context-usage reports current token sources by branch content", async () => {
  const pi = makePi();
  createContextUsageExtension()(pi);

  const branch = [
    {
      type: "message",
      message: { role: "user", content: "Please run the tests" },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "bash",
        toolCallId: "call_bash_big",
        content: [{ type: "text", text: "npm test output\n".repeat(1000) }],
        isError: false,
      },
    },
    {
      type: "compaction",
      summary: "Earlier work summary".repeat(50),
    },
  ];
  const ctx = makeCtx(branch, {
    tokens: 20_000,
    contextWindow: 200_000,
    percent: 10,
  });

  await pi.commands.get("context-usage").handler("", ctx);

  const output = ctx.notifications.at(-1)?.msg ?? "";
  assert.match(output, /Context usage: 20\.0k \/ 200\.0k tokens · 10%/);
  assert.match(output, /Tool result: bash/);
  assert.match(output, /Largest individual tool results/);
  assert.match(output, /bash \(call_bash_big\)/);
  assert.match(output, /System prompt \+ project instructions/);
  assert.match(output, /Compaction summaries/);
  assert.match(output, /Unattributed provider\/framing overhead/);
  assert.doesNotMatch(output, /e\.g\./);
});

test("/context-usage --details includes all groups", async () => {
  const pi = makePi();
  createContextUsageExtension()(pi);
  const branch = Array.from({ length: 10 }, (_, index) => ({
    type: "custom_message",
    customType: `custom-${index}`,
    content: `custom context ${index}`.repeat(20),
    display: true,
  }));
  const ctx = makeCtx(branch);

  await pi.commands.get("context-usage").handler("--details", ctx);

  const output = ctx.notifications.at(-1)?.msg ?? "";
  assert.match(output, /Custom context: custom-0/);
  assert.match(output, /Custom context: custom-9/);
  assert.match(output, /e\.g\./);
  assert.doesNotMatch(output, /Run \/context-usage --details/);
});

test("/context-usage ranks individual tool results separately from tool groups", async () => {
  const pi = makePi();
  createContextUsageExtension()(pi);
  const branch = [
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "bash",
        toolCallId: "call_small",
        content: [{ type: "text", text: "small" }],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "bash",
        toolCallId: "call_large",
        content: [{ type: "text", text: "large output ".repeat(100) }],
      },
    },
  ];
  const ctx = makeCtx(branch);

  await pi.commands.get("context-usage").handler("--details", ctx);

  const output = ctx.notifications.at(-1)?.msg ?? "";
  assert.match(output, /Tool result: bash/);
  assert.match(output, /2 items/);
  assert.match(output, /Largest individual tool results/);
  assert.ok(
    output.indexOf("bash (call_large)") < output.indexOf("bash (call_small)"),
  );
});

test("renderContextReport falls back to estimated tokens", () => {
  const output = renderContextReport({
    estimatedTokens: 1234,
    reportedTokens: null,
    contextWindow: null,
    toolResultCalls: [],
    unattributedTokens: 0,
    sourceNote: "Local current-branch estimate only",
    groups: [
      {
        label: "User messages",
        tokens: 1234,
        count: 1,
        examples: ["hello"],
      },
    ],
  });

  assert.match(output, /Context usage: 1\.23k tokens/);
  assert.match(output, /Local current-branch estimate only/);
});
