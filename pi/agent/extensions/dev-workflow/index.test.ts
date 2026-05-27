import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import devWorkflow, { createDevWorkflowExtension } from "./index.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type CommandDef = {
  description?: string;
  handler: (args: string, ctx: ReturnType<typeof makeCtx>) => Promise<void>;
};

type EventHandler = (
  event: any,
  ctx: ReturnType<typeof makeCtx>,
) => Promise<any> | any;

type ToolDef = {
  name: string;
  execute?: (...args: any[]) => Promise<any>;
  renderCall?: (...args: any[]) => { render: (width: number) => string[] };
  renderResult?: (...args: any[]) => { render: (width: number) => string[] };
};

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type TestConfig = {
  autoCompactOnModeSwitch: boolean;
  autoCompactMinTokens: number;
  autoCompactOnAdvance: boolean;
  autoCompactAdvanceMinTokens: number;
  autoAdvanceEnabled: boolean;
  autoAdvanceMaxFixLoops: number;
  todoReminderEnabled: boolean;
  todoReminderTurnsSinceTodo: number;
  todoReminderTurnsBetweenReminders: number;
  planThinkingLevel: ThinkingLevel;
  executeThinkingLevel: ThinkingLevel;
  verifyThinkingLevel: ThinkingLevel;
};

const defaultTestConfig: TestConfig = {
  autoCompactOnModeSwitch: true,
  autoCompactMinTokens: 50_000,
  autoCompactOnAdvance: true,
  autoCompactAdvanceMinTokens: 30_000,
  autoAdvanceEnabled: false,
  autoAdvanceMaxFixLoops: 2,
  todoReminderEnabled: true,
  todoReminderTurnsSinceTodo: 3,
  todoReminderTurnsBetweenReminders: 3,
  planThinkingLevel: "medium",
  executeThinkingLevel: "low",
  verifyThinkingLevel: "high",
};

function createTestDevWorkflowExtension(
  config: Partial<TestConfig> = {},
): ReturnType<typeof createDevWorkflowExtension> {
  return createDevWorkflowExtension({
    loadConfig: async () => ({ ...defaultTestConfig, ...config }),
  });
}

async function waitForCompactCall(
  pi: ReturnType<typeof makePi>,
): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    if (pi._compactCalls.length > 0) return;
    await Promise.resolve();
  }
}

function makeCtx(options: {
  cwd: string;
  branch?: unknown[];
  inputResponse?: string | undefined;
  confirmResponse?: boolean;
  selectResponse?: string;
  notifications?: Array<{ msg: string; level: string }>;
  statusCalls?: Array<{ key: string; text: string | undefined }>;
  widgetCalls?: Array<{
    key: string;
    lines: string[] | undefined;
    usedFactory?: boolean;
  }>;
  inputCalls?: string[];
  selectCalls?: Array<{ title: string; options: string[] }>;
  idle?: boolean;
  hasUI?: boolean;
  usageTokens?: number | null;
  pendingMessages?: boolean;
  compactCalls?: Array<{
    customInstructions?: string;
    onComplete?: (result: any) => void;
    onError?: (error: Error) => void;
  }>;
}): any {
  return {
    hasUI: options.hasUI ?? true,
    cwd: options.cwd,
    model: undefined,
    isIdle: () => options.idle ?? true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => options.pendingMessages ?? false,
    shutdown: () => {},
    getContextUsage: () =>
      options.usageTokens === undefined
        ? undefined
        : { tokens: options.usageTokens, contextWindow: 200000, percent: null },
    compact: (compactOptions: any) => {
      options.compactCalls?.push(compactOptions);
    },
    getSystemPrompt: () => "base",
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    navigateTree: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    reload: async () => {},
    sessionManager: {
      getBranch: () => options.branch ?? [],
      getSessionFile: () => undefined,
    },
    ui: {
      notify(msg: string, level: string) {
        options.notifications?.push({ msg, level });
      },
      input: async (title: string) => {
        options.inputCalls?.push(title);
        return options.inputResponse;
      },
      select: async (title: string, selectOptions: string[]) => {
        options.selectCalls?.push({ title, options: selectOptions });
        return options.selectResponse;
      },
      confirm: async () => options.confirmResponse ?? true,
      setWidget(
        key: string,
        content:
          | string[]
          | ((
              tui: unknown,
              theme: unknown,
            ) => { render(width: number): string[] })
          | undefined,
      ) {
        const usedFactory = typeof content === "function";
        const lines = usedFactory
          ? content({}, identityTheme).render(120)
          : content;
        options.widgetCalls?.push({
          key,
          lines,
          ...(usedFactory ? { usedFactory } : {}),
        });
      },
      setStatus: (key: string, text: string | undefined) => {
        options.statusCalls?.push({ key, text });
      },
      setWorkingMessage: () => {},
      setHiddenThinkingLabel: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => undefined,
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      editor: async () => undefined,
      setEditorComponent: () => {},
      theme: {} as any,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: true }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    },
  };
}

