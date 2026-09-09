import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  fixture,
  reply,
  rpcError,
  tool,
  TEST_BEARER,
} from "../mcp-gateway/fixture.ts";
import { createGatewayAccess } from "../mcp-gateway/api.ts";
import { runCode, _spawn } from "./runtime.ts";
import { DEFAULT_CONFIG, parseConfig } from "./config.ts";
import { PARAMETERS, presentRun, renderers } from "./tool.ts";

const limits = { ...DEFAULT_CONFIG, timeoutMs: 3000 };

test("published code patterns avoid Unicode property escapes rejected by Codex", () => {
  const check = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "pattern" && typeof child === "string")
        assert.doesNotMatch(child, /\\[pP]\{/);
      else check(child);
    }
  };
  check(JSON.parse(JSON.stringify(PARAMETERS)));
});

test("code requires a nonblank description of at most 200 characters", () => {
  const source = "return null;";
  const validate = (description: unknown) =>
    validateToolArguments(
      {
        name: "code",
        description: "Compose MCP calls",
        parameters: PARAMETERS,
      },
      {
        type: "toolCall",
        id: "schema",
        name: "code",
        arguments: { description, source },
      },
    );
  for (const description of [
    "Find unassigned issues",
    "x".repeat(200),
    "Find 日本語 issues",
    "Summarize 😀 reactions",
    "x".repeat(199) + "😀",
  ])
    assert.deepEqual(validate(description), { description, source });
  for (const description of [undefined, null, {}, "", " \n\t", "x".repeat(201)])
    assert.throws(() => validate(description), /Validation failed/);
});

test("call labels use safe descriptions, fall back for history and update during streaming", () => {
  const theme: any = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const context: any = { state: {} };
  for (const description of [
    undefined,
    null,
    42,
    "",
    " \n\t",
    "\x1b[31m",
    "\u200b",
    "\u200d\u2060",
    "\u{e0001}",
  ])
    assert.deepEqual(
      renderers.renderCall!({ description } as any, theme, context).render(100),
      ["code MCP composition"],
    );
  const header = renderers.renderCall!({} as any, theme, context);
  context.lastComponent = header;
  const updated = renderers.renderCall!(
    { description: "Find unassigned issues", source: "SOURCE_SECRET" },
    theme,
    context,
  );
  assert.equal(updated, header);
  assert.deepEqual(updated.render(100), ["code Find unassigned issues"]);
  const hostile = renderers.renderCall!(
    {
      source: "SOURCE_SECRET",
      description: ` \x1b]52;c;evil\x07Find\n\tissues\u200b \x1b[31m${TEST_BEARER}\u202e `,
    },
    theme,
    context,
  );
  assert.deepEqual(hostile.render(200), [
    "code Find issues [redacted gateway credential]",
  ]);
  const bounded = renderers.renderCall!(
    { description: "x".repeat(500), source: "SOURCE_SECRET" },
    theme,
    context,
  );
  assert.deepEqual(bounded.render(1000), [`code ${"x".repeat(200)}`]);
  const unicode = renderers.renderCall!(
    { description: "x".repeat(199) + "😀extra", source: "return null;" },
    theme,
    context,
  );
  assert.deepEqual(unicode.render(1000), [`code ${"x".repeat(199)}😀`]);
  for (const width of [0, 1, 7, 20, 100]) {
    const lines = unicode.render(width);
    assert.equal(lines.length, 1);
    assert.ok(visibleWidth(lines[0]) <= width);
  }
});

