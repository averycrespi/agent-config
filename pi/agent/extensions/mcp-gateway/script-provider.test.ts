import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { fixture as scriptFixture } from "../script/fixture.ts";
import { describeScriptProviders } from "../script/api.ts";
import { fixture, tool, reply, rpcError, TEST_BEARER } from "./fixture.ts";
import { registerGatewayScriptProvider } from "./script-provider.ts";

async function setup(t: Parameters<typeof fixture>[0]) {
  const s = await scriptFixture(t);
  const f = await fixture(t);
  await s.config({ allowedProviders: ["mcp"] });
  const dispose = registerGatewayScriptProvider(s.pi, f.client, () => true);
  t.after(dispose);
  return {
    ...f,
    s,
    run: (source: string) => s.run(source, { providers: ["mcp"] }),
  };
}

test("actual child preserves the complete direct-client envelope and redaction", async (t) => {
  const f = await setup(t);
  const envelope = {
    content: [
      { type: "text", text: '{"keep":"text"}' },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    structuredContent: { answer: 42, token: TEST_BEARER },
    isError: false,
    _meta: { token: TEST_BEARER },
    extra: [1, "opaque"],
  };
  f.state.handler = (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list" ? { tools: [tool()] } : envelope,
    );
  const direct = await f.client.callTool("example.lookup", {});
  const r = await f.run('return await mcp.call("example.lookup", {});');
  assert.equal(r.status, "success");
  assert.deepEqual(JSON.parse(r.json!), direct);
  assert.equal((direct.content[0] as any).text, '{"keep":"text"}');
  assert.doesNotMatch(JSON.stringify(r), new RegExp(TEST_BEARER));
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 2);
  const d = await describeScriptProviders(f.s.pi, f.s.dir, ["mcp"]);
  assert.equal(d[0].methods[0].name, "call");
});

test("explicit selection, host ceiling, positional schema and catalog admission prevent calls", async (t) => {
  const f = await setup(t);
  assert.equal(
    (await f.s.run("return typeof mcp;", { providers: [] })).json,
    '"undefined"',
  );
  assert.equal(
    (
      await f.s.run("return null;", {
        providers: ["mcp"],
        capabilityCeiling: [],
      })
    ).code,
    "capability_denied",
  );
  const positional = await f.run(
    'try { await mcp.call("example.lookup", []); } catch {} return null;',
  );
  assert.equal(positional.traces[0].code, "invalid_arguments");
  assert.equal(positional.traces[0].dispatched, false);
  for (const [source, code] of [
    ['mcp.call("missing.lookup", {})', "unknown_tool"],
    ['mcp.call("example.lookup", {query: 1})', "invalid_arguments"],
  ]) {
    const r = await f.run(
      `try { await ${source}; } catch (e) { return e.code; }`,
    );
    assert.equal(r.code, "nested_call_failed");
    assert.equal(r.traces[0].code, code);
    assert.equal(r.json, JSON.stringify(code));
    assert.equal(r.outcomeUnknown, false);
  }
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 0);
});

test("safe gateway rejection survives guest catches; no guidance or approval/replay calls", async (t) => {
  const f = await setup(t);
  for (const reason of ["deny", "block", "authorization_unavailable"]) {
    f.state.handler = (body, response) =>
      body.method === "tools/list"
        ? reply(response, body, { tools: [tool()] })
        : rpcError(
            response,
            body,
            "call_rejected",
            { reason },
            "PRIVATE_GUIDANCE request a grant and replay",
          );
    const r = await f.run(
      'try { await mcp.call("example.lookup", {}); } catch (e) { return {code:e.code, outcomeUnknown:e.outcomeUnknown}; }',
    );
    assert.equal(r.status, "failed");
    assert.equal(r.traces[0].code, "call_rejected");
    assert.equal(r.outcomeUnknown, false);
    assert.equal(r.partialExecution, true);
    assert.deepEqual(JSON.parse(r.json!), {
      code: "call_rejected",
      outcomeUnknown: false,
    });
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE_GUIDANCE|request a grant/);
  }
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 3);
  assert.ok(
    f.requests.every(
      (r) => r.method !== "tools/call" || r.params.name === "example.lookup",
    ),
  );
});

test("raw isError and uncertain failures cannot be hidden after an earlier successful effect", async (t) => {
  const f = await setup(t);
  for (const mode of ["isError", "unknown", "transport", "oversized"]) {
    let calls = 0;
    f.state.handler = (body, response) => {
      if (body.method === "tools/list")
        return reply(response, body, { tools: [tool()] });
      calls++;
      if (calls === 1)
        return reply(response, body, {
          content: [],
          structuredContent: { written: true },
        });
      if (mode === "unknown")
        return rpcError(response, body, "outcome_unknown", {
          outcomeUnknown: true,
        });
      if (mode === "transport") {
        response.destroy();
        return;
      }
      if (mode === "oversized")
        return reply(response, body, {
          content: [{ type: "text", text: "x".repeat(16 * 1024 * 1024) }],
        });
      reply(response, body, {
        content: [{ type: "text", text: "failure" }],
        isError: true,
        _meta: { preserved: true },
      });
    };
    const r = await f.run(
      'await mcp.call("example.lookup", {}); try { return await mcp.call("example.lookup", {}); } catch { return null; }',
    );
    assert.equal(r.status, "failed", mode);
    assert.equal(r.partialExecution, true);
    assert.equal(r.effectsMayPersist, true);
    assert.equal(r.outcomeUnknown, mode !== "isError");
    assert.equal(calls, 2);
    if (mode === "isError")
      assert.equal(JSON.parse(r.json!)._meta.preserved, true);
    if (mode === "oversized") assert.equal(r.traces[1].code, "resource_limit");
  }
});