function makePi(cwd: string) {
  const tools = new Map<string, ToolDef>();
  const commands = new Map<string, CommandDef>();
  const handlers = new Map<string, EventHandler>();
  const notifications: Array<{ msg: string; level: string }> = [];
  const widgetCalls: Array<{
    key: string;
    lines: string[] | undefined;
    usedFactory?: boolean;
  }> = [];
  const statusCalls: Array<{ key: string; text: string | undefined }> = [];
  const inputCalls: string[] = [];
  const selectCalls: Array<{ title: string; options: string[] }> = [];
  const sentUserMessages: Array<{ content: unknown; options?: unknown }> = [];
  const compactCalls: Array<{
    customInstructions?: string;
    onComplete?: (result: any) => void;
    onError?: (error: Error) => void;
  }> = [];
  const activeTools = [
    "read",
    "edit",
    "write",
    "bash",
    "todo",
    "ask_user",
    "web_search",
    "web_fetch",
    "mcp_search",
    "mcp_describe",
    "mcp_call",
    "spawn_agents",
    "ls",
    "find",
    "grep",
  ];
  const setActiveToolsCalls: string[][] = [];
  const setThinkingLevelCalls: string[] = [];
  const eventHandlers = new Map<string, Array<(data: unknown) => void>>();
  const emittedEvents: Array<{ event: string; data: unknown }> = [];
  const execCalls: Array<{
    command: string;
    args: string[];
    options?: unknown;
  }> = [];
  const execResults: Array<{
    stdout: string;
    stderr?: string;
    code: number;
    killed?: boolean;
  }> = [];
  let currentTools = [...activeTools];
  let thinkingLevel = "medium";

  const pi = {
    registerTool(def: ToolDef) {
      tools.set(def.name, def);
    },
    registerCommand(name: string, def: CommandDef) {
      commands.set(name, def);
    },
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    appendEntry: () => {},
    async exec(command: string, args: string[], options?: unknown) {
      execCalls.push({ command, args, options });
      return (
        execResults.shift() ?? {
          stdout: "",
          stderr: "",
          code: 0,
          killed: false,
        }
      );
    },
    sendUserMessage(content: unknown, options?: unknown) {
      sentUserMessages.push({ content, options });
    },
    hasUI: true,
    setWidget(
      key: string,
      content:
        | string[]
        | ((
            tui: unknown,
            theme: unknown,
          ) => { render(width: number): string[] })
        | undefined,
    ) {
      const usedFactory = typeof content === "function";
      const lines = usedFactory
        ? content({}, identityTheme).render(120)
        : content;
      widgetCalls.push({
        key,
        lines,
        ...(usedFactory ? { usedFactory } : {}),
      });
    },
    getActiveTools() {
      return [...currentTools];
    },
    getAllTools() {
      return Array.from(new Set([...activeTools, ...tools.keys()])).map(
        (name) => ({
          name,
          description: name,
          parameters: {} as any,
          sourceInfo: {} as any,
        }),
      ) as any;
    },
    setActiveTools(toolNames: string[]) {
      currentTools = [...toolNames];
      setActiveToolsCalls.push([...toolNames]);
    },
    getThinkingLevel() {
      return thinkingLevel as any;
    },
    setThinkingLevel(level: string) {
      thinkingLevel = level;
      setThinkingLevelCalls.push(level);
    },
    events: {
      on(event: string, handler: (data: unknown) => void) {
        const list = eventHandlers.get(event) ?? [];
        list.push(handler);
        eventHandlers.set(event, list);
      },
      emit(event: string, data: unknown) {
        emittedEvents.push({ event, data });
        for (const handler of eventHandlers.get(event) ?? []) handler(data);
      },
    },
    _cwd: cwd,
    _tools: tools,
    _commands: commands,
    _handlers: handlers,
    _notifications: notifications,
    _widgetCalls: widgetCalls,
    _statusCalls: statusCalls,
    _inputCalls: inputCalls,
    _selectCalls: selectCalls,
    _sentUserMessages: sentUserMessages,
    _compactCalls: compactCalls,
    _setActiveToolsCalls: setActiveToolsCalls,
    _setThinkingLevelCalls: setThinkingLevelCalls,
    _execCalls: execCalls,
    _execResults: execResults,
    _emittedEvents: emittedEvents,
    _currentTools: () => [...currentTools],
    _thinkingLevel: () => thinkingLevel,
    _ctx(
      branch: unknown[] = [],
      inputResponse?: string,
      idle = true,
      usageTokens?: number | null,
      hasUI = true,
      confirmResponse?: boolean,
      selectResponse?: string,
      pendingMessages?: boolean,
    ) {
      return makeCtx({
        cwd,
        branch,
        inputResponse,
        confirmResponse,
        selectResponse,
        notifications,
        statusCalls,
        widgetCalls,
        inputCalls,
        selectCalls,
        idle,
        hasUI,
        usageTokens,
        pendingMessages,
        compactCalls,
      });
    },
  };

  return pi;
}

async function startSession(
  pi: ReturnType<typeof makePi>,
  branch: unknown[] = [],
) {
  const handler = pi._handlers.get("session_start");
  assert.ok(handler);
  await handler({ type: "session_start", reason: "startup" }, pi._ctx(branch));
}

test("default export is the configurable dev-workflow extension", () => {
  assert.equal(typeof devWorkflow, "function");
});

test("/dev-workflow-config displays effective config", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-index-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    autoAdvanceEnabled: true,
    executeThinkingLevel: "medium",
  })(pi as any);

  await pi._commands.get("dev-workflow-config")!.handler("", pi._ctx());

  const message = pi._notifications.at(-1)?.msg;
  assert.ok(message);
  assert.match(message, /dev-workflow effective config:/);
  assert.match(message, /"autoAdvanceEnabled": true/);
  assert.match(message, /"executeThinkingLevel": "medium"/);

  await rm(cwd, { recursive: true, force: true });
});

