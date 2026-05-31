import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { visibleWidth } from "@earendil-works/pi-tui";
import compactTools from "./index.ts";
import registerBash from "./bash.ts";
import registerFind from "./find.ts";
import registerGrep from "./grep.ts";
import registerLs from "./ls.ts";
import registerRead from "./read.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type RegisteredTool = {
  renderCall: (
    args: any,
    theme: typeof identityTheme,
    context: any,
  ) => {
    render: (width: number) => string[];
  };
  renderResult: (
    result: AgentToolResult<unknown>,
    options: { isPartial: boolean },
    theme: typeof identityTheme,
    context: any,
  ) => { render: (width: number) => string[] };
};

function captureTool(register: (pi: any) => void): RegisteredTool {
  let tool: RegisteredTool | undefined;
  register({
    registerTool(def: RegisteredTool) {
      tool = def;
    },
  });
  assert.ok(tool, "tool should be registered");
  return tool;
}

function renderCall(
  tool: RegisteredTool,
  args: Record<string, unknown>,
  width: number,
): string[] {
  return tool
    .renderCall(args, identityTheme, {
      cwd: "/repo",
      lastComponent: undefined,
    })
    .render(width);
}

function renderResult(
  tool: RegisteredTool,
  text: string,
  width: number,
  options: {
    args?: Record<string, unknown>;
    isError?: boolean;
    isPartial?: boolean;
  } = {},
): string[] {
  const context = {
    cwd: "/repo",
    args: options.args ?? {},
    isError: options.isError ?? false,
    state: {} as Record<string, unknown>,
    invalidate() {},
    lastComponent: undefined,
  };
  try {
    return tool
      .renderResult(
        {
          content: [{ type: "text", text }],
        } as unknown as AgentToolResult<unknown>,
        { isPartial: options.isPartial ?? false },
        identityTheme,
        context,
      )
      .render(width);
  } finally {
    const timer = context.state.renderTimer;
    if (timer) clearInterval(timer as ReturnType<typeof setInterval>);
  }
}

function assertRenderedWidth(lines: string[], width: number) {
  assert.ok(lines.length > 0, "expected visible lines");
  for (const line of lines) {
    assert.ok(
      visibleWidth(line) <= width,
      `expected line width <= ${width}, got ${visibleWidth(line)} for ${JSON.stringify(line)}`,
    );
  }
}

test("extension registers all renderer overrides after session_start", async () => {
  const registered: string[] = [];
  const handlers = new Map<string, Function>();
  let setActiveToolsCalled = false;

  compactTools({
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool(def: { name: string }) {
      registered.push(def.name);
    },
    setActiveTools() {
      setActiveToolsCalled = true;
    },
  } as any);

  await handlers.get("session_start")?.();

  assert.deepEqual(registered.sort(), ["bash", "find", "grep", "ls", "read"]);
  assert.equal(setActiveToolsCalled, false);
});

test("bash renderCall truncates long commands instead of wrapping", () => {
  const tool = captureTool(registerBash);

  const lines = renderCall(
    tool,
    { command: "printf 'abcdefghijklmnopqrstuvwxyz0123456789'" },
    18,
  );

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 18);
});

test("read error rendering truncates long messages instead of wrapping", () => {
  const tool = captureTool(registerRead);

  const lines = renderResult(
    tool,
    "ENOENT: no such file or directory, open '/repo/some/really/long/path/to/a/file.txt'",
    24,
    { args: { path: "some/really/long/path/to/a/file.txt" }, isError: true },
  );

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 24);
});

test("ls success rendering truncates each preview line instead of wrapping", () => {
  const tool = captureTool(registerLs);

  const lines = renderResult(
    tool,
    [
      "src/components/extremely-long-component-name-one.ts",
      "src/components/extremely-long-component-name-two.ts",
      "src/components/extremely-long-component-name-three.ts",
      "src/components/extremely-long-component-name-four.ts",
    ].join("\n"),
    20,
    { args: { path: "src/components" } },
  );

  assert.equal(lines.length, 4);
  assertRenderedWidth(lines, 20);
});

test("find success rendering truncates each preview line instead of wrapping", () => {
  const tool = captureTool(registerFind);

  const lines = renderResult(
    tool,
    [
      "src/routes/really-long-file-name-one.ts",
      "src/routes/really-long-file-name-two.ts",
      "src/routes/really-long-file-name-three.ts",
      "src/routes/really-long-file-name-four.ts",
    ].join("\n"),
    18,
    { args: { pattern: "*.ts", path: "src/routes" } },
  );

  assert.equal(lines.length, 4);
  assertRenderedWidth(lines, 18);
});

