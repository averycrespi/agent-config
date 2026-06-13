import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import { callBrokerTool, registerTools, summarize } from "./tools.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type RegisteredTool = {
  name: string;
  renderCall: (
    args: Record<string, unknown>,
    theme: typeof identityTheme,
    context: Record<string, unknown>,
  ) => { render: (width: number) => string[] };
  renderResult: (
    result: {
      content: Array<{ type: string; text: string }>;
      details?: unknown;
    },
    options: { isPartial: boolean },
    theme: typeof identityTheme,
    context: Record<string, unknown>,
  ) => { render: (width: number) => string[] };
};

function loadRegisteredTool(name: string): RegisteredTool {
  const registered: RegisteredTool[] = [];
  registerTools(
    {
      registerTool(def: RegisteredTool) {
        registered.push(def);
      },
    } as any,
    {
      listTools: async () => [],
      callTool: async () => ({ content: [], isError: false }),
      reset() {},
      getReadOnly: () => false,
    } as any,
  );
  const tool = registered.find((t) => t.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
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

test("summarize returns just the name when description is missing", () => {
  assert.equal(
    summarize({ name: "github.create_pull_request" }),
    "github.create_pull_request",
  );
});

test("summarize joins name and first description line with an em-dash", () => {
  assert.equal(
    summarize({
      name: "github.create_pull_request",
      description: "Create a pull request",
    }),
    "github.create_pull_request — Create a pull request",
  );
});

test("summarize uses only the first non-empty line of a multi-line description", () => {
  assert.equal(
    summarize({
      name: "git.push",
      description: "\n  \nPush commits\nExtra detail below",
    }),
    "git.push — Push commits",
  );
});

test("summarize omits the dash when description is an empty string", () => {
  assert.equal(summarize({ name: "foo.bar", description: "" }), "foo.bar");
});

test("summarize omits the dash when description is whitespace-only", () => {
  assert.equal(
    summarize({ name: "foo.bar", description: "   \n  \n" }),
    "foo.bar",
  );
});

test("mcp_search renderCall truncates long queries instead of wrapping", () => {
  const tool = loadRegisteredTool("mcp_search");
  const lines = tool
    .renderCall(
      {
        query:
          "extremely long broker search query that would otherwise wrap in the transcript",
      },
      identityTheme,
      { lastComponent: undefined },
    )
    .render(30);

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 30);
});

test("mcp_describe renderCall truncates long names instead of wrapping", () => {
  const tool = loadRegisteredTool("mcp_describe");
  const lines = tool
    .renderCall(
      { name: "github.extremely_long_broker_tool_name_that_would_wrap" },
      identityTheme,
      { lastComponent: undefined },
    )
    .render(30);

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 30);
});

test("mcp_call renderCall truncates long labels instead of wrapping", () => {
  const tool = loadRegisteredTool("mcp_call");
  const lines = tool
    .renderCall(
      {
        name: "github.extremely_long_broker_tool_name_that_would_wrap",
        arguments: {
          first_extremely_long_argument_key: true,
          second_extremely_long_argument_key: true,
          third_extremely_long_argument_key: true,
        },
      },
      identityTheme,
      { lastComponent: undefined },
    )
    .render(32);

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 32);
});

test("mcp_call renderResult truncates each preview line instead of wrapping", () => {
  const tool = loadRegisteredTool("mcp_call");
  const lines = tool
    .renderResult(
      {
        content: [
          {
            type: "text",
            text: [
              "first extremely long broker result line that would wrap",
              "second extremely long broker result line that would wrap",
              "third extremely long broker result line that would wrap",
              "fourth extremely long broker result line that would wrap",
            ].join("\n"),
          },
        ],
        details: {},
      },
      { isPartial: false },
      identityTheme,
      {
        args: { name: "github.example" },
        isError: false,
        lastComponent: undefined,
        state: {},
        invalidate() {},
      },
    )
    .render(28);

  assert.equal(lines.length, 4);
  assertRenderedWidth(lines, 28);
});

// ---------------------------------------------------------------------------
// callBrokerTool — spillover integration
// ---------------------------------------------------------------------------