test("/plan sends a kickoff user message, switches tools/thinking, and injects the plan contract", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-index-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands
    .get("plan")!
    .handler("Refactor auth middleware", pi._ctx());

  assert.ok(pi._tools.has("write_plan"));
  assert.ok(pi._tools.has("edit_plan"));
  assert.deepEqual(pi._currentTools(), [
    "read",
    "ls",
    "find",
    "grep",
    "todo",
    "ask_user",
    "web_search",
    "web_fetch",
    "mcp_search",
    "mcp_describe",
    "mcp_call",
    "spawn_agents",
    "write_plan",
    "edit_plan",
  ]);
  assert.equal(pi._thinkingLevel(), "medium");
  assert.equal(pi._sentUserMessages.length, 1);
  assert.match(String(pi._sentUserMessages[0]?.content), /plan mode/i);
  assert.match(
    String(pi._sentUserMessages[0]?.content),
    /start discovery now/i,
  );
  assert.match(
    String(pi._sentUserMessages[0]?.content),
    /do not write or edit a plan yet/i,
  );
  assert.match(
    String(pi._sentUserMessages[0]?.content),
    /Refactor auth middleware/,
  );
  assert.deepEqual(pi._emittedEvents.at(-1), {
    event: "dev-workflow:changed",
    data: {
      mode: "plan",
      baseThinking: "medium",
      baselineThinking: "medium",
    },
  });

  const beforeAgentStart = pi._handlers.get("before_agent_start");
  const result = await beforeAgentStart!(
    { type: "before_agent_start", prompt: "hi", systemPrompt: "base" },
    pi._ctx(),
  );
  assert.match(result.systemPrompt, /current mode: plan/i);
  assert.match(result.systemPrompt, /stop and wait for the user's answer/i);
  assert.match(result.systemPrompt, /approved the direction/i);
  assert.match(result.systemPrompt, /write_plan/i);
  assert.match(result.systemPrompt, /edit_plan/i);
  assert.match(result.systemPrompt, /\.plans\//i);

  await rm(cwd, { recursive: true, force: true });
});

test("mode thinking levels are configurable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-thinking-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    planThinkingLevel: "high",
    executeThinkingLevel: "minimal",
    verifyThinkingLevel: "xhigh",
  })(pi as any);
  await startSession(pi);

  await pi._commands.get("plan")!.handler("Plan", pi._ctx());
  assert.equal(pi._thinkingLevel(), "high");
  assert.deepEqual(pi._emittedEvents.at(-1), {
    event: "dev-workflow:changed",
    data: {
      mode: "plan",
      baseThinking: "high",
      baselineThinking: "medium",
    },
  });

  await pi._commands.get("execute")!.handler("Build", pi._ctx());
  assert.equal(pi._thinkingLevel(), "minimal");

  await pi._commands.get("verify")!.handler("Check", pi._ctx());
  assert.equal(pi._thinkingLevel(), "xhigh");

  await rm(cwd, { recursive: true, force: true });
});

test("re-entering the same mode does not reapply tools or thinking defaults", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-reenter-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands
    .get("plan")!
    .handler("Refactor auth middleware", pi._ctx());
  const beforeToolCalls = pi._setActiveToolsCalls.length;
  const beforeThinkingCalls = pi._setThinkingLevelCalls.length;

  await pi._commands
    .get("plan")!
    .handler("Clarify cookie constraints", pi._ctx());

  assert.equal(pi._setActiveToolsCalls.length, beforeToolCalls);
  assert.equal(pi._setThinkingLevelCalls.length, beforeThinkingCalls);
  assert.equal(pi._sentUserMessages.length, 2);

  await rm(cwd, { recursive: true, force: true });
});

test("session_start resets stale workflow baselines before restoring normal mode", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-baseline-reset-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands.get("plan")!.handler("Plan", pi._ctx());
  pi.setActiveTools(["read"]);
  pi.setThinkingLevel("high");

  await startSession(pi);

  assert.deepEqual(pi._currentTools(), ["read"]);
  assert.equal(pi._thinkingLevel(), "high");

  await rm(cwd, { recursive: true, force: true });
});

test("/normal restores baseline tools, clears workflow state, and does not send a kickoff message", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-normal-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands
    .get("plan")!
    .handler("Refactor auth middleware", pi._ctx());
  await pi._commands.get("normal")!.handler("", pi._ctx());

  assert.equal(pi._thinkingLevel(), "medium");
  assert.deepEqual(pi._currentTools(), [
    "read",
    "edit",
    "write",
    "bash",
    "todo",
    "ask_user",
    "web_search",
    "web_fetch",
    "mcp_search",
    "mcp_describe",
    "mcp_call",
    "spawn_agents",
    "ls",
    "find",
    "grep",
  ]);
  assert.equal(pi._widgetCalls.length, 0);
  assert.deepEqual(pi._emittedEvents.at(-1), {
    event: "dev-workflow:changed",
    data: {
      mode: "normal",
      baseThinking: undefined,
      baselineThinking: undefined,
    },
  });
  assert.equal(pi._sentUserMessages.length, 1);

  await rm(cwd, { recursive: true, force: true });
});

