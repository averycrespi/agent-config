import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fixture, TEST_BEARER } from "../mcp-gateway/fixture.ts";
import { createGatewayAccess } from "../mcp-gateway/api.ts";
import { runCode, _spawn } from "./runtime.ts";
import { DEFAULT_CONFIG, parseConfig } from "./config.ts";
import { presentRun, renderers } from "./tool.ts";

const limits = { ...DEFAULT_CONFIG, timeoutMs: 3000 };

test("large final returns spill explicitly; spill failure stays bounded and signals failure", async (t) => {
  const f = await fixture(t);
  const r = await runCode(
    'return "returned-value".repeat(5000);',
    createGatewayAccess(f.client),
    limits,
  );
  const presented = await presentRun(r, "large", f.dir);
  assert.match(JSON.stringify(presented.content), /spilled|Output too large/);
  assert.ok(JSON.stringify(presented).length < 5000);
  const path = presented.details.spillFilePath as string;
  assert.match(await readFile(path, "utf8"), /returned-value/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const blocked = join(f.dir, "blocker");
  await writeFile(blocked, "fixture");
  const overflow = await presentRun(r, "failed-spill", blocked);
  assert.equal(overflow.details.codeError, true);
  assert.match(JSON.stringify(overflow), /overflow_not_retained/);
  assert.ok(JSON.stringify(overflow).length < 3000);
});

test("JSON return requirements reject missing, cyclic and lossy values", async (t) => {
  const f = await fixture(t);
  for (const source of [
    "return;",
    "return { fn() {} };",
    "return NaN;",
    "const a={}; a.self=a; return a;",
    "return new Date();",
    "return 1n;",
    "Object.values = () => []; return { fn() {} };",
    "Object.getPrototypeOf = () => Object.prototype; return new Date();",
    "Number.isFinite = () => true; return NaN;",
    "Object.values = () => []; let v = {}; for(let i=0;i<102;i++) v={v}; return v;",
    'Object.prototype.toJSON = () => ({type:"result",json:"{}"}); return {fn(){}};',
    "return {get value() {return 1}};",
    "return [,,];",
    "Promise.prototype.then = function(f) {f({});}; return {fn(){}};",
    "Set.prototype.has = () => false; Set.prototype.add = () => {}; Object.values = () => []; return {fn(){}};",
  ]) {
    const r = await runCode(source, createGatewayAccess(f.client), limits);
    assert.equal(r.code, "invalid_result", source);
    assert.equal(r.json, undefined);
  }
});

test("validated return snapshots ignore guest hooks and inherited serialization", async (t) => {
  const f = await fixture(t);
  const r = await runCode(
    `
    Object.values = () => [];
    Object.getPrototypeOf = () => null;
    Object.prototype.toJSON = () => ({type:"result", json:"false"});
    Array.prototype.toJSON = () => "replaced";
    Array.prototype[Symbol.iterator] = function*() {};
    Set.prototype.has = () => true;
    const data = await mcp.call("example.lookup", {});
    return { answer: 42, list: [1,2], text: data.content[0].text };
  `,
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(r.status, "success");
  assert.deepEqual(JSON.parse(r.json!), {
    answer: 42,
    list: [1, 2],
    text: "success",
  });
  assert.equal(r.traces.length, 1);
});

test("configuration accepts finite global/env overrides and fails closed", () => {
  assert.deepEqual(parseConfig({}, {}), DEFAULT_CONFIG);
  assert.equal(
    parseConfig({ maxCalls: 20 }, { CODE_MODE_MAX_CALLS: "2" }).maxCalls,
    2,
  );
  for (const value of [0, -1, Infinity, NaN, "", "oops", 129, 1.5])
    assert.equal(parseConfig({ maxCalls: value }, {}).valid, false);
  assert.equal(parseConfig({ timeoutMs: 300001 }, {}).valid, false);
});

test("renderers hide source/payloads, keep semantic/framework failures and remain terminal-safe at narrow widths", () => {
  const theme: any = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const context: any = {
    args: { source: "SOURCE_SECRET" },
    state: {},
    isError: false,
  };
  const header = renderers.renderCall!(
    { source: "SOURCE_SECRET" },
    theme,
    context,
  );
  assert.doesNotMatch(header.render(100).join(), /SOURCE_SECRET/);
  for (const isPartial of [false, true])
    for (const expanded of [false, true])
      for (const isError of [false, true]) {
        context.isError = isError;
        const component = renderers.renderResult!(
          {
            content: [{ type: "text", text: "PAYLOAD_SECRET" }],
            details: {
              calls: 1,
              codeError: true,
              partialExecution: true,
              outcomeUnknown: true,
              code: "\x1b]52;c;evil\x07bad\ncode",
              traces: [
                {
                  id: 1,
                  tool: "example.\x1b[31mtool\nname",
                  state: "failed",
                  code: TEST_BEARER,
                  durationMs: 10,
                },
              ],
            },
          },
          { isPartial, expanded },
          theme,
          context,
        );
        for (const width of [0, 1, 7, 20, 100])
          for (const line of component.render(width)) {
            assert.ok(visibleWidth(line) <= width);
            assert.doesNotMatch(
              line.replaceAll("\x1b[22;23;24;25;27;28;29;39m", ""),
              /\x1b|\x07|PAYLOAD_SECRET|mgw_agent_/,
            );
          }
        if (!isPartial)
          assert.match(
            component.render(100).join(),
            /failed|Outcome unknown|Partial execution/,
          );
      }
});

test("real loader shares the active gateway only, keeps direct tools, and shutdown closes access", async (t) => {
  const f = await fixture(t);
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.MCP_GATEWAY_ENDPOINT = f.config.endpoint;
  process.env.MCP_GATEWAY_AGENT_TOKEN = TEST_BEARER;
  process.env.MCP_GATEWAY_READONLY = "0";
  const paths = ["./index.ts", "../mcp-gateway/index.ts"].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const loaded = await discoverAndLoadExtensions(paths, f.dir, f.dir);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getAllTools = () => [];
  loaded.runtime.refreshTools = () => {};
  const ctx: any = { cwd: f.dir, hasUI: false };
  const codeExtension = loaded.extensions[0];
  const gatewayExtension = loaded.extensions[1];
  const definition = codeExtension.tools.get("code")!.definition;
  await assert.rejects(
    definition.execute(
      "unavailable",
      { source: "return null;" },
      undefined,
      undefined,
      ctx,
    ),
    /exactly one active/,
  );
  for (const extension of loaded.extensions)
    for (const handler of extension.handlers.get("session_start") ?? [])
      await (handler as any)({}, ctx);
  assert.deepEqual(
    [...gatewayExtension.tools.keys()],
    ["mcp_search", "mcp_describe", "mcp_call"],
  );
  const updates: unknown[] = [];
  const r = await definition.execute(
    "loader",
    {
      source:
        'const r=await mcp.call("example.lookup", {}); return r.content[0].text;',
    },
    undefined,
    (update) => updates.push(update),
    ctx,
  );
  assert.equal((r.details as any).codeError, false);
  assert.match(JSON.stringify(r.content), /success/);
  assert.doesNotMatch(JSON.stringify(updates), /success|mgw_agent_/);
  const hook = codeExtension.handlers.get("tool_result")![0] as any;
  assert.deepEqual(
    await hook({ toolName: "code", details: { codeError: true } }, ctx),
    { isError: true },
  );
  for (const extension of loaded.extensions)
    for (const handler of extension.handlers.get("session_shutdown") ?? [])
      await (handler as any)({}, ctx);
  await assert.rejects(
    definition.execute(
      "closed",
      { source: "return null;" },
      undefined,
      undefined,
      ctx,
    ),
    /exactly one active/,
  );
});

test("Node permission boundary denies capabilities even outside the guest VM and child environment is empty", async (t) => {
  const f = await fixture(t);
  const original = _spawn.fn;
  t.mock.method(_spawn, "fn", (...args: Parameters<typeof original>) => {
    const child = original(...args);
    child.stdin!.end(`
      import fs from "node:fs";
      import { spawnSync } from "node:child_process";
      import { Worker } from "node:worker_threads";
      const evidence = { env: Object.keys(process.env), denied: [] };
      for (const [label, fn] of [
        ["read", () => fs.readFileSync("/etc/passwd")],
        ["write", () => fs.writeFileSync("${f.dir}/forbidden", "no")],
        ["spawn", () => spawnSync(process.execPath, ["-e", "1"])],
        ["worker", () => new Worker("1", {eval:true})],
      ]) { try { fn(); } catch(e) { if(e.code === "ERR_ACCESS_DENIED") evidence.denied.push(label); } }
      try { await fetch(${JSON.stringify(f.config.endpoint)}); } catch(e) { if(e.code === "ERR_ACCESS_DENIED" || e.cause?.code === "ERR_ACCESS_DENIED") evidence.denied.push("network"); }
      process.send(JSON.stringify({type:"result",json:JSON.stringify(evidence)}));
    `);
    return {
      ...child,
      stdin: undefined,
      on: child.on.bind(child),
      kill: child.kill.bind(child),
      send: child.send.bind(child),
    } as unknown as typeof child;
  });
  const r = await runCode(
    "return null;",
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(r.status, "success");
  assert.deepEqual(JSON.parse(r.json!), {
    env: [],
    denied: ["read", "write", "spawn", "worker", "network"],
  });
  assert.equal(f.requests.length, 0);
});