{
  let scratchDir: string;

  before(async () => {
    scratchDir = join(
      tmpdir(),
      `tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(scratchDir, { recursive: true });
  });

  after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  const noop = () => {};
  const makeSignal = () => new AbortController().signal;

  test("mcp_call spills oversize content", async () => {
    const bigText = "x".repeat(30_000);
    const client = {
      callTool: async () => ({
        content: [{ type: "text", text: bigText }],
        isError: false,
      }),
      reset: noop,
      listTools: async () => [],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "test.tool", arguments: {} },
      "spill-test-id",
      makeSignal(),
      scratchDir,
    );
    const details = result.details as Record<string, unknown>;
    assert.equal(details.spilled, true, "details.spilled should be true");
    assert.equal(
      typeof details.spillFilePath,
      "string",
      "spillFilePath should be a string",
    );
    assert.ok(
      (details.spillFilePath as string).startsWith(scratchDir),
      "spillFilePath should be inside scratchDir",
    );
    assert.equal(typeof details.originalSize, "number");
    const texts = result.content.filter((c: any) => c.type === "text");
    assert.equal(
      texts.length,
      1,
      "should have exactly one envelope text block",
    );
    assert.ok(
      (texts[0] as any).text.includes("<persisted-output>"),
      "content should contain envelope wrapper",
    );
    assert.ok(
      (texts[0] as any).text.includes(details.spillFilePath as string),
      "envelope should reference the spill file path",
    );
  });

  test("mcp_call passes through under-threshold content", async () => {
    const smallText = "y".repeat(5_000);
    const client = {
      callTool: async () => ({
        content: [{ type: "text", text: smallText }],
        isError: false,
      }),
      reset: noop,
      listTools: async () => [],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "test.small", arguments: {} },
      "small-test-id",
      makeSignal(),
      scratchDir,
    );
    const details = result.details as Record<string, unknown>;
    assert.ok(!("spilled" in details), "details should not contain spilled");
    assert.ok(
      !("spillFilePath" in details),
      "details should not contain spillFilePath",
    );
    assert.ok(
      !("originalSize" in details),
      "details should not contain originalSize",
    );
    assert.equal(result.content.length, 1);
    assert.equal((result.content[0] as any).text, smallText);
  });

  test("mcp_call logs broker-reported error responses", async () => {
    const client = {
      callTool: async () => ({
        content: [{ type: "text", text: "broker said no" }],
        isError: true,
      }),
      reset: noop,
      listTools: async () => [],
    };

    const result = await callBrokerTool(
      client as any,
      { name: "test.broker-error", arguments: {} },
      "broker-error-log-test-id",
      makeSignal(),
      scratchDir,
    );

    const logFile = result.details.logFile as string;
    assert.match(logFile, /broker-error-log-test-id/);
    const log = await readFile(logFile, "utf8");
    assert.match(log, /mcp_call failure for test\.broker-error/);
    assert.match(log, /broker said no/);
    await rm(logFile, { force: true });
  });

  test("mcp_call does not spill error responses", async () => {
    const bigText = "z".repeat(30_000);
    const client = {
      callTool: async () => ({
        content: [{ type: "text", text: bigText }],
        isError: true,
      }),
      reset: noop,
      listTools: async () => [],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "test.err", arguments: {} },
      "error-test-id",
      makeSignal(),
      scratchDir,
    );
    const details = result.details as Record<string, unknown>;
    assert.ok(
      !("spilled" in details),
      "error details should not contain spilled",
    );
    assert.ok(
      !("spillFilePath" in details),
      "error details should not contain spillFilePath",
    );
    // First content block is the broker error marker
    assert.ok(
      (result.content[0] as any).text.includes("[mcp_call: broker tool"),
      "first block should be error marker",
    );
    // No envelope in any block
    const hasEnvelope = result.content.some(
      (c: any) =>
        typeof c.text === "string" && c.text.includes("<persisted-output>"),
    );
    assert.ok(!hasEnvelope, "error responses should not contain envelope");
  });

  test("mcp_call logs unrecoverable call failures", async () => {
    const client = {
      callTool: async () => {
        throw new Error("network down");
      },
      reset: noop,
      listTools: async () => [],
    };

    const result = await callBrokerTool(
      client as any,
      { name: "test.failure", arguments: {} },
      "failure-log-test-id",
      makeSignal(),
      scratchDir,
    );

    assert.match(
      (result.content[0] as any).text,
      /mcp_call failed: network down/,
    );
    assert.match((result.content[0] as any).text, /Log: /);
    const logFile = result.details.logFile as string;
    const log = await readFile(logFile, "utf8");
    assert.match(log, /mcp_call failure for test\.failure/);
    assert.match(log, /network down/);
    await rm(logFile, { force: true });
  });

  test("mcp_call retry path spills oversize content", async () => {
    const bigText = "r".repeat(30_000);
    let firstCall = true;
    const client = {
      callTool: async () => {
        if (firstCall) {
          firstCall = false;
          throw new Error("session expired");
        }
        return { content: [{ type: "text", text: bigText }], isError: false };
      },
      reset: noop,
      listTools: async () => [],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "test.retry-spill", arguments: {} },
      "retry-spill-id",
      makeSignal(),
      scratchDir,
    );
    const details = result.details as Record<string, unknown>;
    assert.equal(details.retried, true, "details.retried should be true");
    assert.equal(details.spilled, true, "details.spilled should be true");
    assert.equal(
      typeof details.spillFilePath,
      "string",
      "spillFilePath should be a string",
    );
    assert.ok(
      (details.spillFilePath as string).startsWith(scratchDir),
      "spillFilePath should be inside scratchDir",
    );
    const texts = result.content.filter((c: any) => c.type === "text");
    assert.equal(
      texts.length,
      1,
      "should have exactly one envelope text block",
    );
    assert.ok(
      (texts[0] as any).text.includes("<persisted-output>"),
      "content should contain envelope wrapper",
    );
  });

  test("mcp_call retry path passes through under-threshold content", async () => {
    const smallText = "s".repeat(5_000);
    let firstCall = true;
    const client = {
      callTool: async () => {
        if (firstCall) {
          firstCall = false;
          throw new Error("session expired");
        }
        return { content: [{ type: "text", text: smallText }], isError: false };
      },
      reset: noop,
      listTools: async () => [],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "test.retry-small", arguments: {} },
      "retry-small-id",
      makeSignal(),
      scratchDir,
    );
    const details = result.details as Record<string, unknown>;
    assert.equal(details.retried, true, "details.retried should be true");
    assert.ok(!("spilled" in details), "details should not contain spilled");
    assert.ok(
      !("spillFilePath" in details),
      "details should not contain spillFilePath",
    );
    assert.ok(
      !("originalSize" in details),
      "details should not contain originalSize",
    );
    assert.equal(result.content.length, 1);
    assert.equal((result.content[0] as any).text, smallText);
  });

  test("mcp_call rejects write tool when readOnly and tool not in cached list", async () => {
    const callTool = () => {
      throw new Error("callTool must not be invoked in read-only mode");
    };
    const client = {
      callTool,
      reset: noop,
      listTools: async () => [],
      getCachedTools: () => [
        { name: "git.git_pull", annotations: { readOnlyHint: true } },
      ],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "git.git_push", arguments: {} },
      "readonly-test-id",
      makeSignal(),
      scratchDir,
      true,
    );
    const texts = result.content.filter((c: any) => c.type === "text");
    assert.equal(texts.length, 1);
    assert.equal(
      (texts[0] as any).text,
      "mcp_call: tool 'git.git_push' is not available in read-only mode",
    );
  });

  test("mcp_call checks listTools before readOnly call when cache is empty", async () => {
    const callTool = () => {
      throw new Error("callTool must not be invoked in read-only mode");
    };
    let listToolsCalls = 0;
    const client = {
      callTool,
      reset: noop,
      listTools: async () => {
        listToolsCalls += 1;
        return [{ name: "git.git_pull", annotations: { readOnlyHint: true } }];
      },
      getCachedTools: () => null,
    };
    const result = await callBrokerTool(
      client as any,
      { name: "git.git_push", arguments: {} },
      "readonly-empty-cache-test-id",
      makeSignal(),
      scratchDir,
      true,
    );
    assert.equal(listToolsCalls, 1);
    const texts = result.content.filter((c: any) => c.type === "text");
    assert.equal(texts.length, 1);
    assert.equal(
      (texts[0] as any).text,
      "mcp_call: tool 'git.git_push' is not available in read-only mode",
    );
  });

  test("mcp_call allows readOnly call after checking listTools when cache is empty", async () => {
    let callToolCalls = 0;
    let listToolsCalls = 0;
    const client = {
      callTool: async () => {
        callToolCalls += 1;
        return {
          content: [{ type: "text", text: "ok" }],
          isError: false,
        };
      },
      reset: noop,
      listTools: async () => {
        listToolsCalls += 1;
        return [{ name: "git.git_pull", annotations: { readOnlyHint: true } }];
      },
      getCachedTools: () => null,
    };
    const result = await callBrokerTool(
      client as any,
      { name: "git.git_pull", arguments: {} },
      "readonly-empty-cache-allowed-test-id",
      makeSignal(),
      scratchDir,
      true,
    );
    assert.equal(listToolsCalls, 1);
    assert.equal(callToolCalls, 1);
    assert.equal((result.content[0] as any).text, "ok");
  });

  test("mcp_call does not check listTools in normal mode when cache is empty", async () => {
    let callToolCalls = 0;
    const client = {
      callTool: async () => {
        callToolCalls += 1;
        return {
          content: [{ type: "text", text: "ok" }],
          isError: false,
        };
      },
      reset: noop,
      listTools: async () => {
        throw new Error("listTools must not be called in normal mode");
      },
      getCachedTools: () => null,
    };
    const result = await callBrokerTool(
      client as any,
      { name: "git.git_push", arguments: {} },
      "normal-empty-cache-test-id",
      makeSignal(),
      scratchDir,
      false,
    );
    assert.equal(callToolCalls, 1);
    assert.equal((result.content[0] as any).text, "ok");
  });

  test("mcp_call retry path does not spill error responses", async () => {
    const bigText = "e".repeat(30_000);
    let firstCall = true;
    const client = {
      callTool: async () => {
        if (firstCall) {
          firstCall = false;
          throw new Error("session expired");
        }
        return { content: [{ type: "text", text: bigText }], isError: true };
      },
      reset: noop,
      listTools: async () => [],
    };
    const result = await callBrokerTool(
      client as any,
      { name: "test.retry-err", arguments: {} },
      "retry-err-id",
      makeSignal(),
      scratchDir,
    );
    const details = result.details as Record<string, unknown>;
    assert.equal(details.retried, true, "details.retried should be true");
    assert.ok(
      !("spilled" in details),
      "error details should not contain spilled",
    );
    assert.ok(
      !("spillFilePath" in details),
      "error details should not contain spillFilePath",
    );
    // First content block is the broker error marker
    assert.ok(
      (result.content[0] as any).text.includes("[mcp_call: broker tool"),
      "first block should be error marker",
    );
  });
}