test("grep error rendering truncates long messages instead of wrapping", () => {
  const tool = captureTool(registerGrep);

  const lines = renderResult(
    tool,
    "rg: /repo/src/a/really/long/path/to/search: IO error for operation on /repo/src/a/really/long/path/to/search: No such file or directory (os error 2)",
    22,
    { args: { pattern: "needle", path: "src" }, isError: true },
  );

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 22);
});

test("read success renders no result body", () => {
  const tool = captureTool(registerRead);

  assert.deepEqual(
    renderResult(tool, "file contents", 80, { args: { path: "src/file.ts" } }),
    [],
  );
});

test("bash success renders the last three non-empty output lines", () => {
  const tool = captureTool(registerBash);

  assert.deepEqual(
    renderResult(tool, "one\n\ntwo\nthree\nfour", 80, {
      args: { command: "echo test" },
    }),
    ["two", "three", "four"],
  );
});

test("bash error renders the first non-empty error line", () => {
  const tool = captureTool(registerBash);

  assert.deepEqual(
    renderResult(tool, "\nfirst failure\nsecond failure", 80, {
      args: { command: "false" },
      isError: true,
    }),
    ["first failure"],
  );
});

test("bash output expands tabs before compact rendering", () => {
  const tool = captureTool(registerBash);

  assert.deepEqual(
    renderResult(tool, "     1\talpha\npath:161:\t\tenumerable: true,", 80, {
      args: { command: "nl file" },
    }),
    ["     1   alpha", "path:161:      enumerable: true,"],
  );
});

test("ls empty success renders empty", () => {
  const tool = captureTool(registerLs);

  assert.deepEqual(renderResult(tool, "", 80, { args: { path: "." } }), [
    "empty",
  ]);
});

test("ls error renders the first non-empty error line", () => {
  const tool = captureTool(registerLs);

  assert.deepEqual(
    renderResult(tool, "\npermission denied", 80, {
      args: { path: "private" },
      isError: true,
    }),
    ["permission denied"],
  );
});

test("find no-match success renders no matches", () => {
  const tool = captureTool(registerFind);

  assert.deepEqual(
    renderResult(tool, "", 80, { args: { pattern: "*.missing" } }),
    ["no matches"],
  );
});

test("find error renders the first non-empty error line", () => {
  const tool = captureTool(registerFind);

  assert.deepEqual(
    renderResult(tool, "\nfind failed", 80, {
      args: { pattern: "*.ts" },
      isError: true,
    }),
    ["find failed"],
  );
});

test("grep success renders a match count", () => {
  const tool = captureTool(registerGrep);

  assert.deepEqual(
    renderResult(tool, "a.ts:1:needle\nb.ts:2:needle", 80, {
      args: { pattern: "needle" },
    }),
    ["2 matches"],
  );
});

test("grep no-match success renders no matches", () => {
  const tool = captureTool(registerGrep);

  assert.deepEqual(
    renderResult(tool, "", 80, { args: { pattern: "needle" } }),
    ["no matches"],
  );
});

test("running renderers show compact in-progress labels", () => {
  const cases: Array<
    [string, RegisteredTool, Record<string, unknown>, RegExp]
  > = [
    [
      "read",
      captureTool(registerRead),
      { path: "src/file.ts" },
      /^Reading src\/file\.ts\.\.\.$/,
    ],
    [
      "bash",
      captureTool(registerBash),
      { command: "npm test" },
      /^Running npm test\.\.\.$/,
    ],
    ["ls", captureTool(registerLs), { path: "src" }, /^Listing src\.\.\.$/],
    [
      "find",
      captureTool(registerFind),
      { pattern: "*.ts" },
      /^Finding \*\.ts\.\.\.$/,
    ],
    [
      "grep",
      captureTool(registerGrep),
      { pattern: "needle" },
      /^Searching \/needle\/\.\.\.$/,
    ],
  ];

  for (const [name, tool, args, expected] of cases) {
    const lines = renderResult(tool, "", 80, { args, isPartial: true });
    assert.equal(lines.length, 1, name);
    assert.match(lines[0], expected, name);
  }
});
