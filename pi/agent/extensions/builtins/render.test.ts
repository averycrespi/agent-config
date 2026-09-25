import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import builtins from "./index.ts";
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
  register({ registerTool: (t: any) => (tool = t) });
  return tool;
}
function render(
  tool: any,
  result: any,
  args: any = {},
  isError = false,
  expanded = false,
) {
  return tool
    .renderResult(result, { isPartial: false, expanded }, theme, {
      cwd: "/repo",
      args,
      state: {},
      isError,
    })
    .render(120);
}

test("calls restore the pre-CONFIG-33 builtin labels and bash command preview", () => {
  for (const [name, args, expected] of [
    ["read", { path: "src/file.ts" }, "read src/file.ts"],
    ["bash", { command: "git status -sb" }, "bash git status -sb"],
    [
      "bash",
      { command: "printf first\\nsecond\necho next" },
      "bash printf first\\nsecond ...",
    ],
    ["ls", { path: "src" }, "ls src"],
    ["find", { pattern: "*.ts", path: "src" }, "find *.ts in src"],
    [
      "grep",
      { pattern: "TODO", path: "src", glob: "*.ts" },
      "grep /TODO/ in src (*.ts)",
    ],
  ] as const) {
    const tool = capture(registrations[name]);
    assert.equal(
      tool.renderCall(args, theme, { cwd: "/repo" }).render(120)[0],
      expected,
    );
  }
});

test("read stays silent; bash tails and ls/find/grep summaries return", () => {
  const result = {
    content: [{ type: "text", text: "first\nsecond\nthird\nfourth" }],
  };
  assert.deepEqual(
    render(capture(registerRead), result, { path: "src/file.ts" }),
    [],
  );
  assert.deepEqual(
    render(capture(registerBash), result, { command: "printf text" }),
    ["second", "third", "fourth"],
  );
  assert.deepEqual(render(capture(registerLs), result), [
    "first",
    "second",
    "third",
    "... +1 more entry",
  ]);
  assert.deepEqual(render(capture(registerFind), result, { pattern: "*.ts" }), [
    "first",
    "second",
    "third",
    "... +1 more result",
  ]);
  assert.deepEqual(
    render(capture(registerGrep), result, { pattern: "first" }),
    ["4 matches"],
  );
  assert.deepEqual(
    render(capture(registerBash), { content: [{ type: "text", text: "" }] }),
    [],
  );
  assert.deepEqual(
    render(capture(registerGrep), {
      content: [{ type: "text", text: "No matches found" }],
    }),
    ["no matches"],
  );
});

test("stock bash errors restore the first nonempty line", async () => {
  const bash = capture(registerBash);
  for (const [args, signal, expected] of [
    [{ command: "printf PRIVATE_OUTPUT; exit 7" }, undefined, "PRIVATE_OUTPUT"],
    [
      { command: "sleep 2", timeout: 0.05 },
      undefined,
      "Command timed out after 0.05 seconds",
    ],
    [{ command: "sleep 2" }, AbortSignal.abort(), "Command aborted"],
  ] as const) {
    let failure: Error | undefined;
    try {
      await bash.execute("failure-fixture", args, signal, undefined, {
        cwd: process.cwd(),
      });
    } catch (error) {
      failure = error as Error;
    }
    assert.ok(failure);
    assert.deepEqual(
      render(
        bash,
        { content: [{ type: "text", text: failure.message }] },
        args,
        true,
      ),
      [expected],
    );
  }
  for (const register of [
    registerRead,
    registerLs,
    registerFind,
    registerGrep,
  ]) {
    const tool = capture(register);
    assert.deepEqual(
      render(
        tool,
        { content: [{ type: "text", text: "ENOENT: PRIVATE_PATH" }] },
        {},
        true,
      ),
      ["Failed: not found"],
    );
  }
});

test("bash failure restores one first line in both compact and expanded views", () => {
  const bash = capture(registerBash);
  const result = {
    content: [
      {
        type: "text",
        text: "first diagnostic\nsecond\nthird\nfourth\ncompiler: missing module\nCommand exited with code 2",
      },
    ],
  };
  const original = JSON.stringify(result);
  assert.deepEqual(render(bash, result, {}, true), ["first diagnostic"]);
  assert.deepEqual(render(bash, result, {}, true, true), ["first diagnostic"]);
  assert.deepEqual(render(bash, result, {}, false, true), [
    "fourth",
    "compiler: missing module",
    "Command exited with code 2",
  ]);
  assert.equal(JSON.stringify(result), original);
});