test("read-only and unsupported schemas reject before invocation", async (t) => {
  const f = await setup(t);
  f.client.configure({ ...f.config, readOnly: true });
  const remove = registerGatewayScriptProvider(f.s.pi, f.client, () => true);
  t.after(remove);
  f.state.handler = (body, response) =>
    reply(response, body, { tools: [tool("example.write", false)] });
  const r = await f.run(
    'try { await mcp.call("example.write", {}); } catch {} return null;',
  );
  assert.equal(r.traces[0].code, "read_only_rejected");
  f.state.handler = (body, response) =>
    reply(response, body, {
      tools: [
        { ...tool(), inputSchema: { type: "object", unknownKeyword: true } },
      ],
    });
  assert.equal(
    (
      await f.run(
        'try { await mcp.call("example.lookup", {}); } catch {} return null;',
      )
    ).traces[0].code,
    "unsupported_schema",
  );
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 0);
});

test("gateway per-call deadline still bounds a longer script and never retries", async (t) => {
  const f = await setup(t);
  f.client.configure({ ...f.config, callTimeoutMs: 100 });
  const dispose = registerGatewayScriptProvider(f.s.pi, f.client, () => true);
  t.after(dispose);
  f.state.handler = (body, response) => {
    if (body.method === "tools/list")
      reply(response, body, { tools: [tool()] });
  };
  const r = await f.run(
    'try { await mcp.call("example.lookup", {}); } catch (e) { return e.code; }',
  );
  assert.equal(r.status, "failed");
  assert.equal(r.json, '"cancelled"');
  assert.equal(r.outcomeUnknown, true);
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 1);
});

for (const mode of ["rotation", "close", "cancel", "deadline"] as const) {
  test(`actual child ${mode} stops pending work without replay or adopting new credentials`, async (t) => {
    const f = await setup(t);
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.state.handler = (body, response) => {
      if (body.method === "tools/list")
        reply(response, body, { tools: [tool()] });
      else started();
    };
    const controller = new AbortController();
    const result = f.s.run(
      'await mcp.call("example.lookup", {}); return await mcp.call("example.lookup", {});',
      {
        providers: ["mcp"],
        signal: controller.signal,
        ...(mode === "deadline"
          ? { limits: { maxCalls: 4, maxConcurrency: 1, timeoutMs: 500 } }
          : {}),
      },
    );
    await pending;
    if (mode === "rotation")
      f.client.configure({
        ...f.config,
        agentToken: `mgw_agent_${Buffer.alloc(32, 2).toString("base64url")}`,
      });
    if (mode === "close") f.client.close();
    if (mode === "cancel") controller.abort();
    const r = await result;
    assert.equal(r.status, mode === "deadline" ? "timeout" : "cancelled");
    assert.equal(r.outcomeUnknown, true);
    assert.equal(r.partialExecution, true);
    assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 1);
    assert.ok(
      f.headers.every((h) => h.authorization === `Bearer ${TEST_BEARER}`),
    );
    if (mode === "rotation" || mode === "close")
      assert.equal(
        (await f.run("return null;")).code,
        "capability_unavailable",
      );
  });
}

for (const order of [
  ["mcp-gateway", "script"],
  ["script", "mcp-gateway"],
  ["mcp-gateway"],
]) {
  test(`real loader provider lifecycle with ${order.join(" then ")}`, async (t) => {
    const s = await scriptFixture(t);
    const f = await fixture(t);
    await s.config({ allowedProviders: ["mcp"] });
    process.env.MCP_GATEWAY_ENDPOINT = f.config.endpoint;
    process.env.MCP_GATEWAY_AGENT_TOKEN = TEST_BEARER;
    process.env.MCP_GATEWAY_READONLY = "0";
    const loaded = await discoverAndLoadExtensions(
      order.map((name) =>
        fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)),
      ),
      s.dir,
      s.dir,
      s.pi.events,
    );
    assert.deepEqual(loaded.errors, []);
    loaded.runtime.getAllTools = () => [];
    loaded.runtime.refreshTools = () => {};
    const ctx: any = { cwd: s.dir, hasUI: false };
    for (const e of loaded.extensions)
      for (const h of e.handlers.get("session_start") ?? [])
        await (h as any)({}, ctx);
    const gateway = loaded.extensions.find((e) => e.tools.has("mcp_call"))!;
    const direct = await gateway.tools
      .get("mcp_call")!
      .definition.execute(
        "direct",
        { name: "example.lookup", arguments: {} },
        undefined,
        undefined,
        ctx,
      );
    assert.match(JSON.stringify(direct.content), /success/);
    assert.equal(
      (
        await s.run('return await mcp.call("example.lookup", {});', {
          providers: ["mcp"],
        })
      ).status,
      "success",
    );
    process.env.MCP_GATEWAY_AGENT_TOKEN = `mgw_agent_${Buffer.alloc(32, 2).toString("base64url")}`;
    for (const h of gateway.handlers.get("before_agent_start") ?? [])
      await (h as any)({ systemPrompt: "base" }, ctx);
    assert.equal(
      (
        await s.run('return await mcp.call("example.lookup", {});', {
          providers: ["mcp"],
        })
      ).status,
      "success",
    );
    assert.equal(
      f.headers.at(-1)!.authorization,
      `Bearer ${process.env.MCP_GATEWAY_AGENT_TOKEN}`,
    );
    for (const e of loaded.extensions)
      for (const h of e.handlers.get("session_shutdown") ?? [])
        await (h as any)({}, ctx);
    assert.equal(
      (await s.run("return null;", { providers: ["mcp"] })).code,
      "capability_unavailable",
    );
  });
}
