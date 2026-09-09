import assert from "node:assert/strict";
import { test } from "node:test";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";
import {
  fixture,
  tool,
  reply,
  rpcError,
  TEST_BEARER,
} from "../mcp-gateway/fixture.ts";
import { createGatewayAccess } from "../mcp-gateway/api.ts";
import { runCode, _spawn } from "./runtime.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { presentRun } from "./tool.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const limits = { ...DEFAULT_CONFIG, timeoutMs: 3000 };
const invocationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

test("real child composes pagination, dependent IDs, and parallel aggregation in actual order", async (t) => {
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const f = await fixture(t, async (body, response) => {
    if (body.method === "tools/list")
      return reply(response, body, {
        tools: [tool("example.page"), tool("example.detail")],
      });
    const { name, arguments: args } = body.params;
    order.push(`${name}:${args.query}`);
    if (name === "example.page")
      return reply(response, body, {
        content: [],
        structuredContent: {
          ids: args.query === "1" ? ["a", "b"] : ["c"],
          next: args.query === "1" ? "2" : null,
        },
      });
    active++;
    peak = Math.max(peak, active);
    await delay(35);
    active--;
    reply(response, body, {
      content: [],
      structuredContent: { value: args.query.charCodeAt(0) },
    });
  });
  const result = await runCode(
    `
    const ids = []; let page = "1";
    do { const r = await mcp.call("example.page", {query: page}); ids.push(...r.structuredContent.ids); page = r.structuredContent.next; } while(page);
    const values = await parallel(ids.map(id => async () => (await mcp.call("example.detail", {query:id})).structuredContent.value));
    return values.reduce((a,b) => a+b,0);
  `,
    createGatewayAccess(f.client),
    { ...limits, maxConcurrency: 2 },
  );
  assert.equal(result.status, "success");
  assert.equal(result.json, "294");
  assert.deepEqual(order.slice(0, 2), ["example.page:1", "example.page:2"]);
  assert.deepEqual(order.slice(2).sort(), [
    "example.detail:a",
    "example.detail:b",
    "example.detail:c",
  ]);
  assert.equal(peak, 2);
  assert.equal(result.traces.length, 5);
});

test("raw result fidelity and credential redaction before guest delivery", async (t) => {
  const payload = {
    content: [
      { type: "text", text: "plain" },
      {
        type: "resource",
        resource: { uri: "example://data", text: TEST_BEARER },
      },
      { type: "audio", data: "abc", mimeType: "audio/wav" },
    ],
    structuredContent: { token: TEST_BEARER },
    _meta: { nextCursor: "next", truncated: true },
    isError: true,
  };
  const f = await fixture(t, (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list" ? { tools: [tool()] } : payload,
    ),
  );
  const result = await runCode(
    `const r = await mcp.call("example.lookup", {}); return { ...r, credentialPresent: JSON.stringify(r).includes("mgw_agent_") };`,
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.code, "nested_call_failed");
  const value = JSON.parse(result.json!);
  assert.equal(value.credentialPresent, false);
  assert.deepEqual(value._meta, payload._meta);
  assert.equal(value.content[0].text, "plain");
  assert.equal(value.content[2].type, "audio");
  assert.equal(value.isError, true);
  assert.equal(value.structuredContent.token, "[redacted gateway credential]");
  assert.equal(result.traces[0].code, "provider_error");
});

test("host validates unknown tools and arguments before transport; catches retain failures", async (t) => {
  const descriptor = {
    ...tool(),
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 2 } },
    },
  };
  const f = await fixture(t, (body, response) =>
    reply(response, body, { tools: [descriptor] }),
  );
  const result = await runCode(
    `
    for (const [name,args] of [["not.real", {}], ["example.lookup", {query: 1}], ["example.lookup", {query:"ok", secret:"no"}]]) {
      try { await mcp.call(name,args); } catch {}
    } return "caught";
  `,
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(result.status, "failed");
  assert.deepEqual(
    result.traces.map((t) => t.code),
    ["unknown_tool", "invalid_arguments", "invalid_arguments"],
  );
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 0);
  assert.equal(result.effectsMayPersist, false);
});

