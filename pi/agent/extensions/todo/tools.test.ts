import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTodoTool } from "./tools.ts";
import { createTodoStore } from "./state.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type Renderable = { render(width: number): string[] };

type ToolDef = {
  name: string;
  parameters: Record<string, any>;
  promptGuidelines?: string[];
  renderCall: (
    args: Record<string, unknown>,
    theme: typeof identityTheme,
    context: unknown,
  ) => Renderable;
  renderResult: (
    result: {
      content: Array<{ type: string; text: string }>;
      details?: unknown;
    },
    options: { isPartial: boolean },
    theme: typeof identityTheme,
    context: {
      args: Record<string, unknown>;
      isError?: boolean;
      lastComponent?: unknown;
    },
  ) => Renderable;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: unknown;
  }>;
};

function loadTool() {
  const registered: ToolDef[] = [];
  const pi = {
    registerTool(def: ToolDef) {
      registered.push(def);
    },
  };

  const store = createTodoStore();
  registerTodoTool(pi as any, store);

  assert.equal(registered.length, 1);
  assert.equal(registered[0]?.name, "todo");

  return { tool: registered[0]!, store };
}

async function exec(params: Record<string, unknown>) {
  const { tool, store } = loadTool();
  const result = await tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    undefined,
  );
  return { result, store };
}

test("schema exposes action and status string enums", () => {
  const { tool } = loadTool();

  assert.deepEqual(tool.parameters.properties.action.enum, [
    "list",
    "set",
    "add",
    "update",
    "remove",
    "clear",
  ]);
  assert.deepEqual(tool.parameters.properties.status.enum, [
    "todo",
    "in_progress",
    "done",
    "blocked",
  ]);
  assert.deepEqual(
    tool.parameters.properties.items.items.properties.status.enum,
    ["todo", "in_progress", "done", "blocked"],
  );
  assert.ok(
    tool.promptGuidelines?.some(
      (line) =>
        line.includes("todo status values are exactly") &&
        line.includes("pending") &&
        line.includes("not_started"),
    ),
  );
});

test("renderCall summarizes todo actions without dumping JSON args", () => {
  const { tool } = loadTool();

  const lines = tool
    .renderCall(
      {
        action: "set",
        items: [
          { text: "Plan", status: "todo" },
          { text: "Ship", status: "done", notes: "merged" },
        ],
      },
      identityTheme,
      {},
    )
    .render(80);

  assert.deepEqual(lines, ["todo set 2 items"]);
});

test("renderResult keeps todo errors to one concise line", () => {
  const { tool, store } = loadTool();
  store.add("Existing");

  const result = {
    content: [
      {
        type: "text",
        text: "Error: set items must include non-empty text.\nCurrent TODO list:\n1. [ ] Existing",
      },
    ],
    details: store.getState(),
  };

  const lines = tool
    .renderResult(result, { isPartial: false }, identityTheme, {
      args: { action: "set" },
      lastComponent: undefined,
    })
    .render(80);

  assert.deepEqual(lines, ["todo set · request failed"]);
  assert.deepEqual(result.details, {
    items: [{ id: 1, text: "Existing", status: "todo" }],
    nextTodoId: 2,
  });
});

test("list returns the current formatted todo list", async () => {
  const { tool, store } = loadTool();
  store.add("Inspect repo");
  store.add("Implement feature", "in_progress", "editing tools.ts");

  const result = await tool.execute(
    "call-1",
    { action: "list" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(
    result.content[0]?.text,
    "Current TODO list:\n1. [ ] Inspect repo\n2. [~] Implement feature · editing tools.ts",
  );
});

test("mutating actions include nextTodoId in persisted details", async () => {
  const { tool } = loadTool();

  const result = await tool.execute(
    "call-1",
    { action: "add", text: "Persist me" },
    undefined,
    undefined,
    undefined,
  );

  assert.deepEqual(result.details, {
    items: [{ id: 1, text: "Persist me", status: "todo" }],
    nextTodoId: 2,
  });
});

test("set replaces the current list and restarts ids at 1", async () => {
  const { tool, store } = loadTool();
  store.add("Old item");

  const result = await tool.execute(
    "call-1",
    {
      action: "set",
      items: [
        { text: "Plan", status: "todo" },
        { text: "Ship", status: "done", notes: "merged" },
      ],
    },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(
    result.content[0]?.text,
    "Current TODO list:\n1. [ ] Plan\n2. [✓] Ship · merged",
  );
  assert.deepEqual(store.list(), [
    { id: 1, text: "Plan", status: "todo" },
    { id: 2, text: "Ship", status: "done", notes: "merged" },
  ]);
});

test("add requires text", async () => {
  const { result, store } = await exec({ action: "add" });

  assert.equal(
    result.content[0]?.text,
    "Error: text is required for action add.",
  );
  assert.deepEqual(store.list(), []);
});

test("update requires id", async () => {
  const { result } = await exec({ action: "update", text: "Rename" });

  assert.equal(
    result.content[0]?.text,
    "Error: id is required for action update.",
  );
});

test("update rejects unknown ids", async () => {
  const { result } = await exec({ action: "update", id: 99, status: "done" });

  assert.equal(result.content[0]?.text, "Error: TODO #99 not found.");
});

test("update patches an existing item", async () => {
  const { tool, store } = loadTool();
  store.add("Draft design", "in_progress", "thinking");

  const result = await tool.execute(
    "call-1",
    { action: "update", id: 1, status: "blocked", notes: "waiting on input" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(
    result.content[0]?.text,
    "Current TODO list:\n1. [!] Draft design · waiting on input",
  );
  assert.deepEqual(store.list(), [
    {
      id: 1,
      text: "Draft design",
      status: "blocked",
      notes: "waiting on input",
    },
  ]);
});

test("remove requires id and deletes existing items", async () => {
  const { tool, store } = loadTool();
  store.add("Keep");
  store.add("Remove");

  const missingId = await tool.execute(
    "call-1",
    { action: "remove" },
    undefined,
    undefined,
    undefined,
  );
  const removed = await tool.execute(
    "call-2",
    { action: "remove", id: 2 },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(
    missingId.content[0]?.text,
    "Error: id is required for action remove.",
  );
  assert.equal(removed.content[0]?.text, "Current TODO list:\n1. [ ] Keep");
  assert.deepEqual(store.list(), [{ id: 1, text: "Keep", status: "todo" }]);
});

test("clear removes all items", async () => {
  const { tool, store } = loadTool();
  store.add("Temp");

  const result = await tool.execute(
    "call-1",
    { action: "clear" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(result.content[0]?.text, "Current TODO list:\n(no TODO items)");
  assert.deepEqual(store.list(), []);
});

test("invalid status is reported as a readable tool error", async () => {
  const { result, store } = await exec({
    action: "add",
    text: "Bad",
    status: "oops",
  });

  assert.equal(result.content[0]?.text, 'Error: invalid status "oops".');
  assert.deepEqual(store.list(), []);
});

test("malformed set items leave the current list unchanged", async () => {
  const { tool, store } = loadTool();
  store.add("Existing");

  const result = await tool.execute(
    "call-1",
    {
      action: "set",
      items: [{ text: "   " }],
    },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(
    result.content[0]?.text,
    "Error: set items must include non-empty text.",
  );
  assert.deepEqual(store.list(), [{ id: 1, text: "Existing", status: "todo" }]);
});
