import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSubagentActivityTracker,
  type SubagentActivityOptions,
  type SubagentActivityTracker,
} from "./activity.ts";

type Progress = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
};

function makeTracker(overrides: Partial<SubagentActivityOptions> = {}): {
  tracker: SubagentActivityTracker;
  progress: Progress[];
} {
  const progress: Progress[] = [];
  const tracker = createSubagentActivityTracker({
    toolCallId: "call-1",
    roleLabel: "Explore agent",
    intent: "find things",
    showActivity: false,
    hasUI: false,
    onUpdate: (event) => progress.push(event),
    ...overrides,
  });
  return { tracker, progress };
}

test("initial state has starting phase and zero counters", () => {
  const { tracker } = makeTracker();
  assert.equal(tracker.state.phase, "starting");
  assert.equal(tracker.state.toolUseCount, 0);
  assert.equal(tracker.state.totalTokens, 0);
  assert.deepEqual(tracker.state.recentEvents, []);
  assert.equal(tracker.state.intent, "find things");
});

test("agent_start sets phase 'starting' and emits progress", () => {
  const { tracker, progress } = makeTracker();
  tracker.handleEvent({ type: "agent_start" });
  assert.equal(tracker.state.phase, "starting");
  assert.ok(progress.some((p) => p.content[0].text.includes("starting")));
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("tool_execution_start records activeTool, command, and phase", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent({
    type: "tool_execution_start",
    toolName: "bash",
    args: { command: "ls -la" },
  });
  assert.equal(tracker.state.activeTool, "bash");
  assert.equal(tracker.state.phase, "bash");
  assert.equal(tracker.state.currentCommand, "bash: ls -la");
  assert.equal(tracker.state.recentEvents.length, 1);
  assert.equal(tracker.state.recentEvents[0].kind, "tool");
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("tool_execution_end increments count and clears activeTool", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent({
    type: "tool_execution_start",
    toolName: "read",
    args: { path: "file.ts" },
  });
  tracker.handleEvent({
    type: "tool_execution_end",
    toolName: "read",
    result: "ok",
  });
  assert.equal(tracker.state.toolUseCount, 1);
  assert.equal(tracker.state.activeTool, undefined);
  assert.equal(tracker.state.lastToolInfo, "read: file.ts");
  assert.equal(tracker.state.currentCommand, undefined);
  assert.equal(tracker.state.lastCommand, "read: file.ts");
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("tool_execution_end with isError records recoverable tool failure", () => {
  const { tracker, progress } = makeTracker();
  tracker.handleEvent({
    type: "tool_execution_start",
    toolName: "bash",
    args: { command: "false" },
  });
  tracker.handleEvent({
    type: "tool_execution_end",
    toolName: "bash",
    isError: true,
    result: "exit 1",
  });
  assert.equal(tracker.state.phase, "bash");
  assert.equal(tracker.state.recentEvents.at(-1)?.kind, "tool");
  assert.match(tracker.state.recentEvents.at(-1)?.text ?? "", /bash failed/);
  assert.ok(progress.some((p) => /bash failed/.test(p.content[0].text)));
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
  assert.equal(tracker.state.phase, "done");
});

test("message_end with assistant role accumulates totalTokens", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: "hello",
      usage: { totalTokens: 120 },
    },
  });
  tracker.handleEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: "again",
      usage: { totalTokens: 30 },
    },
  });
  assert.equal(tracker.state.totalTokens, 150);
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("agent_end transitions to 'done' when not already errored", () => {
  const { tracker, progress } = makeTracker();
  tracker.handleEvent({
    type: "agent_end",
    messages: [
      { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    ],
  });
  assert.equal(tracker.state.phase, "done");
  assert.equal(tracker.state.lastOutput, "final answer");
  assert.ok(progress.some((p) => /done/.test(p.content[0].text)));
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("finish with failed outcome sets terminal error phase", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent({
    type: "tool_execution_start",
    toolName: "bash",
    args: { command: "x" },
  });
  tracker.handleEvent({
    type: "tool_execution_end",
    toolName: "bash",
    isError: true,
  });
  tracker.handleEvent({ type: "agent_end", messages: [] });
  assert.equal(tracker.state.phase, "done");
  tracker.finish({
    ok: false,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 1,
    signal: null,
  });
  assert.equal(tracker.state.phase, "error");
});

test("stderr event pushes to recentEvents with kind='stderr'", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent({ type: "stderr", text: "warning: something" });
  assert.equal(tracker.state.recentEvents.length, 1);
  assert.equal(tracker.state.recentEvents[0].kind, "stderr");
  assert.match(tracker.state.recentEvents[0].text, /warning/);
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("recentEvents is capped at 3 (ring buffer)", () => {
  const { tracker } = makeTracker();
  for (let i = 0; i < 5; i++) {
    tracker.handleEvent({
      type: "tool_execution_start",
      toolName: "read",
      args: { path: `file-${i}.ts` },
    });
  }
  assert.equal(tracker.state.recentEvents.length, 3);
  assert.match(tracker.state.recentEvents[2].text, /file-4\.ts/);
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("finish(ok) sets phase='done'", () => {
  const { tracker } = makeTracker();
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "final stdout",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
  assert.equal(tracker.state.phase, "done");
  assert.equal(tracker.state.lastOutput, "final stdout");
});

test("finish(aborted) sets phase='aborted' even when ok=false", () => {
  const { tracker } = makeTracker();
  tracker.finish({
    ok: false,
    aborted: true,
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: "SIGTERM",
  });
  assert.equal(tracker.state.phase, "aborted");
});

test("finish(error) captures errorMessage and logFile", () => {
  const { tracker } = makeTracker();
  tracker.finish({
    ok: false,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 1,
    signal: null,
    errorMessage: "subagent exited with code 1",
    logFile: "/tmp/subagent.log",
  });
  assert.equal(tracker.state.phase, "error");
  assert.equal(tracker.state.errorMessage, "subagent exited with code 1");
  assert.equal(tracker.state.logFile, "/tmp/subagent.log");
});

test("finish clears UI widgets when hasUI is true", () => {
  const cleared: string[] = [];
  const ui = {
    setStatus: (id: string, value: string | undefined) => {
      if (value === undefined) cleared.push(`status:${id}`);
    },
    setWidget: (id: string, value: string[] | undefined) => {
      if (value === undefined) cleared.push(`widget:${id}`);
    },
  };
  const { tracker } = makeTracker({
    showActivity: true,
    hasUI: true,
    ui,
    toolCallId: "abc",
  });
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
  assert.deepEqual(cleared.sort(), [
    "status:subagent:abc",
    "widget:subagent:abc",
  ]);
});

test("non-object events are ignored", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent(null);
  tracker.handleEvent("a string");
  tracker.handleEvent(42);
  assert.equal(tracker.state.phase, "starting");
  assert.equal(tracker.state.toolUseCount, 0);
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("message_update with thinking_delta sets phase='thinking'", () => {
  const { tracker } = makeTracker();
  tracker.handleEvent({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta" },
  });
  assert.equal(tracker.state.phase, "thinking");
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("tool args with long commands are middle-truncated in recentEvents", () => {
  const { tracker } = makeTracker();
  const longCmd = "a".repeat(200);
  tracker.handleEvent({
    type: "tool_execution_start",
    toolName: "bash",
    args: { command: longCmd },
  });
  const text = tracker.state.recentEvents[0].text;
  assert.ok(text.length < 200);
  assert.match(text, /…/);
  tracker.finish({
    ok: true,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});