test("/plan with no args starts immediately without prompting", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-input-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands.get("plan")!.handler("", pi._ctx([], "ignored"));

  assert.equal(pi._inputCalls.length, 0);
  assert.equal(pi._sentUserMessages.length, 1);
  assert.match(String(pi._sentUserMessages[0]?.content), /plan mode/i);

  await rm(cwd, { recursive: true, force: true });
});

test("mode switch compacts above the default threshold before applying mode", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-precompact-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  let resolved = false;
  const transition = pi._commands
    .get("execute")!
    .handler("Implement auth middleware", pi._ctx([], undefined, true, 50000))
    .then(() => {
      resolved = true;
    });
  await waitForCompactCall(pi);

  assert.equal(pi._compactCalls.length, 1);
  assert.equal(pi._sentUserMessages.length, 0);
  assert.equal(pi._setActiveToolsCalls.length, 0);
  assert.equal(resolved, false);

  pi._compactCalls[0]!.onComplete?.({
    summary: "ok",
    firstKeptEntryId: "keep-1",
    tokensBefore: 50000,
  });
  await transition;

  assert.equal(resolved, true);
  assert.deepEqual(pi._currentTools(), [
    "read",
    "edit",
    "write",
    "bash",
    "todo",
  ]);
  assert.equal(pi._sentUserMessages.length, 1);
  assert.match(String(pi._sentUserMessages[0]?.content), /execute mode/i);

  await rm(cwd, { recursive: true, force: true });
});

test("mode switch skips pre-compaction when disabled by config", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-precompact-disabled-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    autoCompactOnModeSwitch: false,
    autoCompactMinTokens: 50_000,
  })(pi as any);
  await startSession(pi);

  await pi._commands
    .get("execute")!
    .handler("Implement auth middleware", pi._ctx([], undefined, true, 100000));

  assert.equal(pi._compactCalls.length, 0);
  assert.equal(pi._sentUserMessages.length, 1);
  assert.deepEqual(pi._currentTools(), [
    "read",
    "edit",
    "write",
    "bash",
    "todo",
  ]);

  await rm(cwd, { recursive: true, force: true });
});

test("execute and verify include workflow_advance only when auto advance is enabled", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-tools-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);

  await pi._commands.get("execute")!.handler("Implement", pi._ctx());
  assert.ok(pi._currentTools().includes("workflow_advance"));

  await pi._commands.get("verify")!.handler("Check", pi._ctx());
  assert.ok(pi._currentTools().includes("workflow_advance"));

  await rm(cwd, { recursive: true, force: true });
});

test("verify mode blocks stale edit and write tool calls at execution time", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-verify-guard-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);
  await pi._commands.get("verify")!.handler("Check", pi._ctx());

  const toolCall = pi._handlers.get("tool_call");
  assert.ok(toolCall);

  assert.deepEqual(
    await toolCall(
      { type: "tool_call", toolName: "edit", toolCallId: "call-1", input: {} },
      pi._ctx(),
    ),
    {
      block: true,
      reason: "dev-workflow: edit is not available in verify mode",
    },
  );
  assert.deepEqual(
    await toolCall(
      {
        type: "tool_call",
        toolName: "write",
        toolCallId: "call-2",
        input: {},
      },
      pi._ctx(),
    ),
    {
      block: true,
      reason: "dev-workflow: write is not available in verify mode",
    },
  );
  assert.equal(
    await toolCall(
      { type: "tool_call", toolName: "read", toolCallId: "call-3", input: {} },
      pi._ctx(),
    ),
    undefined,
  );

  await rm(cwd, { recursive: true, force: true });
});

test("mode switch skips pre-compaction below threshold or when not idle", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-precompact-skip-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands
    .get("plan")!
    .handler("Plan auth middleware", pi._ctx([], undefined, true, 49999));
  await pi._commands
    .get("execute")!
    .handler(
      "Implement auth middleware",
      pi._ctx([], undefined, false, 100000),
    );

  assert.equal(pi._compactCalls.length, 0);
  assert.equal(pi._sentUserMessages.length, 2);

  await rm(cwd, { recursive: true, force: true });
});

test("mode switch notifies and proceeds when pre-compaction fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-precompact-error-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  const transition = pi._commands
    .get("verify")!
    .handler("Check tests", pi._ctx([], undefined, true, 75000));
  await waitForCompactCall(pi);

  assert.equal(pi._compactCalls.length, 1);
  assert.equal(pi._sentUserMessages.length, 0);

  pi._compactCalls[0]!.onError?.(new Error("provider unavailable"));
  await transition;

  assert.equal(pi._sentUserMessages.length, 1);
  assert.match(String(pi._sentUserMessages[0]?.content), /verify mode/i);
  assert.deepEqual(pi._notifications.at(-1), {
    msg: "Workflow mode pre-compaction failed: provider unavailable",
    level: "error",
  });

  await rm(cwd, { recursive: true, force: true });
});

