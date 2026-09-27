import { test } from "node:test";
import assert from "node:assert/strict";
import todoExtension from "./index.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type ToolDef = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

type CommandDef = {
  description: string;
  handler: (
    args: string,
    ctx: { ui: { notify: (msg: string, level: string) => void } },
  ) => Promise<void>;
};

type EventHandler = (
  event: unknown,
  ctx: ReturnType<typeof makeCtx>,
) => Promise<void> | void;

function makeCtx(branch: unknown[] = []) {
  return {
    hasUI: true,
    sessionManager: {
      getBranch: () => branch,
    },
    ui: {
      notify: (_msg: string, _level: string) => {},
      setWidget: (
        _key: string,
        _lines:
          | string[]
          | ((
              tui: unknown,
              theme: unknown,
            ) => { render(width: number): string[] })
          | undefined,
        _options?: { placement?: string },
      ) => {},
    },
  };
}

function makePi() {
  const tools = new Map<string, ToolDef>();
  const commands = new Map<string, CommandDef>();
  const handlers = new Map<string, EventHandler>();
  const widgetCalls: Array<{
    key: string;
    lines: string[] | undefined;
    options?: { placement?: string };
    usedFactory?: boolean;
  }> = [];
  const notifications: Array<{ msg: string; level: string }> = [];

  const appendedEntries: Array<{ customType: string; data: unknown }> = [];

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
    appendEntry(customType: string, data: unknown) {
      appendedEntries.push({ customType, data });
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
        ? content({}, identityTheme).render(32)
        : content;
      widgetCalls.push({
        key,
        lines,
        options: { placement: "aboveEditor" },
        ...(usedFactory ? { usedFactory } : {}),
      });
    },
    _tools: tools,
    _commands: commands,
    _handlers: handlers,
    _widgetCalls: widgetCalls,
    _notifications: notifications,
    _appendedEntries: appendedEntries,
    _ctx(branch: unknown[] = []) {
      return {
        hasUI: true,
        sessionManager: {
          getBranch: () => branch,
        },
        ui: {
          notify(msg: string, level: string) {
            notifications.push({ msg, level });
          },
          setWidget(
            key: string,
            content:
              | string[]
              | ((
                  tui: unknown,
                  theme: unknown,
                ) => { render(width: number): string[] })
              | undefined,
            options?: { placement?: string },
          ) {
            const usedFactory = typeof content === "function";
            const lines = usedFactory
              ? content({}, identityTheme).render(32)
              : content;
            widgetCalls.push({
              key,
              lines,
              options,
              ...(usedFactory ? { usedFactory } : {}),
            });
          },
        },
      };
    },
  };

  return pi;
}

async function startSession(
  pi: ReturnType<typeof makePi>,
  branch: unknown[] = [],
) {
  const handler = pi._handlers.get("session_start");
  assert.ok(handler, "session_start handler should be registered");
  await handler!({ type: "session_start", reason: "startup" }, pi._ctx(branch));
}

async function shutdownSession(pi: ReturnType<typeof makePi>) {
  const handler = pi._handlers.get("session_shutdown");
  assert.ok(handler, "session_shutdown handler should be registered");
  await handler!({ type: "session_shutdown" }, pi._ctx());
}

test("extension registers the todo tool and /todo-clear command", () => {
  const pi = makePi();

  todoExtension(pi as any);

  assert.ok(pi._tools.has("todo"));
  assert.ok(pi._commands.has("todo-clear"));
});

test("session_start subscribes widget updates and tool mutations render aboveEditor widget", async () => {
  const pi = makePi();
  todoExtension(pi as any);
  await startSession(pi);

  const tool = pi._tools.get("todo")!;
  await tool.execute(
    "call-1",
    { action: "add", text: "Write code", notes: "index.ts" },
    undefined,
    undefined,
    undefined,
  );

  const last = pi._widgetCalls[pi._widgetCalls.length - 1];
  assert.deepEqual(last, {
    key: "todo",
    lines: ["─".repeat(32), "[ ] Write code (index.ts)"],
    options: { placement: "aboveEditor" },
    usedFactory: true,
  });
});

test("successful todo mutations append compact todo-state snapshots", async () => {
  const pi = makePi();
  todoExtension(pi as any);
  await startSession(pi);

  const tool = pi._tools.get("todo")!;
  await tool.execute(
    "call-1",
    { action: "add", text: "Write code" },
    undefined,
    undefined,
    undefined,
  );
  await tool.execute(
    "call-2",
    { action: "list" },
    undefined,
    undefined,
    undefined,
  );
  await tool.execute(
    "call-3",
    { action: "update", id: 99, status: "done" },
    undefined,
    undefined,
    undefined,
  );
  await tool.execute(
    "call-4",
    { action: "update", id: 1, status: "done" },
    undefined,
    undefined,
    undefined,
  );

  assert.deepEqual(pi._appendedEntries, [
    {
      customType: "todo-state",
      data: {
        items: [{ id: 1, text: "Write code", status: "todo" }],
        nextTodoId: 2,
      },
    },
    {
      customType: "todo-state",
      data: {
        items: [{ id: 1, text: "Write code", status: "done" }],
        nextTodoId: 2,
      },
    },
  ]);
});