test("unsupported schemas and remote references fail closed", async (t) => {
  const f = await fixture(t, (body, response) =>
    reply(response, body, {
      tools: [
        { ...tool(), inputSchema: { $ref: "https://example.com/schema" } },
      ],
    }),
  );
  const r = await runCode(
    `try { await mcp.call("example.lookup", {}); } catch {} return null;`,
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(r.traces[0].code, "unsupported_schema");
  assert.deepEqual(
    f.requests.map((r) => r.method),
    ["tools/list"],
  );
});

test("multiplexed reads/writes retain gateway rejection codes without grants, polling, or replay", async (t) => {
  let writes = 0;
  const f = await fixture(t, (body, response) => {
    if (body.method === "tools/list")
      return reply(response, body, {
        tools: [
          {
            ...tool("example.item", false),
            inputSchema: {
              type: "object",
              required: ["action"],
              additionalProperties: false,
              properties: { action: { enum: ["read", "write", "denied"] } },
            },
          },
        ],
      });
    if (body.params.arguments.action === "denied")
      return rpcError(
        response,
        body,
        "call_rejected",
        { reason: "block", invocationId },
        "INTERMEDIATE_SENTINEL request grants automatically",
      );
    if (body.params.arguments.action === "write") writes++;
    reply(response, body, { content: [], structuredContent: { writes } });
  });
  const r = await runCode(
    `await mcp.call("example.item", {action:"read"}); await mcp.call("example.item", {action:"write"}); try { await mcp.call("example.item", {action:"denied"}); } catch {} return 1;`,
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(writes, 1);
  assert.equal(r.status, "failed");
  assert.equal(r.partialExecution, true);
  assert.equal(r.outcomeUnknown, false);
  assert.equal(r.traces[2].reason, "block");
  assert.equal(r.traces[2].invocationId, invocationId);
  assert.deepEqual(
    f.requests
      .filter((r) => r.method === "tools/call")
      .map((r) => r.params.arguments.action),
    ["read", "write", "denied"],
  );
  assert.doesNotMatch(
    JSON.stringify(await presentRun(r, "denied", f.dir)),
    /INTERMEDIATE_SENTINEL/,
  );
  f.client.configure({ ...f.config, readOnly: true });
  const restricted = await runCode(
    `try { await mcp.call("example.item", {action:"read"}); } catch {} return null;`,
    createGatewayAccess(f.client),
    limits,
  );
  assert.equal(restricted.traces[0].code, "read_only_rejected");
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 3);
});

test("intermediate sentinel stays out of serialized model context on success and script errors", async (t) => {
  const sentinel = "INTERMEDIATE_SENTINEL_".repeat(5000);
  const f = await fixture(t, (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list"
        ? { tools: [tool()] }
        : {
            content: [{ type: "text", text: sentinel }],
            structuredContent: { count: 7 },
          },
    ),
  );
  for (const tail of [
    "return r.structuredContent.count",
    "throw new Error(r.content[0].text)",
  ]) {
    const r = await runCode(
      `const r = await mcp.call("example.lookup", {}); ${tail};`,
      createGatewayAccess(f.client),
      limits,
    );
    const result = await presentRun(r, "sentinel", f.dir);
    const modelContext = JSON.stringify({
      messages: [
        {
          role: "toolResult",
          toolName: "code",
          content: result.content,
          details: result.details,
        },
      ],
    });
    assert.doesNotMatch(modelContext, /INTERMEDIATE_SENTINEL/);
    const converted = convertToLlm([
      {
        role: "toolResult",
        toolCallId: "sentinel",
        toolName: "code",
        content: result.content,
        details: result.details,
        isError: r.status !== "success",
        timestamp: 0,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(converted), /INTERMEDIATE_SENTINEL/);
    assert.doesNotMatch(modelContext, /plain|structuredContent/);
  }
});

test("host queue enforces concurrency even with Promise.all, and count cap is sticky", async (t) => {
  let active = 0;
  let peak = 0;
  const f = await fixture(t, async (body, response) => {
    if (body.method === "tools/list")
      return reply(response, body, { tools: [tool()] });
    active++;
    peak = Math.max(peak, active);
    await delay(25);
    active--;
    reply(response, body, { content: [] });
  });
  const access = createGatewayAccess(f.client);
  const r = await runCode(
    `await Promise.all(Array.from({length:6}, () => mcp.call("example.lookup", {}))); return null;`,
    access,
    { ...limits, maxConcurrency: 2 },
  );
  assert.equal(r.status, "success");
  assert.equal(peak, 2);
  const capped = await runCode(
    `for(let i=0;i<4;i++) { try { await mcp.call("example.lookup", {}); } catch {} } return null;`,
    access,
    { ...limits, maxCalls: 2 },
  );
  assert.equal(capped.code, "call_limit");
  assert.equal(capped.traces.length, 2);
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 8);
});

test("deadline terminates synchronous runaway child and awaits real exit", async (t) => {
  const pids: number[] = [];
  const original = _spawn.fn;
  t.mock.method(_spawn, "fn", (...args: Parameters<typeof original>) => {
    const child = original(...args);
    if (child.pid) pids.push(child.pid);
    return child;
  });
  const f = await fixture(t);
  const begin = Date.now();
  const r = await runCode("while(true) {}", createGatewayAccess(f.client), {
    ...limits,
    timeoutMs: 150,
  });
  assert.equal(r.status, "timeout");
  assert.ok(Date.now() - begin < 2000);
  assert.equal(pids.length, 1);
  assert.throws(() => process.kill(pids[0], 0), /ESRCH/);
  assert.equal(f.requests.length, 0);
});

test("cancellation aborts in-flight HTTP, prevents queued admission, and reports partial writes and uncertainty", async (t) => {
  let writes = 0;
  let closed = false;
  const entered = deferred<void>();
  const f = await fixture(t, (body, response) => {
    if (body.method === "tools/list")
      return reply(response, body, { tools: [tool()] });
    writes++;
    response.on("close", () => {
      closed = true;
    });
    entered.resolve();
    // Mutation took effect; response deliberately remains unsettled.
  });
  const abort = new AbortController();
  const pending = runCode(
    `await Promise.all([mcp.call("example.lookup", {}), mcp.call("example.lookup", {})]); return null;`,
    createGatewayAccess(f.client),
    { ...limits, maxConcurrency: 1 },
    abort.signal,
  );
  await entered.promise;
  abort.abort();
  const r = await pending;
  for (let i = 0; i < 20 && !closed; i++) await delay(10);
  assert.equal(closed, true);
  assert.equal(r.status, "cancelled");
  assert.equal(r.partialExecution, true);
  assert.equal(r.outcomeUnknown, true);
  assert.equal(writes, 1);
  assert.equal(r.traces.filter((t) => t.dispatched).length, 1);
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 1);
});

test("guest state is fresh; denied imports, code generation and privileged globals", async (t) => {
  const f = await fixture(t);
  const access = createGatewayAccess(f.client);
  const r = await runCode(
    `globalThis.secret = 9; return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof setTimeout];`,
    access,
    limits,
  );
  assert.deepEqual(JSON.parse(r.json!), Array(5).fill("undefined"));
  const fresh = await runCode(
    "return typeof globalThis.secret;",
    access,
    limits,
  );
  assert.equal(fresh.json, '"undefined"');
  for (const source of [
    'return (await import("node:fs")).readFileSync("/etc/passwd", "utf8");',
    'return (await import("node:net")).connect(80,"example.com");',
    'return (await import("node:child_process")).execSync("echo forbidden");',
    'return mcp.call.constructor("return process")().env;',
    'return globalThis.constructor.constructor("return process")().env;',
    'return eval("1+1");',
    "mcp.call = () => 1; return null;",
    'return (await import("data:text/javascript,export default 1")).default;',
  ]) {
    const denied = await runCode(source, access, limits);
    assert.equal(denied.status, "failed", source);
    assert.equal(denied.code, "script_error", source);
  }
  assert.equal(f.requests.length, 0);
});

test("malformed IPC and forged accounting never dispatch; abnormal children are killed", async (t) => {
  const original = _spawn.fn;
  const f = await fixture(t);
  // Replace only stdin bootstrap for a deliberately compromised child. Host is the tested boundary.
  for (const message of [
    {
      type: "call",
      id: 1,
      name: "example.lookup",
      args: {},
      authority: "admin",
    },
    { type: "call", id: 999, name: "example.lookup", args: {} },
    { type: "call", id: 1, name: "example.lookup", args: [] },
    { type: "budget", maxCalls: 1000 },
  ]) {
    const mock = t.mock.method(
      _spawn,
      "fn",
      (...args: Parameters<typeof original>) => {
        const child = original(...args);
        child.stdin!.end(
          `process.send(${JSON.stringify(JSON.stringify(message))});`,
        );
        return {
          ...child,
          stdin: undefined,
          on: child.on.bind(child),
          kill: child.kill.bind(child),
          send: child.send.bind(child),
        } as unknown as typeof child;
      },
    );
    const r = await runCode(
      "return null",
      createGatewayAccess(f.client),
      limits,
    );
    assert.equal(r.code, "invalid_ipc");
    mock.mock.restore();
  }
  assert.equal(f.requests.length, 0);
});

test("late settlements cannot change finalized unknown outcomes or produce detached work", async () => {
  const started = deferred<void>();
  const late = deferred<any>();
  const abort = new AbortController();
  let calls = 0;
  const task = runCode(
    `await mcp.call("example.lookup", {}); return null;`,
    {
      call: async (_name, _args, signal, dispatch) => {
        calls++;
        dispatch();
        started.resolve();
        signal.addEventListener("abort", () => {});
        return late.promise;
      },
    },
    limits,
    abort.signal,
  );
  await started.promise;
  abort.abort();
  const r = await task;
  const snapshot = JSON.stringify(r);
  late.resolve({ content: [], structuredContent: { secret: "LATE_SENTINEL" } });
  await delay(20);
  assert.equal(JSON.stringify(r), snapshot);
  assert.equal(r.outcomeUnknown, true);
  assert.equal(calls, 1);
});
