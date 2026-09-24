import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import compactTools from "./index.ts";
import registerBash from "./bash.ts";
import registerFind from "./find.ts";
import registerGrep from "./grep.ts";
import registerLs from "./ls.ts";
import registerRead from "./read.ts";

const theme: any = { fg: (_: string, s: string) => s, bold: (s: string) => s };
const registrations = {
  read: registerRead,
  bash: registerBash,
  ls: registerLs,
  find: registerFind,
  grep: registerGrep,
};
function capture(register: (pi: any) => void): any {
  let tool: any;
  register({
    registerTool: (t: any) => {
      tool = t;
    },
  });
  return tool;
}
test("real stock bash failures retain exit/timeout/abort distinctions without output previews", async () => {
  const tool = capture(registerBash);
  for (const [args, signal, expected] of [
    [
      { command: "printf PRIVATE_OUTPUT; exit 7" },
      undefined,
      /failed · exit 7/,
    ],
    [{ command: "sleep 2", timeout: 0.05 }, undefined, /timed out/],
    [{ command: "sleep 2" }, AbortSignal.abort(), /aborted/],
  ] as const) {
    let failure: Error | undefined;
    try {
      await tool.execute("failure-fixture", args, signal, undefined, {
        cwd: process.cwd(),
      });
    } catch (error) {
      failure = error as Error;
    }
    assert.ok(failure);
    const result = { content: [{ type: "text", text: failure.message }] };
    const context = {
      cwd: process.cwd(),
      args,
      state: {},
      isError: true,
      invalidate() {},
    };
    const row = tool
      .renderResult(
        result,
        { isPartial: false, expanded: false },
        theme,
        context,
      )
      .render(48);
    assert.equal(row.length, 1);
    assert.match(row[0], expected);
    assert.doesNotMatch(row[0], /PRIVATE_OUTPUT/);
    assert.match(
      tool
        .renderResult(
          result,
          { isPartial: false, expanded: true },
          theme,
          context,
        )
        .render(120)
        .join("\n"),
      /Command/,
    );
  }
});

test("file failures project closed stock error classes, not arbitrary diagnostics", () => {
  for (const [name, register] of Object.entries(registrations).filter(
    ([name]) => name !== "bash",
  )) {
    const tool = capture(register);
    for (const [text, expected] of [
      ["ENOENT: no such file or directory, open PRIVATE_PATH", "not found"],
      ["EACCES: permission denied PRIVATE_PATH", "permission denied"],
      ["Path not found: PRIVATE_PATH", "not found"],
      ["Operation aborted", "aborted"],
    ]) {
      const row = tool
        .renderResult(
          { content: [{ type: "text", text }] },
          { isPartial: false },
          theme,
          { cwd: process.cwd(), args: {}, state: {}, isError: true },
        )
        .render(100)[0];
      assert.match(row, new RegExp(`^${name} · failed · ${expected}`));
      assert.doesNotMatch(row, /PRIVATE_PATH/);
    }
  }
});

test("extension registers overrides once after session_start without activating tools", async () => {
  const registered: string[] = [];
  const handlers = new Map<string, Function>();
  let activated = false;
  compactTools({
    events: createEventBus(),
    getActiveTools: () => ["read"],
    getAllTools: () => registered.map((name) => ({ name })),
    on: (e: string, f: Function) => handlers.set(e, f),
    registerTool: (t: any) => registered.push(t.name),
    setActiveTools: () => {
      activated = true;
    },
  } as any);
  assert.deepEqual(registered, []);
  await handlers.get("session_start")?.({}, { cwd: "/repo" });
  await handlers.get("session_start")?.({}, { cwd: "/repo" });
  assert.deepEqual(registered.sort(), ["bash", "find", "grep", "ls", "read"]);
  assert.equal(activated, false);
});
for (const [name, register] of Object.entries(registrations)) {
  test(`${name}: contextual collapsed results, expansion, errors, partial cleanup and safe widths`, () => {
    const tool = capture(register);
    const args = {
      path: "src/世界\nfile\x1b]52;c;PRIVATE\x07.ts",
      pattern: "needle\n\x1b[2J",
      command: "echo PRIVATE_SCRIPT",
    };
    const context: any = {
      cwd: "/repo",
      args,
      state: {},
      invalidate() {},
      isError: false,
    };
    const result = {
      content: [{ type: "text", text: "PRIVATE_OUTPUT\nsecond\nthird\nlast" }],
    };
    const original = JSON.stringify(result);
    const call = tool.renderCall(args, theme, context);
    assert.equal(call.render(100).length, 1);
    assert.doesNotMatch(call.render(100).join(""), /PRIVATE/);
    const partial = tool.renderResult(
      result,
      { isPartial: true, expanded: false },
      theme,
      context,
    );
    assert.match(partial.render(120)[0], new RegExp(`^${name} · running`));
    assert.ok(context.state.renderTimer);
    context.lastComponent = partial;
    const compact = tool.renderResult(
      result,
      { isPartial: false, expanded: false },
      theme,
      context,
    );
    assert.equal(compact, partial);
    assert.equal(context.state.renderTimer, undefined);
    assert.equal(compact.render(120).length, 1);
    assert.match(compact.render(120)[0], /4 output lines/);
    assert.doesNotMatch(compact.render(120)[0], /PRIVATE_OUTPUT|second|last/);
    if (name === "read") assert.match(compact.render(120)[0], /read · read/);
    if (name === "bash")
      assert.match(compact.render(120)[0], /exited successfully/);
    for (const width of [0, 1, 12, 32, 48, 80]) {
      for (const component of [call, compact]) {
        const lines = component.render(width);
        assert.equal(lines.length, 1);
        assert.ok(visibleWidth(lines[0]) <= width);
        assert.doesNotMatch(
          stripVTControlCharacters(lines[0]),
          /[\p{Cc}\p{Cf}]/u,
        );
      }
    }
    const expanded = tool.renderResult(
      result,
      { isPartial: false, expanded: true },
      theme,
      context,
    );
    assert.match(
      expanded.render(120).join("\n"),
      /PRIVATE_OUTPUT\nsecond\nthird\nlast/,
    );
    context.isError = true;
    const error = tool.renderResult(
      result,
      { isPartial: false, expanded: false },
      theme,
      context,
    );
    assert.match(error.render(100)[0], new RegExp(`^${name} · failed`));
    assert.doesNotMatch(error.render(100)[0], /PRIVATE_OUTPUT|successfully/);
    assert.equal(JSON.stringify(result), original);
  });
}