test("mode-to-mode pre-compaction summarizes the target mode", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-precompact-target-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);
  await pi._commands
    .get("plan")!
    .handler("Plan auth middleware", pi._ctx([], undefined, true, 49_999));

  const transition = pi._commands
    .get("execute")!
    .handler("Implement auth middleware", pi._ctx([], undefined, true, 75_000));
  await waitForCompactCall(pi);

  const compact = pi._handlers.get("session_before_compact");
  const result = await compact!(
    {
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "keep-1",
        tokensBefore: 75_000,
      },
      branchEntries: [],
      signal: new AbortController().signal,
    },
    pi._ctx(),
  );

  assert.match(result.compaction.summary, /Mode: execute/);
  assert.equal(result.compaction.details.devWorkflow.mode, "execute");

  pi._compactCalls[0]!.onComplete?.({
    summary: "ok",
    firstKeptEntryId: "keep-1",
    tokensBefore: 75_000,
  });
  await transition;

  await rm(cwd, { recursive: true, force: true });
});

test("mode switch respects configured pre-compaction threshold", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-precompact-threshold-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    autoCompactOnModeSwitch: true,
    autoCompactMinTokens: 100_000,
  })(pi as any);
  await startSession(pi);

  await pi._commands
    .get("execute")!
    .handler("Implement auth middleware", pi._ctx([], undefined, true, 75_000));

  assert.equal(pi._compactCalls.length, 0);
  assert.equal(pi._sentUserMessages.length, 1);

  await rm(cwd, { recursive: true, force: true });
});

test("/execute and /verify send kickoff messages with mode-specific guidance", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  await pi._commands
    .get("execute")!
    .handler("Implement auth middleware", pi._ctx());
  await pi._commands
    .get("verify")!
    .handler("Check typecheck and tests", pi._ctx());

  assert.equal(pi._sentUserMessages.length, 2);
  assert.match(String(pi._sentUserMessages[0]?.content), /execute mode/i);
  assert.match(
    String(pi._sentUserMessages[0]?.content),
    /Implement auth middleware/,
  );
  assert.match(String(pi._sentUserMessages[1]?.content), /verify mode/i);
  assert.match(
    String(pi._sentUserMessages[1]?.content),
    /Check typecheck and tests/,
  );

  await rm(cwd, { recursive: true, force: true });
});

test("execute mode injects a hidden todo reminder after configured turns without todo", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-todo-reminder-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    todoReminderTurnsSinceTodo: 2,
    todoReminderTurnsBetweenReminders: 2,
  })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const context = pi._handlers.get("context");
  const turnEnd = pi._handlers.get("turn_end");
  assert.ok(context);
  assert.ok(turnEnd);

  await turnEnd!({ type: "turn_end" }, pi._ctx());
  assert.equal(
    await context!({ type: "context", messages: [] }, pi._ctx()),
    undefined,
  );

  await turnEnd!({ type: "turn_end" }, pi._ctx());
  const branch = [
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: {
          items: [
            {
              id: 1,
              text: "Implement feature",
              status: "in_progress",
              notes: "editing index.ts",
            },
          ],
        },
      },
    },
  ];
  const result = await context!(
    { type: "context", messages: [{ role: "user", content: [] }] },
    pi._ctx(branch),
  );

  assert.equal(result.messages.length, 2);
  const reminder = result.messages[1].content[0].text;
  assert.match(reminder, /todo tool has not been used recently/i);
  assert.match(reminder, /Do not mention this reminder to the user/);
  assert.match(reminder, /Implement feature/);
  assert.match(reminder, /editing index\.ts/);

  await rm(cwd, { recursive: true, force: true });
});

