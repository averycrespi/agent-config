import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, reply, tool } from "../mcp-gateway/fixture.ts";
import { createGatewayAccess, GatewayError } from "../mcp-gateway/api.ts";
import { executeCode, getCodeLimits, isRepeatSafeFailure } from "./api.ts";
import { runCode } from "./runtime.ts";
import { DEFAULT_CONFIG, loadCodeConfig } from "./config.ts";

const limits = { maxCalls: 2, maxConcurrency: 1, timeoutMs: 3000 };
test("public executor uses fresh children, current gateway and tightening-only ceilings", async (t) => {
  const f = await fixture(t);
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.PI_CODING_AGENT_DIR = f.dir;
  const access = createGatewayAccess(f.client);
  const pi: any = {
    events: {
      emit(_event: string, request: any) {
        request.accept(access);
      },
    },
  };
  assert.equal((await getCodeLimits(pi, f.dir)).maxCalls, 32);
  f.state.handler = (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list"
        ? { tools: [tool("example.lookup", false)] }
        : { content: [{ type: "text", text: "authorized fixture mutation" }] },
    );
  const source =
    'globalThis.count=(globalThis.count??0)+1; const r=await mcp.call("example.lookup", {}); return {count:globalThis.count,text:r.content[0].text};';
  for (let i = 0; i < 2; i++) {
    const r = await executeCode(
      pi,
      f.dir,
      source,
      limits,
      new AbortController().signal,
      Date.now() + 5000,
    );
    assert.equal(r.status, "success");
    assert.equal(JSON.parse(r.json!).count, 1);
    assert.match(r.json!, /authorized fixture mutation/);
  }
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({ "extension:code-mode": { maxCalls: 1 } }),
  );
  const r = await executeCode(
    pi,
    f.dir,
    'await mcp.call("example.lookup", {}); await mcp.call("example.lookup", {}); return null;',
    limits,
    new AbortController().signal,
    Date.now() + 5000,
  );
  assert.equal(r.code, "call_limit");
  assert.equal(r.traces.length, 1);
  assert.equal(r.partialExecution, true);
  const before = f.requests.length;
  const expired = await executeCode(
    pi,
    f.dir,
    source,
    limits,
    new AbortController().signal,
    Date.now() - 1,
  );
  assert.equal(expired.status, "timeout");
  assert.equal(f.requests.length, before);
});

test("only host-branded transient non-dispatch errors permit repetition, even when guest catches", async () => {
  const source =
    'try { await mcp.call("example.lookup", {}); } catch {} return {decision:"wait",evidence:null};';
  for (const [code, dispatch, expected] of [
    ["transport_error", false, true],
    ["http_error", false, true],
    ["invalid_arguments", false, false],
    ["unsupported_schema", false, false],
    ["transport_error", true, false],
  ] as const) {
    const r = await runCode(
      source,
      {
        async call(_name, _args, _signal, onDispatch) {
          if (dispatch) onDispatch();
          throw new GatewayError("not returned", code);
        },
      },
      { ...DEFAULT_CONFIG, timeoutMs: 3000 },
    );
    assert.equal(r.code, "nested_call_failed");
    assert.equal(isRepeatSafeFailure(r), expected, code);
    assert.match(r.json!, /wait/);
  }
  const r = await runCode(
    source,
    {
      async call() {
        throw { code: "transport_error", repeatSafe: true };
      },
    },
    { ...DEFAULT_CONFIG, timeoutMs: 3000 },
  );
  assert.equal(isRepeatSafeFailure(r), false);
  assert.equal(r.traces[0].code, "bridge_error");
});

test("absolute deadline closes admission before delayed gateway dispatch and kills the child", async () => {
  let dispatches = 0;
  const r = await runCode(
    'await mcp.call("example.lookup", {}); return null;',
    {
      async call(_n, _a, _s, onDispatch) {
        const until = Date.now() + 100;
        while (Date.now() < until) {
          /* Simulate host event-loop delay past the immutable deadline. */
        }
        onDispatch();
        dispatches++;
        return { content: [] };
      },
    },
    { ...DEFAULT_CONFIG, timeoutMs: 3000 },
    undefined,
    Date.now() + 70,
  );
  assert.equal(r.status, "timeout");
  assert.equal(dispatches, 0);
  assert.equal(r.effectsMayPersist, false);
});

test("a deterministic throw after a caught transient failure cannot authorize replay", async () => {
  const r = await runCode(
    'try { await mcp.call("example.lookup", {}); } catch {} throw new Error("deterministic");',
    {
      async call() {
        throw new GatewayError(
          "transient discovery failure",
          "transport_error",
        );
      },
    },
    { ...DEFAULT_CONFIG, timeoutMs: 3000 },
  );
  assert.equal(r.code, "script_error");
  assert.equal(r.traces[0].repeatSafe, true);
  assert.equal(r.effectsMayPersist, false);
  assert.equal(isRepeatSafeFailure(r), false);
});

test("invalid settings fail closed in the host API and ordinary code mode", async (t) => {
  const f = await fixture(t);
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.PI_CODING_AGENT_DIR = f.dir;
  const pi: any = {
    events: {
      emit(_e: string, r: any) {
        r.accept(createGatewayAccess(f.client));
      },
    },
  };
  for (const text of [
    "{",
    "[]",
    "null",
    '{"extension:code-mode":null}',
    '{"extension:code-mode":[]}',
    '{"extension:code-mode":{"maxCalls":null}}',
  ]) {
    await writeFile(join(f.dir, "settings.json"), text);
    assert.equal((await loadCodeConfig(f.dir)).valid, false, text);
    const result = await executeCode(
      pi,
      f.dir,
      "return null;",
      limits,
      new AbortController().signal,
      Date.now() + 1000,
    );
    assert.equal(result.code, "executor_unavailable");
  }
  assert.equal(f.requests.length, 0);
  await assert.rejects(getCodeLimits({ events: { emit() {} } } as any, f.dir));
});
