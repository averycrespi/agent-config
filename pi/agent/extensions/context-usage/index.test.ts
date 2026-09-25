import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
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

function makeCtx(branch: any[] | SessionManager, usage?: unknown) {
  const sm =
    branch instanceof SessionManager ? branch : SessionManager.inMemory();
  if (Array.isArray(branch)) {
    for (const entry of branch) {
      if (entry.type === "message") sm.appendMessage(entry.message);
      else if (entry.type === "custom_message")
        sm.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
        );
      else if (entry.type === "compaction")
        sm.appendCompaction(entry.summary, sm.getBranch()[0].id, 1000);
    }
  }
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
    sessionManager: sm,
  } as any;
}

test("/context-usage preserves Pi totals and groups projected context", async () => {
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
  assert.match(output, /Context usage: 20\.0k \/ 200\.0k tokens \(10%\)/);
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

async function report(sm: SessionManager, systemPrompt = "", usage?: unknown) {
  const pi = makePi();
  createContextUsageExtension()(pi);
  const ctx = makeCtx(sm, usage);
  ctx.getSystemPrompt = () => systemPrompt;
  await pi.commands.get("context-usage").handler("--details", ctx);
  return ctx.notifications.at(-1)?.msg ?? "";
}

const user = (content: string) => ({
  role: "user" as const,
  content,
  timestamp: 0,
});
const toolResult = (text: string) => ({
  role: "toolResult" as const,
  toolName: "bash",
  toolCallId: "call_projected",
  content: [{ type: "text" as const, text }],
  isError: false,
  timestamp: 0,
});

test("omissions remove payloads and bookkeeping does not inflate context", async () => {
  const sm = SessionManager.inMemory();
  const id = sm.appendMessage(user("OMITTED_PAYLOAD ".repeat(1000)));
  sm.appendContextEdit(id, null);
  sm.appendCustomEntry("state", { payload: "bookkeeping".repeat(1000) });
  sm.appendUsage("cache_warm", "example", "fixture", {
    input: 1000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });
  sm.appendMessage({
    role: "bashExecution",
    command: "hidden",
    output: "hidden".repeat(1000),
    excludeFromContext: true,
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 0,
  });
  const output = await report(sm);
  assert.match(output, /Context usage: 0 \/ 200\.0k tokens/);
  assert.doesNotMatch(
    output,
    /OMITTED|bookkeeping|Other context|hidden|User messages/,
  );
  sm.branch(id);
  assert.match(await report(sm), /OMITTED_PAYLOAD/);
});

test("latest replacements retain attribution and tool call identity, not raw content", async () => {
  const sm = SessionManager.inMemory();
  const id = sm.appendMessage(toolResult("RAW_OUTPUT".repeat(1000)));
  sm.appendContextEdit(id, { content: "superseded" });
  sm.appendContextEdit(id, { content: "kept" });
  const custom = sm.appendCustomMessageEntry("fixture", "RAW_CUSTOM", false);
  sm.appendContextEdit(custom, { content: "edit" });
  const output = await report(sm);
  assert.match(output, /Context usage: 2 \/ 200\.0k tokens/);
  assert.match(output, /Tool result: bash/);
  assert.match(output, /bash \(call_projected\)/);
  assert.match(output, /Custom context: fixture/);
  assert.match(output, /e\.g\. kept/);
  assert.doesNotMatch(output, /RAW_|superseded|Other context/);
  sm.appendContextEdit(id, null);
  assert.doesNotMatch(await report(sm), /Tool result: bash|call_projected/);
});

test("latest compaction replaces old history and summaries while applying retained edits", async () => {
  const sm = SessionManager.inMemory();
  sm.appendMessage(user("COMPACTED_HISTORY".repeat(1000)));
  const kept = sm.appendMessage(user("REPLACED_RECENT"));
  sm.appendCompaction("OLD_SUMMARY", kept, 1000);
  sm.appendContextEdit(kept, { content: "edited recent" });
  sm.appendCompaction("CURRENT_SUMMARY", kept, 1000);
  sm.appendMessage(toolResult("new result"));
  const output = await report(sm);
  assert.match(output, /Compaction summaries.*1 item/);
  assert.match(output, /CURRENT_SUMMARY/);
  assert.match(output, /edited recent/);
  assert.match(output, /new result/);
  assert.doesNotMatch(output, /COMPACTED_HISTORY|OLD_SUMMARY|REPLACED_RECENT/);
});

test("transcript system checkpoints and deltas count current prompt and tool schemas once", async () => {
  const sm = SessionManager.inMemory();
  const tool = (name: string, description: string) => ({
    name,
    description,
    parameters: Type.Object({}),
  });
  sm.appendMessage({
    role: "system",
    content: "",
    sections: { instructions: "old prompt" },
    toolsAdded: [tool("removed", "OLD_SCHEMA"), tool("kept", "OLD_DEFINITION")],
    timestamp: 0,
  });
  const kept = sm.appendMessage(user("hello"));
  sm.appendMessage({
    role: "system",
    content: "",
    sections: { instructions: "current prompt" },
    toolsRemoved: [{ name: "removed" }],
    toolsAdded: [tool("kept", "current schema")],
    timestamp: 0,
  });
  sm.appendCompaction("summary", kept, 100);
  sm.appendMessage({
    role: "system",
    content: "",
    sections: { extra: "new instruction" },
    toolsAdded: [tool("added", "added schema")],
    timestamp: 0,
  });
  const prompt = "current prompt\n\nnew instruction";
  const output = await report(sm, prompt);
  assert.match(
    output,
    new RegExp(
      `System prompt \\+ project instructions\\s+${Math.ceil(prompt.length / 4)}\\s+`,
    ),
  );
  assert.match(output, /System prompt \+ project instructions.*1 item/);
  assert.match(
    output,
    new RegExp(
      `Tool schema: kept\\s+${Math.ceil(JSON.stringify(tool("kept", "current schema")).length / 4)}\\s+`,
    ),
  );
  assert.match(output, /Tool schema: kept.*1 item/);
  assert.match(output, /Tool schema: added.*1 item/);
  assert.doesNotMatch(
    output,
    /Tool schema: removed|Other messages|OLD_SCHEMA|OLD_DEFINITION/,
  );
  const authoritative = await report(sm, prompt, {
    tokens: null,
    contextWindow: 1000,
  });
  assert.match(
    authoritative,
    /Pi usage unavailable; showing local effective-context estimate/,
  );
});

test("display labels and previews strip terminal controls without changing token estimates", async () => {
  const sm = SessionManager.inMemory();
  sm.appendCustomMessageEntry(
    "fixture\n\u001b[31mname",
    "\u001b]52;c;hidden\u0007safe",
    false,
  );
  sm.appendMessage({
    ...toolResult("safe\u0000 text"),
    toolName: "bash\n\u001b[31mred",
  });
  const output = await report(sm);
  assert.match(output, /Custom context: fixture name/);
  assert.match(output, /Tool result: bash red/);
  assert.match(output, /e\.g\. safe text/);
  assert.doesNotMatch(output, /[\u001b\u0000\u0007]/);
});

test("branch summaries and visible shell executions keep useful attribution", async () => {
  const sm = SessionManager.inMemory();
  const root = sm.appendMessage(user("root"));
  sm.appendMessage(user("abandoned"));
  sm.branchWithSummary(root, "branch work");
  sm.appendMessage({
    role: "bashExecution",
    command: "echo visible",
    output: "visible output",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 0,
  });
  const output = await report(sm);
  assert.match(output, /Branch summaries/);
  assert.match(output, /Shell executions/);
  assert.match(output, /visible output/);
  assert.doesNotMatch(output, /abandoned/);
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
