import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import extensionDefault from "./index.ts";

const OLD_ENV = { ...process.env };

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
  const tools = new Map<string, RegisteredTool>();
  extensionDefault({
    registerTool(def: RegisteredTool) {
      tools.set(def.name, def);
    },
    registerCommand() {},
    on() {},
  } as any);
  const tool = tools.get(name);
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

afterEach(() => {
  process.env = { ...OLD_ENV };
});

test("web_search renderCall truncates long queries instead of wrapping", () => {
  const tool = loadRegisteredTool("web_search");
  const lines = tool
    .renderCall(
      {
        query:
          "an extremely long web search query that would otherwise wrap in the transcript",
        num_results: 10,
      },
      identityTheme,
      { lastComponent: undefined },
    )
    .render(32);

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 32);
});

test("web_search renderResult truncates each result line instead of wrapping", () => {
  const tool = loadRegisteredTool("web_search");
  const lines = tool
    .renderResult(
      {
        content: [
          {
            type: "text",
            text: [
              "1. First extremely long search result title that would wrap",
              "https://example.com/first/extremely/long/url",
              "2. Second extremely long search result title that would wrap",
              "3. Third extremely long search result title that would wrap",
            ].join("\n"),
          },
        ],
        details: { resultCount: 4 },
      },
      { isPartial: false },
      identityTheme,
      {
        args: { query: "example" },
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

test("web_fetch renderCall truncates long URLs instead of wrapping", () => {
  const tool = loadRegisteredTool("web_fetch");
  const lines = tool
    .renderCall(
      {
        url: "https://example.com/a/very/long/path/that/would/wrap/in/the/transcript",
        max_chars: 32000,
      },
      identityTheme,
      { lastComponent: undefined },
    )
    .render(32);

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 32);
});

test("web_fetch renderResult truncates long clone paths instead of wrapping", () => {
  const tool = loadRegisteredTool("web_fetch");
  const lines = tool
    .renderResult(
      {
        content: [{ type: "text", text: "ok" }],
        details: {
          clonePath:
            "/tmp/pi-web-access/github/example/repository/with/a/very/long/path",
        },
      },
      { isPartial: false },
      identityTheme,
      {
        args: { url: "https://github.com/example/repo" },
        isError: false,
        lastComponent: undefined,
        state: {},
        invalidate() {},
      },
    )
    .render(28);

  assert.equal(lines.length, 1);
  assertRenderedWidth(lines, 28);
});

test("/web-access-config displays effective config with masked keys", async () => {
  process.env.TAVILY_API_KEY = "tavily-secret";
  process.env.JINA_API_KEY = "jina-secret";
  const commands = new Map<string, any>();
  const notifications: Array<{ message: string; level: string }> = [];
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    on() {},
  } as any;

  extensionDefault(pi);

  assert.ok(commands.has("web-access-config"));
  await commands.get("web-access-config").handler("", {
    cwd: "/repo",
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications[0].level, "info");
  assert.match(notifications[0].message, /web-access effective config:/);
  assert.match(notifications[0].message, /"tavilyApiKey": "\*\*\*\*\*\*\*\*"/);
  assert.match(notifications[0].message, /"jinaApiKey": "\*\*\*\*\*\*\*\*"/);
  assert.doesNotMatch(notifications[0].message, /tavily-secret/);
  assert.doesNotMatch(notifications[0].message, /jina-secret/);
});