test("todo reminders are execute-only, cooldown-gated, and reset by todo results", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-todo-cooldown-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    todoReminderTurnsSinceTodo: 1,
    todoReminderTurnsBetweenReminders: 2,
  })(pi as any);
  await startSession(pi);

  const context = pi._handlers.get("context")!;
  const turnEnd = pi._handlers.get("turn_end")!;
  const toolResult = pi._handlers.get("tool_result")!;

  await turnEnd({ type: "turn_end" }, pi._ctx());
  assert.equal(
    await context({ type: "context", messages: [] }, pi._ctx()),
    undefined,
  );

  await pi._commands.get("execute")!.handler("Implement", pi._ctx());
  await turnEnd({ type: "turn_end" }, pi._ctx());
  assert.equal(
    await context({ type: "context", messages: [] }, pi._ctx()),
    undefined,
  );

  await turnEnd({ type: "turn_end" }, pi._ctx());
  assert.ok(await context({ type: "context", messages: [] }, pi._ctx()));
  assert.equal(
    await context({ type: "context", messages: [] }, pi._ctx()),
    undefined,
  );

  await turnEnd({ type: "turn_end" }, pi._ctx());
  assert.equal(
    await context({ type: "context", messages: [] }, pi._ctx()),
    undefined,
  );

  await toolResult({ type: "tool_result", toolName: "todo" }, pi._ctx());
  await turnEnd({ type: "turn_end" }, pi._ctx());
  assert.equal(
    await context({ type: "context", messages: [] }, pi._ctx()),
    undefined,
  );

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance is disabled by default", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-disabled-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const beforeAgentStart = pi._handlers.get("before_agent_start");
  const promptResult = await beforeAgentStart!(
    { type: "before_agent_start", prompt: "hi", systemPrompt: "base" },
    pi._ctx(),
  );
  assert.doesNotMatch(promptResult.systemPrompt, /call workflow_advance/i);
  assert.match(promptResult.systemPrompt, /report that outcome to the user/i);

  const result = await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );

  assert.match(result.content[0].text, /disabled/i);
  assert.equal(pi._sentUserMessages.length, 1);
  assert.equal(pi._thinkingLevel(), "low");

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance compacts above advance threshold before applying target mode", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-compact-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  let resolved = false;
  const advance = pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, 30_000, true, false),
  ).then((result) => {
    resolved = true;
    return result;
  });
  await waitForCompactCall(pi);

  assert.equal(pi._compactCalls.length, 1);
  assert.equal(resolved, false);
  assert.equal(pi._thinkingLevel(), "low");
  assert.equal(pi._sentUserMessages.length, 1);

  pi._compactCalls[0]!.onComplete?.({
    summary: "ok",
    firstKeptEntryId: "keep-1",
    tokensBefore: 30_000,
  });
  const result = await advance;

  assert.equal(resolved, true);
  assert.equal(result.terminate, true);
  assert.equal(pi._thinkingLevel(), "high");
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /verify mode/i);

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance compaction summary uses the target mode", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-advance-compact-target-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const advance = pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, 35_000, true, false),
  );
  await waitForCompactCall(pi);

  const compact = pi._handlers.get("session_before_compact");
  const result = await compact!(
    {
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "keep-1",
        tokensBefore: 35_000,
      },
      branchEntries: [],
      signal: new AbortController().signal,
    },
    pi._ctx(),
  );

  assert.match(result.compaction.summary, /Mode: verify/);
  assert.equal(result.compaction.details.devWorkflow.mode, "verify");

  pi._compactCalls[0]!.onComplete?.({
    summary: "ok",
    firstKeptEntryId: "keep-1",
    tokensBefore: 35_000,
  });
  await advance;

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance skips compaction below threshold or when disabled", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-advance-compact-skip-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, 29_999, true, false),
  );

  const disabledPi = makePi(cwd);
  createTestDevWorkflowExtension({
    autoAdvanceEnabled: true,
    autoCompactOnAdvance: false,
  } as any)(disabledPi as any);
  await startSession(disabledPi);
  await disabledPi._commands
    .get("execute")!
    .handler("Implement", disabledPi._ctx());
  await disabledPi._tools.get("workflow_advance")!.execute!(
    "call-2",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    disabledPi._ctx([], undefined, true, 100_000, true, false),
  );

  assert.equal(pi._compactCalls.length, 0);
  assert.equal(disabledPi._compactCalls.length, 0);

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance notifies and continues when compaction fails", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-advance-compact-error-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const advance = pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, 30_000, true, false),
  );
  await waitForCompactCall(pi);

  pi._compactCalls[0]!.onError?.(new Error("provider unavailable"));
  const result = await advance;

  assert.equal(result.terminate, true);
  assert.equal(pi._thinkingLevel(), "high");
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /verify mode/i);
  assert.deepEqual(pi._notifications.at(-1), {
    msg: "Workflow advance pre-compaction failed: provider unavailable",
    level: "error",
  });

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance rejects execute to verify when staged or unstaged changes exist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-dirty-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());
  pi._execResults.push({
    stdout: "M  src/staged.ts\n M src/unstaged.ts\n",
    code: 0,
  });

  const result = await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );

  assert.equal(result.terminate, undefined);
  assert.match(result.content[0].text, /uncommitted changes/i);
  assert.deepEqual(pi._execCalls[0]?.args, [
    "-C",
    cwd,
    "status",
    "--porcelain=v1",
  ]);
  assert.equal(pi._thinkingLevel(), "low");
  assert.ok(pi._currentTools().includes("workflow_advance"));
  assert.equal(pi._sentUserMessages.length, 1);

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance moves execute directly to verify", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-verify-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const beforeAgentStart = pi._handlers.get("before_agent_start");
  const promptResult = await beforeAgentStart!(
    { type: "before_agent_start", prompt: "hi", systemPrompt: "base" },
    pi._ctx(),
  );
  assert.match(promptResult.systemPrompt, /call workflow_advance/i);

  const result = await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );

  assert.equal(result.terminate, true);
  assert.equal(pi._thinkingLevel(), "high");
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /verify mode/i);
  assert.match(
    String(pi._sentUserMessages.at(-1)?.content),
    /Implementation complete/,
  );
  assert.deepEqual(pi._sentUserMessages.at(-1)?.options, {
    deliverAs: "followUp",
  });
  assert.equal(pi._statusCalls.at(-1)?.text, "↻ auto 0/2");

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance advances directly without a UI prompt", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-direct-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const result = await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, undefined, "Cancel"),
  );

  assert.equal(result.terminate, true);
  assert.equal(pi._selectCalls.length, 0);
  assert.equal(pi._thinkingLevel(), "high");
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /verify mode/i);

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance advances directly without UI", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-no-ui-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Implementation complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, false, true),
  );

  assert.equal(pi._thinkingLevel(), "high");
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /verify mode/i);

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance caps verify to execute fix loops", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-cap-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({
    autoAdvanceEnabled: true,
    autoAdvanceMaxFixLoops: 1,
  })(pi as any);
  await startSession(pi);
  await pi._commands.get("verify")!.handler("Check", pi._ctx());

  const advance = pi._tools.get("workflow_advance")!;
  await advance.execute!(
    "call-1",
    { state: "execute", reason: "Fix failures" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );
  await advance.execute!(
    "call-2",
    { state: "verify", reason: "Fixes complete" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );
  const result = await advance.execute!(
    "call-3",
    { state: "execute", reason: "More fixes" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );

  assert.match(result.content[0].text, /cap reached/i);
  assert.equal(pi._thinkingLevel(), "high");
  assert.equal(pi._statusCalls.at(-1)?.text, "↻ exhausted 1/1");

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance rejects execute to completed and keeps execute mode", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-advance-execute-complete-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const result = await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "completed", reason: "Implementation done" },
    undefined,
    undefined,
    pi._ctx(),
  );

  assert.equal(result.terminate, undefined);
  assert.match(
    result.content[0].text,
    /Execute mode can only advance to Verify or aborted/i,
  );
  assert.equal(pi._thinkingLevel(), "low");
  assert.ok(pi._currentTools().includes("workflow_advance"));
  assert.equal(pi._sentUserMessages.length, 1);

  await rm(cwd, { recursive: true, force: true });
});

