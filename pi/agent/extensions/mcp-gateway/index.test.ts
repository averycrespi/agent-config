import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { fixture, TEST_BEARER } from "./fixture.ts";

const path = fileURLToPath(new URL("./index.ts", import.meta.url));

test("real Pi loader exposes gateway tools by default at session startup and shutdown cancels them", async (t) => {
  const f = await fixture(t);
  const previous = { ...process.env };
  t.after(() => {
    process.env = previous;
  });
  process.env.MCP_GATEWAY_ENDPOINT = f.config.endpoint;
  process.env.MCP_GATEWAY_AGENT_TOKEN = TEST_BEARER;
  process.env.MCP_GATEWAY_READONLY = "0";
  const loaded = await discoverAndLoadExtensions([path], f.dir, f.dir);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 0);
  assert.ok(extension.commands.has("mcp-gateway-config"));
  const notifications: string[] = [];
  await extension.commands.get("mcp-gateway-config")!.handler("", {
    cwd: f.dir,
    ui: { notify: (text: string) => notifications.push(text) },
  } as any);
  assert.match(notifications.join("\n"), /"agentToken": "\*{8}"/);
  assert.doesNotMatch(notifications.join("\n"), new RegExp(TEST_BEARER));
  const ctx: any = { cwd: f.dir, hasUI: false };
  const start = async () => {
    for (const handler of extension.handlers.get("session_start") ?? [])
      await (handler as any)({ reason: "startup" }, ctx);
  };
  assert.equal(f.requests.length, 0);
  assert.equal(extension.flags.size, 0);
  loaded.runtime.getAllTools = () => [];
  let refreshed = 0;
  loaded.runtime.refreshTools = () => {
    refreshed++;
  };
  await start();
  assert.deepEqual(
    [...extension.tools.keys()],
    ["mcp_search", "mcp_describe", "mcp_call"],
  );
  assert.equal(refreshed, 3);
  await start();
  assert.equal(refreshed, 3);
  const search = extension.tools.get("mcp_search")!.definition;
  const result = await search.execute(
    "search",
    { query: "lookup" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((result.details as any).matchCount, 1);
  const before = extension.handlers.get("before_agent_start")![0] as any;
  const prompt = await before({ systemPrompt: "base" }, ctx);
  assert.match(prompt.systemPrompt, /example: 1 tools/);
  assert.doesNotMatch(prompt.systemPrompt, /example.lookup|mgw_agent_/);
  const rotated = `mgw_agent_${Buffer.alloc(32, 2).toString("base64url")}`;
  process.env.MCP_GATEWAY_AGENT_TOKEN = rotated;
  await before({ systemPrompt: "base" }, ctx);
  assert.equal(f.headers.at(-1)!.authorization, `Bearer ${rotated}`);
  for (const handler of extension.handlers.get("session_shutdown") ?? [])
    await (handler as any)({ reason: "quit" }, ctx);
  const beforeCount = f.requests.length;
  const closed = await search.execute(
    "closed",
    { query: "" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((closed.details as any).gatewayError, true);
  assert.equal(f.requests.length, beforeCount);
});

test("gateway does not replace another extension's meta-tools when loaded together", async (t) => {
  const f = await fixture(t);
  const loaded = await discoverAndLoadExtensions([path], f.dir, f.dir);
  const extension = loaded.extensions[0];
  loaded.runtime.getAllTools = () => [{ name: "mcp_call" }] as any;
  const start = extension.handlers.get("session_start")![0] as any;
  await assert.rejects(
    start({}, { cwd: f.dir, hasUI: false }),
    /without other MCP meta-tools/,
  );
  assert.equal(extension.tools.size, 0);
  assert.equal(f.requests.length, 0);
});

for (const mode of ["missing", "invalid", "unavailable"] as const) {
  test(`default startup remains usable with ${mode} gateway configuration`, async (t) => {
    const f = await fixture(t);
    const previous = { ...process.env };
    t.after(() => {
      process.env = previous;
    });
    process.env.MCP_GATEWAY_ENDPOINT =
      mode === "invalid" ? "not-a-url" : f.config.endpoint;
    process.env.MCP_GATEWAY_AGENT_TOKEN = mode === "missing" ? "" : TEST_BEARER;
    if (mode === "unavailable")
      f.state.handler = (_body, response) => {
        response.writeHead(503);
        response.end();
      };
    const loaded = await discoverAndLoadExtensions([path], f.dir, f.dir);
    assert.deepEqual(loaded.errors, []);
    loaded.runtime.getAllTools = () => [];
    loaded.runtime.refreshTools = () => {};
    const extension = loaded.extensions[0];
    const ctx: any = { cwd: f.dir, hasUI: false };
    for (const handler of extension.handlers.get("session_start") ?? [])
      await (handler as any)({ reason: "startup" }, ctx);
    assert.deepEqual(
      [...extension.tools.keys()],
      ["mcp_search", "mcp_describe", "mcp_call"],
    );
    const result = await extension.tools
      .get("mcp_search")!
      .definition.execute("failure", { query: "" }, undefined, undefined, ctx);
    assert.equal((result.details as any).gatewayError, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_BEARER));
    for (const handler of extension.handlers.get("session_shutdown") ?? [])
      await (handler as any)({ reason: "quit" }, ctx);
  });
}
