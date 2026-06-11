import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BrokerTool } from "./client.ts";
import extensionDefault, { buildBrokerPrompt } from "./index.ts";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
});

const TOOLS: BrokerTool[] = [
  { name: "github.list_pull_requests", description: "List pull requests" },
  {
    name: "github.pull_request_read",
    description: "Get information on a pull request",
  },
  { name: "git.git_push", description: "Push to a remote" },
  { name: "git.git_pull", description: "Pull from a remote" },
];

test("buildBrokerPrompt groups tools by namespace and lists names", () => {
  const prompt = buildBrokerPrompt(TOOLS);
  assert.match(prompt, /MCP broker tools/);
  assert.match(prompt, /^- git: git_pull, git_push$/m);
  assert.match(prompt, /^- github: list_pull_requests, pull_request_read$/m);
});

test("buildBrokerPrompt mentions the meta-tools and decision rules", () => {
  const prompt = buildBrokerPrompt(TOOLS);
  assert.match(prompt, /mcp_call/);
  assert.match(prompt, /mcp_describe/);
  assert.match(prompt, /mcp_search/);
  assert.match(prompt, /push\/pull\/fetch\/ls-remote\/remote/);
});

test("buildBrokerPrompt sorts namespaces and tool names alphabetically", () => {
  const shuffled: BrokerTool[] = [
    { name: "zeta.thing_b" },
    { name: "alpha.thing_a" },
    { name: "alpha.aardvark" },
    { name: "zeta.alpha" },
  ];
  const prompt = buildBrokerPrompt(shuffled);
  // alpha namespace should appear before zeta
  const alphaIdx = prompt.indexOf("- alpha:");
  const zetaIdx = prompt.indexOf("- zeta:");
  assert.ok(alphaIdx > 0 && zetaIdx > alphaIdx);
  assert.match(prompt, /^- alpha: aardvark, thing_a$/m);
  assert.match(prompt, /^- zeta: alpha, thing_b$/m);
});

test("buildBrokerPrompt includes read-only suffix when readOnly is true", () => {
  const prompt = buildBrokerPrompt(TOOLS, true);
  assert.match(
    prompt,
    /Read-only mode: only listed tools are callable\. Write tools \(create\/edit\/merge\/push\/etc\.\) are not available\./,
  );
});

test("buildBrokerPrompt omits read-only suffix when readOnly is false", () => {
  const prompt = buildBrokerPrompt(TOOLS, false);
  assert.doesNotMatch(prompt, /Read-only mode/);
});

test("buildBrokerPrompt skips tools without a namespace prefix", () => {
  const prompt = buildBrokerPrompt([
    ...TOOLS,
    { name: "no_namespace_tool", description: "ignored" },
  ]);
  assert.doesNotMatch(prompt, /no_namespace_tool/);
});

test("extension registers lifecycle and config command handlers", async () => {
  process.env.MCP_BROKER_ENDPOINT = "https://broker.example.com";
  process.env.MCP_BROKER_AUTH_TOKEN = "secret-token";
  process.env.MCP_BROKER_READONLY = "true";
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const commands = new Map<string, any>();
  const notifications: Array<{ message: string; level: string }> = [];
  const pi = {
    registerTool() {},
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
    },
    addBashGuard() {},
  } as unknown as ExtensionAPI;

  extensionDefault(pi);

  assert.ok(
    handlers.has("session_shutdown"),
    "session_shutdown handler should be registered",
  );
  assert.ok(commands.has("mcp-broker-config"));

  await commands.get("mcp-broker-config").handler("", {
    cwd: "/repo",
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications[0].level, "info");
  assert.match(notifications[0].message, /mcp-broker effective config:/);
  assert.match(notifications[0].message, /"authToken": "\*\*\*\*\*\*\*\*"/);
  assert.match(notifications[0].message, /"readOnly": true/);
  assert.doesNotMatch(notifications[0].message, /secret-token/);
});