test("workflow_advance terminal action exits to normal and terminates", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-terminal-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("verify")!.handler("Check", pi._ctx());

  const result = await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "completed", reason: "Verification passed" },
    undefined,
    undefined,
    pi._ctx(),
  );

  assert.equal(result.terminate, true);
  assert.match(result.content[0].text, /completed/i);
  assert.equal(pi._thinkingLevel(), "medium");
  assert.deepEqual(pi._currentTools(), [
    "read",
    "edit",
    "write",
    "bash",
    "todo",
    "ask_user",
    "web_search",
    "web_fetch",
    "mcp_search",
    "mcp_describe",
    "mcp_call",
    "spawn_agents",
    "ls",
    "find",
    "grep",
  ]);
  assert.equal(pi._statusCalls.at(-1)?.text, undefined);
  assert.match(pi._notifications.at(-1)?.msg ?? "", /Workflow completed/);

  await rm(cwd, { recursive: true, force: true });
});

test("agent_end queues missing workflow_advance follow-ups in execute and verify", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-advance-fallback-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);

  const agentEnd = pi._handlers.get("agent_end")!;
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());
  await agentEnd({ type: "agent_end", messages: [] }, pi._ctx());

  assert.equal(pi._sentUserMessages.length, 2);
  assert.match(
    String(pi._sentUserMessages.at(-1)?.content),
    /stopped in Execute mode/i,
  );
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /state="verify"/);
  assert.deepEqual(pi._sentUserMessages.at(-1)?.options, {
    deliverAs: "followUp",
  });

  await pi._tools.get("workflow_advance")!.execute!(
    "call-1",
    { state: "verify", reason: "Ready for verification" },
    undefined,
    undefined,
    pi._ctx([], undefined, true, undefined, true, false),
  );
  await agentEnd({ type: "agent_end", messages: [] }, pi._ctx());

  assert.match(
    String(pi._sentUserMessages.at(-1)?.content),
    /stopped in Verify mode/i,
  );
  assert.match(String(pi._sentUserMessages.at(-1)?.content), /state="execute"/);

  await rm(cwd, { recursive: true, force: true });
});

test("agent_end skips missing workflow_advance follow-up when disabled or pending", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-advance-no-fallback-"),
  );
  const disabledPi = makePi(cwd);
  createTestDevWorkflowExtension()(disabledPi as any);
  await startSession(disabledPi);
  await disabledPi._commands
    .get("execute")!
    .handler("Implement", disabledPi._ctx());
  await disabledPi._handlers.get("agent_end")!(
    { type: "agent_end", messages: [] },
    disabledPi._ctx(),
  );
  assert.equal(disabledPi._sentUserMessages.length, 1);

  const pendingPi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(
    pendingPi as any,
  );
  await startSession(pendingPi);
  await pendingPi._commands
    .get("execute")!
    .handler("Implement", pendingPi._ctx());
  await pendingPi._handlers.get("agent_end")!(
    { type: "agent_end", messages: [] },
    pendingPi._ctx(
      [],
      undefined,
      true,
      undefined,
      true,
      undefined,
      undefined,
      true,
    ),
  );
  assert.equal(pendingPi._sentUserMessages.length, 1);

  await rm(cwd, { recursive: true, force: true });
});

test("agent_end caps missing workflow_advance follow-ups and resets after mode entry", async () => {
  const cwd = await mkdtemp(
    join(tmpdir(), "dev-workflow-advance-fallback-cap-"),
  );
  const pi = makePi(cwd);
  createTestDevWorkflowExtension({ autoAdvanceEnabled: true })(pi as any);
  await startSession(pi);
  await pi._commands.get("execute")!.handler("Implement", pi._ctx());

  const agentEnd = pi._handlers.get("agent_end")!;
  await agentEnd({ type: "agent_end", messages: [] }, pi._ctx());
  await agentEnd({ type: "agent_end", messages: [] }, pi._ctx());
  await agentEnd({ type: "agent_end", messages: [] }, pi._ctx());

  assert.equal(pi._sentUserMessages.length, 3);
  assert.match(pi._notifications.at(-1)?.msg ?? "", /fallback cap reached/i);

  await pi._commands.get("execute")!.handler("Implement again", pi._ctx());
  await agentEnd({ type: "agent_end", messages: [] }, pi._ctx());

  assert.equal(pi._sentUserMessages.length, 5);
  assert.match(
    String(pi._sentUserMessages.at(-1)?.content),
    /stopped in Execute/,
  );

  await rm(cwd, { recursive: true, force: true });
});