test("session_start reconstructs persisted todos and preserves next ids", async () => {
  const pi = makePi();
  todoExtension(pi as any);
  await startSession(pi, [
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: {
          items: [{ id: 1, text: "Keep", status: "todo" }],
          nextTodoId: 3,
        },
      },
    },
  ]);

  const tool = pi._tools.get("todo")!;
  const result = await tool.execute(
    "call-1",
    { action: "add", text: "Third" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(
    result.content[0]?.text,
    "Current TODO list:\n1. [ ] Keep\n3. [ ] Third",
  );
});

test("/todo-clear persists an empty snapshot, hides the widget, and notifies the user", async () => {
  const pi = makePi();
  todoExtension(pi as any);
  await startSession(pi, [
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: {
          items: [{ id: 1, text: "Temp", status: "todo" }],
          nextTodoId: 2,
        },
      },
    },
  ]);

  const command = pi._commands.get("todo-clear")!;
  await command.handler("", pi._ctx());

  const last = pi._widgetCalls[pi._widgetCalls.length - 1];
  assert.deepEqual(last, {
    key: "todo",
    lines: undefined,
    options: { placement: "aboveEditor" },
  });
  assert.deepEqual(pi._appendedEntries, [
    {
      customType: "todo-state",
      data: { items: [], nextTodoId: 1 },
    },
  ]);
  assert.equal(
    pi._notifications[pi._notifications.length - 1]?.msg,
    "/todo-clear: cleared all TODO items",
  );
});

test("priority refreshes on status updates without reordering results or persistence", async () => {
  const pi = makePi();
  // Exercise the supported ctx.ui path rather than the legacy compatibility shim.
  pi.hasUI = false;
  todoExtension(pi as any);
  await startSession(pi);
  const tool = pi._tools.get("todo")!;
  const execute = (params: Record<string, unknown>) =>
    tool.execute("priority", params, undefined, undefined, undefined);
  await execute({
    action: "set",
    items: Array.from({ length: 7 }, (_, i) => ({
      text: `Task ${i + 1}`,
      status: "done",
    })),
  });
  await execute({ action: "update", id: 7, status: "in_progress" });
  assert.deepEqual(pi._widgetCalls.at(-1)?.lines?.slice(1), [
    "[~] Task 7",
    "[✓] Task 1",
    "[✓] Task 2",
    "[✓] Task 3",
    "[✓] Task 4",
    "    +0 unfinished, 2 done",
  ]);
  await execute({ action: "update", id: 6, status: "blocked" });
  await execute({ action: "update", id: 7, status: "done" });
  assert.equal(pi._widgetCalls.at(-1)?.lines?.[1], "[!] Task 6");
  const expectedText =
    "Current TODO list:\n" +
    Array.from(
      { length: 7 },
      (_, i) => `${i + 1}. ${i === 5 ? "[!]" : "[✓]"} Task ${i + 1}`,
    ).join("\n");
  assert.equal(
    (await execute({ action: "list" })).content[0]?.text,
    expectedText,
  );
  const snapshot = pi._appendedEntries.at(-1)!;
  assert.deepEqual(snapshot.data, {
    items: Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      text: `Task ${i + 1}`,
      status: i === 5 ? "blocked" : "done",
    })),
    nextTodoId: 8,
  });
  await startSession(pi, [{ type: "custom", ...snapshot }]);
  assert.equal(pi._widgetCalls.at(-1)?.lines?.[1], "[!] Task 6");
  assert.equal(
    (await execute({ action: "list" })).content[0]?.text,
    expectedText,
  );
});

test("session_shutdown unsubscribes, clears the store, and removes the widget", async () => {
  const pi = makePi();
  todoExtension(pi as any);
  await startSession(pi);

  const tool = pi._tools.get("todo")!;
  await tool.execute(
    "call-1",
    { action: "add", text: "Before shutdown" },
    undefined,
    undefined,
    undefined,
  );
  await shutdownSession(pi);

  const before = pi._widgetCalls.length;
  await tool.execute(
    "call-2",
    { action: "add", text: "After shutdown" },
    undefined,
    undefined,
    undefined,
  );

  const last = pi._widgetCalls[before - 1];
  assert.deepEqual(last, {
    key: "todo",
    lines: undefined,
    options: { placement: "aboveEditor" },
  });
  assert.equal(
    pi._widgetCalls.length,
    before,
    "no widget updates should happen after unsubscribe",
  );
});