test("non-Bash builtin expansions retain evidence with redaction and explicit display limits", () => {
  for (const register of [
    registerRead,
    registerLs,
    registerFind,
    registerGrep,
  ]) {
    const tool = capture(register);
    const result = {
      content: [{ type: "text", text: "first\ntoken=abc123\nlast\x1b[2J" }],
      details: {
        truncation: { truncated: true },
        fullOutputPath: "/tmp/full-output.txt",
      },
    };
    for (const isError of [false, true]) {
      const lines = render(tool, result, {}, isError, true);
      assert.ok(lines.includes("first"));
      assert.ok(lines.includes("token=[redacted]"));
      assert.match(lines.join("\n"), /Output truncated/);
      assert.match(lines.join("\n"), /Full output: \/tmp\/full-output.txt/);
      assert.doesNotMatch(lines.join("\n"), /abc123|\x1b/);
      for (const width of [0, 1, 12, 48]) {
        const rows = tool
          .renderResult(result, { expanded: true, isPartial: false }, theme, {
            cwd: "/repo",
            args: {},
            state: {},
            isError,
          })
          .render(width);
        assert.ok(rows.every((row: string) => visibleWidth(row) <= width));
      }
    }
    const bounded = render(
      tool,
      { content: [{ type: "text", text: "line\n".repeat(2200) }] },
      {},
      false,
      true,
    );
    assert.ok(bounded.length <= 2002);
    assert.match(bounded.join("\n"), /Display truncated/);
  }
});

test("labels and previews remove terminal controls and known credential shapes before styling", () => {
  const bash = capture(registerBash);
  const args = {
    command:
      "curl -H 'Authorization: Bearer abc-secret'\necho next\x1b]52;c;PRIVATE\x07",
  };
  const call = bash.renderCall(args, theme, { cwd: "/repo" }).render(200)[0];
  assert.match(call, /^bash curl/);
  assert.doesNotMatch(call, /abc-secret|PRIVATE|[\p{Cc}\p{Cf}]/u);
  const output = render(
    bash,
    { content: [{ type: "text", text: "token=abc123\nnext\x1b[2J" }] },
    args,
  );
  assert.deepEqual(output, ["token=[redacted]", "next"]);
  const original = {
    content: [{ type: "text", text: "actual output remains intact" }],
  };
  render(bash, original, args);
  assert.equal(original.content[0].text, "actual output remains intact");
  for (const width of [0, 1, 12, 32, 48, 80]) {
    assert.ok(
      visibleWidth(
        bash.renderCall(args, theme, { cwd: "/repo" }).render(width)[0],
      ) <= width,
    );
    for (const row of bash
      .renderResult(
        { content: [{ type: "text", text: "a\nb\nc\nd" }] },
        { isPartial: false },
        theme,
        { cwd: "/repo", args, state: {} },
      )
      .render(width)) {
      assert.ok(visibleWidth(row) <= width);
      assert.doesNotMatch(stripVTControlCharacters(row), /[\p{Cc}\p{Cf}]/u);
    }
  }
});

for (const [name, register] of Object.entries(registrations)) {
  test(`${name}: partial progress is tool-specific and clears its timer on settlement`, () => {
    const tool = capture(register);
    const args = { path: "src", pattern: "TODO", command: "echo ok" };
    const context: any = {
      cwd: "/repo",
      args,
      state: {},
      invalidate() {},
      isError: false,
    };
    const result = { content: [{ type: "text", text: "output" }] };
    const partial = tool.renderResult(
      result,
      { isPartial: true },
      theme,
      context,
    );
    assert.match(
      partial.render(120)[0],
      /^(Reading|Running|Listing|Finding|Searching) /,
    );
    assert.ok(context.state.renderTimer);
    context.lastComponent = partial;
    const settled = tool.renderResult(
      result,
      { isPartial: false },
      theme,
      context,
    );
    assert.equal(settled, partial);
    assert.equal(context.state.renderTimer, undefined);
  });
}

test("extension registers overrides once after session_start without activating tools", async () => {
  const registered: string[] = [];
  const handlers = new Map<string, Function>();
  let activated = false;
  builtins({
    events: createEventBus(),
    getActiveTools: () => ["read"],
    getAllTools: () => registered.map((name) => ({ name })),
    on: (e: string, f: Function) => handlers.set(e, f),
    registerTool: (t: any) => registered.push(t.name),
    setActiveTools: () => (activated = true),
  } as any);
  assert.deepEqual(registered, []);
  await handlers.get("session_start")?.({}, { cwd: "/repo" });
  await handlers.get("session_start")?.({}, { cwd: "/repo" });
  assert.deepEqual(registered.sort(), ["bash", "find", "grep", "ls", "read"]);
  assert.equal(activated, false);
});