test("status rows are concise, unindented and preserve styling and expanded details", () => {
  const colors: string[] = [];
  const theme: any = {
    fg: (color: string, text: string) => {
      colors.push(color);
      return text;
    },
    bold: (text: string) => text,
  };
  for (const expanded of [false, true]) {
    for (const state of [
      {
        isPartial: true,
        codeError: false,
        isError: false,
        label: "running...",
        color: "warning",
      },
      {
        isPartial: false,
        codeError: false,
        isError: false,
        label: "completed · 2 calls",
        color: "success",
      },
      {
        isPartial: false,
        codeError: true,
        isError: false,
        label: "failed · 2 calls · nested_call_failed",
        color: "error",
      },
      {
        isPartial: false,
        codeError: false,
        isError: true,
        label: "failed · 2 calls · nested_call_failed",
        color: "error",
      },
    ]) {
      colors.length = 0;
      const failed = state.codeError || state.isError;
      const component = renderers.renderResult!(
        {
          content: [],
          details: {
            calls: 2,
            codeError: state.codeError,
            ...(failed
              ? {
                  code: "nested_call_failed",
                  outcomeUnknown: true,
                  partialExecution: true,
                }
              : {}),
            traces: [
              {
                id: 1,
                tool: "example.lookup",
                state: "success",
                durationMs: 10,
              },
            ],
            spillFilePath: "/tmp/example-output.txt",
          },
        },
        { isPartial: state.isPartial, expanded },
        theme,
        { state: {}, isError: state.isError } as any,
      );
      assert.equal(colors[0], state.color);
      assert.deepEqual(component.render(200), [
        state.label,
        ...(failed
          ? [
              "Outcome unknown; do not automatically retry.",
              "Partial execution; earlier effects may persist.",
            ]
          : []),
        ...(expanded
          ? [
              "1 example.lookup · success · 10ms",
              "Output: /tmp/example-output.txt",
            ]
          : []),
      ]);
    }
  }
});

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
    { source: "SOURCE_SECRET" } as any,
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
  for (const description of [
    undefined,
    "",
    " \n\t",
    "\u200b",
    "\u200d\u2060",
    "\u{e0001}",
  ]) {
    await assert.rejects(
      definition.execute(
        "blank-description",
        { description, source: 'return await mcp.call("example.lookup", {});' },
        undefined,
        undefined,
        ctx,
      ),
      /description must be nonblank/,
    );
  }
  assert.equal(f.requests.length, 0);
  await assert.rejects(
    definition.execute(
      "unavailable",
      { description: "Check gateway access", source: "return null;" },
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
      description: "Look up 日本語 😀 results",
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
  const rejected = await definition.execute(
    "loader-invalid-arguments",
    {
      description: "Check lookup argument validation",
      source:
        'try { await mcp.call("example.lookup", {query: 1}); } catch {} return null;',
    },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((rejected.details as any).traces[0].code, "invalid_arguments");
  assert.equal((rejected.details as any).traces[0].dispatched, false);
  const annotated = {
    ...tool(),
    inputSchema: {
      type: "object",
      required: ["owner", "repo"],
      properties: {
        owner: { type: "string", "x-mcp-header": "owner" },
        repo: { type: "string", "x-mcp-header": "repo" },
        fields: {
          type: "array",
          items: { type: "string", enum: ["name", "type"] },
        },
      },
    },
  };
  f.state.handler = (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list"
        ? { tools: [annotated] }
        : {
            content: [
              { type: "text", text: JSON.stringify(body.params.arguments) },
            ],
          },
    );
  const composed = await definition.execute(
    "loader-header-annotations",
    {
      description: "Look up two repositories",
      source: `return await parallel(["first", "second"].map(repo => async () => {
      const r = await mcp.call("example.lookup", {owner:"example", repo, fields:["name"]});
      return JSON.parse(r.content[0].text);
    }));`,
    },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((composed.details as any).status, "success");
  assert.equal((composed.details as any).succeeded, 2);
  assert.match(JSON.stringify(composed.content), /first/);
  assert.match(JSON.stringify(composed.content), /second/);
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 3);

  const invocationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  for (const code of [
    "unsupported_schema",
    "call_rejected",
    "outcome_unknown",
  ]) {
    const before = f.requests.filter((r) => r.method === "tools/call").length;
    f.state.handler = (body, response) => {
      if (body.method === "tools/list")
        return reply(response, body, {
          tools: [
            {
              ...tool(),
              ...(code === "unsupported_schema"
                ? { inputSchema: { unknownConstraint: true } }
                : {}),
            },
          ],
        });
      rpcError(
        response,
        body,
        code,
        { reason: "block", invocationId },
        "INTERMEDIATE_SECRET",
      );
    };
    const failed = await definition.execute(
      "loader-errors",
      {
        description: "Check lookup failures",
        source:
          'try { await mcp.call("example.lookup", {}); } catch(e) { return {code:e.code, reason:e.reason ?? null, invocationId:e.invocationId ?? null, outcomeUnknown:e.outcomeUnknown}; }',
      },
      undefined,
      undefined,
      ctx,
    );
    const trace = (failed.details as any).traces[0];
    assert.equal(trace.code, code);
    assert.equal(trace.dispatched, code !== "unsupported_schema");
    assert.equal(trace.reason, code === "call_rejected" ? "block" : undefined);
    assert.equal(
      trace.invocationId,
      code === "unsupported_schema" ? undefined : invocationId,
    );
    assert.equal(trace.outcomeUnknown, code === "outcome_unknown");
    assert.equal((failed.details as any).status, "failed");
    assert.doesNotMatch(JSON.stringify(failed), /INTERMEDIATE_SECRET/);
    assert.match(JSON.stringify(failed.content), new RegExp(code));
    assert.equal(
      f.requests.filter((r) => r.method === "tools/call").length - before,
      code === "unsupported_schema" ? 0 : 1,
    );
  }
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
      { description: "Check closed gateway", source: "return null;" },
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