test("write_plan and edit_plan are scoped to .plans", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-tools-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);
  await pi._commands.get("plan")!.handler("Draft a workflow", pi._ctx());

  const writePlan = pi._tools.get("write_plan");
  const editPlan = pi._tools.get("edit_plan");
  assert.ok(writePlan?.execute);
  assert.ok(editPlan?.execute);

  const writeResult = await writePlan!.execute!(
    "call-1",
    {
      path: "auth.md",
      content: "# Workflow Brief\n\n## Goal\nRefactor auth middleware\n",
    },
    undefined,
    undefined,
    pi._ctx(),
  );

  assert.match(writeResult.content[0].text, /Successfully wrote \d+ bytes/);

  assert.equal(
    await readFile(join(cwd, ".plans/auth.md"), "utf8"),
    "# Workflow Brief\n\n## Goal\nRefactor auth middleware\n",
  );

  const editResult = await editPlan!.execute!(
    "call-2",
    {
      path: ".plans/auth.md",
      edits: [
        {
          old_text: "Refactor auth middleware",
          new_text: "Refactor auth middleware safely",
        },
      ],
    },
    undefined,
    undefined,
    pi._ctx(),
  );

  assert.match(await readFile(join(cwd, ".plans/auth.md"), "utf8"), /safely/);
  assert.match(editResult.content[0].text, /Successfully replaced 1 block/);
  assert.match(editResult.details.diff, /-4 Refactor auth middleware/);
  assert.match(editResult.details.diff, /\+4 Refactor auth middleware safely/);
  assert.equal(editResult.details.firstChangedLine, 4);

  const blocked = await writePlan!.execute!(
    "call-3",
    { path: "../README.md", content: "nope" },
    undefined,
    undefined,
    pi._ctx(),
  );
  assert.match(String(blocked.content[0]?.text), /\.plans/i);

  await rm(cwd, { recursive: true, force: true });
});

test("write_plan and edit_plan render like write and edit tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-render-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);

  const writePlan = pi._tools.get("write_plan")!;
  const editPlan = pi._tools.get("edit_plan")!;
  assert.ok(writePlan.renderCall);
  assert.ok(writePlan.renderResult);
  assert.ok(editPlan.renderCall);
  assert.ok(editPlan.renderResult);

  assert.deepEqual(
    writePlan
      .renderCall(
        { path: "auth.md", content: "# Title\n\nBody" },
        identityTheme,
        { cwd, lastComponent: undefined },
      )
      .render(120),
    ["write_plan .plans/auth.md (3 lines)"],
  );

  assert.deepEqual(
    writePlan
      .renderResult(
        { content: [{ type: "text", text: "Successfully wrote 12 bytes" }] },
        { isPartial: false },
        identityTheme,
        {
          cwd,
          args: { path: "auth.md" },
          isError: false,
          state: {},
          lastComponent: undefined,
        },
      )
      .render(120),
    ["Written"],
  );

  assert.deepEqual(
    editPlan
      .renderCall({ path: ".plans/auth.md", edits: [] }, identityTheme, {
        cwd,
        lastComponent: undefined,
      })
      .render(120),
    ["edit_plan .plans/auth.md"],
  );

  assert.deepEqual(
    editPlan
      .renderResult(
        {
          content: [{ type: "text", text: "Successfully replaced 1 block" }],
          details: { diff: " 1 one\n-2 two\n+2 three" },
        },
        { expanded: false, isPartial: false },
        identityTheme,
        {
          cwd,
          args: { path: "auth.md" },
          isError: false,
          state: {},
          lastComponent: undefined,
        },
      )
      .render(120),
    ["+1 / -1"],
  );

  assert.deepEqual(
    editPlan
      .renderResult(
        { content: [{ type: "text", text: "edit_plan: oldText must match" }] },
        { expanded: false, isPartial: false },
        identityTheme,
        {
          cwd,
          args: { path: "auth.md" },
          isError: false,
          state: {},
          lastComponent: undefined,
        },
      )
      .render(120),
    ["edit_plan: oldText must match"],
  );

  await rm(cwd, { recursive: true, force: true });
});

test("session_before_compact returns a workflow-aware summary while a mode is active", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-workflow-compact-"));
  const pi = makePi(cwd);
  createTestDevWorkflowExtension()(pi as any);
  await startSession(pi);
  await pi._commands
    .get("plan")!
    .handler("Refactor auth middleware", pi._ctx());

  const compact = pi._handlers.get("session_before_compact");
  const result = await compact!(
    {
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "keep-1",
        tokensBefore: 1234,
      },
      branchEntries: [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "todo",
            details: {
              items: [
                {
                  id: 1,
                  text: "Draft acceptance criteria",
                  status: "in_progress",
                },
              ],
              nextTodoId: 2,
            },
          },
        },
      ],
      signal: new AbortController().signal,
    },
    pi._ctx(),
  );

  assert.equal(result.compaction.firstKeptEntryId, "keep-1");
  assert.match(result.compaction.summary, /Mode: plan/);
  assert.match(result.compaction.summary, /Draft acceptance criteria/);
  assert.doesNotMatch(result.compaction.summary, /Active plan:/);

  await rm(cwd, { recursive: true, force: true });
});
