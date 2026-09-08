import assert from "node:assert/strict";
import { chmod, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  GatewayError,
  PROTOCOL_VERSION,
  MAX_RESPONSE_BYTES,
} from "./client.ts";
import { fixture, reply, rpcError, TEST_BEARER, tool } from "./fixture.ts";

const invocationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

test("explicit HTTP hostname preserves Host and authentication through the real transport", async (t) => {
  const f = await fixture(t);
  const endpoint = f.config.endpoint.replace("127.0.0.1", "localhost");
  f.client.configure({ ...f.config, endpoint });
  assert.equal((await f.client.listTools())[0].name, "example.lookup");
  await f.client.callTool("example.lookup", {});
  assert.equal(f.requests.length, 2);
  for (const headers of f.headers) {
    assert.equal(headers.host, new URL(endpoint).host);
    assert.equal(headers.authorization, `Bearer ${TEST_BEARER}`);
  }
});

test("modern HTTP client traverses pagination and sends exact metadata without initialization", async (t) => {
  const f = await fixture(t, (body, response) =>
    reply(
      response,
      body,
      body.params.cursor
        ? { tools: [tool("example.second")] }
        : { tools: [tool()], nextCursor: "page2" },
    ),
  );
  assert.deepEqual(
    (await f.client.listTools()).map((t) => t.name),
    ["example.lookup", "example.second"],
  );
  assert.equal(f.requests.length, 2);
  for (const [i, body] of f.requests.entries()) {
    assert.equal(body.method, "tools/list");
    assert.equal(body.jsonrpc, "2.0");
    assert.ok(body.id);
    assert.deepEqual(body.params._meta, {
      "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        name: "pi-mcp-gateway",
        version: "1",
      },
    });
    assert.equal(f.headers[i].authorization, `Bearer ${TEST_BEARER}`);
    assert.equal(f.headers[i]["mcp-protocol-version"], PROTOCOL_VERSION);
    assert.equal(f.headers[i]["mcp-session-id"], undefined);
    assert.equal(f.headers[i]["mcp-broker-approval-mode"], undefined);
  }
});

test("stale cursor restarts once from page one; repeated staleness fails without a partial cache", async (t) => {
  let stale = true;
  const f = await fixture(t, (body, response) => {
    if (body.params.cursor && stale) {
      stale = false;
      return rpcError(response, body, "stale_cursor");
    }
    reply(
      response,
      body,
      body.params.cursor
        ? { tools: [tool("example.end")] }
        : { tools: [tool()], nextCursor: "next" },
    );
  });
  assert.equal((await f.client.listTools()).length, 2);
  assert.deepEqual(
    f.requests.map((r) => r.params.cursor),
    [undefined, "next", undefined, "next"],
  );
  f.state.handler = (body, response) =>
    rpcError(response, body, "stale_cursor");
  await assert.rejects(
    f.client.listTools(),
    (e: GatewayError) => e.code === "stale_cursor",
  );
  assert.equal(f.requests.length, 6);
  assert.equal(f.client.getCachedTools(), undefined);
});

test("repeated cursor, duplicate descriptors, malformed schema, and failed page invalidate discovery", async (t) => {
  const f = await fixture(t);
  await f.client.listTools();
  for (const result of [
    { tools: [tool(), tool()] },
    { tools: [{ name: "bad", inputSchema: null }] },
    { tools: [], nextCursor: "same" },
    { tools: [], nextCursor: null },
  ]) {
    f.state.handler = (body, response) => reply(response, body, result);
    await assert.rejects(f.client.listTools());
    assert.equal(f.client.getCachedTools(), undefined);
  }
  f.state.handler = (body, response) =>
    body.params.cursor
      ? rpcError(response, body, "authorization_unavailable")
      : reply(response, body, { tools: [tool()], nextCursor: "next" });
  await assert.rejects(
    f.client.listTools(),
    (e: GatewayError) => e.code === "authorization_unavailable",
  );
  assert.equal(f.client.getCachedTools(), undefined);
});

test("read-only calls refresh admission; missing hints, changed hints, and unavailable discovery never invoke", async (t) => {
  let readOnly = true;
  const f = await fixture(t, (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list"
        ? {
            tools: [
              tool("example.read", readOnly),
              tool("example.write", false),
              { ...tool("example.unknown"), annotations: undefined },
            ],
          }
        : { content: [], structuredContent: { ok: true } },
    ),
  );
  f.client.configure({ ...f.config, readOnly: true });
  assert.deepEqual(
    (await f.client.listTools()).map((t) => t.name),
    ["example.read"],
  );
  await f.client.callTool("example.read", { query: "one" });
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 1);
  readOnly = false;
  for (const name of [
    "example.read",
    "example.write",
    "example.unknown",
    "injected.write",
  ])
    await assert.rejects(
      f.client.callTool(name, {}),
      (e: GatewayError) => e.code === "read_only_rejected",
    );
  f.state.handler = (body, response) =>
    rpcError(response, body, "authorization_unavailable");
  await assert.rejects(f.client.callTool("example.read", {}));
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 1);
});

test("credential is read on each request; rotation between read-only check and invocation fails closed", async (t) => {
  const f = await fixture(t);
  await f.client.listTools();
  const rotated = `mgw_agent_${Buffer.alloc(32, 2).toString("base64url")}`;
  await writeFile(f.credentialFile, rotated);
  await f.client.callTool("example.lookup", {});
  assert.equal(f.headers[1].authorization, `Bearer ${rotated}`);
  f.client.configure({ ...f.config, readOnly: true });
  f.state.handler = async (body, response) => {
    await writeFile(f.credentialFile, TEST_BEARER);
    reply(response, body, { tools: [tool()] });
  };
  await assert.rejects(
    f.client.callTool("example.lookup", {}),
    (e: GatewayError) => e.code === "credential_changed",
  );
  assert.equal(f.requests.filter((r) => r.method === "tools/call").length, 1);
});

test("bad credentials, file permissions, and symlinks are rejected without network or secret errors", async (t) => {
  const f = await fixture(t);
  for (const value of [
    "mgw_admin_secret",
    "plain-invalid",
    `${TEST_BEARER}\n${TEST_BEARER}`,
    "x".repeat(4097),
  ]) {
    await writeFile(f.credentialFile, value);
    await assert.rejects(
      f.client.listTools(),
      (e: Error) => !e.message.includes(value) && e instanceof GatewayError,
    );
  }
  await writeFile(f.credentialFile, TEST_BEARER);
  await chmod(f.credentialFile, 0o644);
  await assert.rejects(f.client.listTools(), /owner-only/);
  await chmod(f.credentialFile, 0o600);
  const link = join(f.dir, "link");
  await symlink(f.credentialFile, link);
  f.client.configure({ ...f.config, credentialFile: link });
  await assert.rejects(f.client.listTools(), /symlinks/);
  assert.equal(f.requests.length, 0);
});

test("grant tools use ordinary call transport and preserve structured results", async (t) => {
  const f = await fixture(t, (body, response) =>
    reply(response, body, {
      content: [{ type: "text", text: "request created" }],
      structuredContent: { id: "request-1" },
    }),
  );
  const result = await f.client.callTool("mcp_gateway.create_grant_request", {
    name: "example.lookup",
  });
  assert.deepEqual(result.structuredContent, { id: "request-1" });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].params.name, "mcp_gateway.create_grant_request");
  assert.deepEqual(f.requests[0].params.arguments, { name: "example.lookup" });
});

test("safe JSON-RPC errors retain IDs/uncertainty but do not copy remote messages or retry", async (t) => {
  const f = await fixture(t, (body, response) =>
    rpcError(response, body, "outcome_unknown", {
      invocationId,
      outcomeUnknown: true,
    }),
  );
  await assert.rejects(
    f.client.callTool("example.write", {}),
    (e: GatewayError) =>
      e.code === "outcome_unknown" &&
      e.invocationId === invocationId &&
      e.outcomeUnknown,
  );
  assert.equal(f.requests.length, 1);
  f.state.handler = (body, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32000,
          message: TEST_BEARER,
          data: { code: TEST_BEARER, invocationId: TEST_BEARER },
        },
      }),
    );
  };
  await assert.rejects(
    f.client.callTool("example.write", {}),
    (e: GatewayError) =>
      !JSON.stringify(e).includes(TEST_BEARER) &&
      !e.message.includes(TEST_BEARER),
  );
  assert.equal(f.requests.length, 2);
});

test("credential echoes in successful content and descriptors are redacted before leaving client", async (t) => {
  const f = await fixture(t, (body, response) =>
    reply(
      response,
      body,
      body.method === "tools/list"
        ? { tools: [{ ...tool(), description: TEST_BEARER }] }
        : {
            content: [{ type: "text", text: TEST_BEARER }],
            structuredContent: { secret: TEST_BEARER },
          },
    ),
  );
  assert.ok(!JSON.stringify(await f.client.listTools()).includes(TEST_BEARER));
  assert.ok(
    !JSON.stringify(await f.client.callTool("example.lookup", {})).includes(
      TEST_BEARER,
    ),
  );
});

test("transport failure, invalid JSON/envelope/content, and HTTP errors never replay calls", async (t) => {
  const f = await fixture(t);
  const responses = [
    "not json session expired",
    JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: {} }),
  ];
  for (const raw of responses) {
    f.state.handler = (_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(raw);
    };
    await assert.rejects(
      f.client.callTool("example.write", {}),
      (e: GatewayError) => e.outcomeUnknown,
    );
  }
  f.state.handler = (body, response) =>
    reply(response, body, { content: "bad" });
  await assert.rejects(
    f.client.callTool("example.write", {}),
    (e: GatewayError) => e.outcomeUnknown,
  );
  f.state.handler = (_body, response) => {
    response.destroy();
  };
  await assert.rejects(
    f.client.callTool("example.write", {}),
    (e: GatewayError) => e.outcomeUnknown,
  );
  f.state.handler = (_body, response) => {
    response.writeHead(401);
    response.end(TEST_BEARER);
  };
  await assert.rejects(
    f.client.callTool("example.write", {}),
    (e: GatewayError) =>
      e.code === "http_error" && !e.message.includes(TEST_BEARER),
  );
  assert.equal(f.requests.length, 5);
});

test("redirects never forward credentials to another endpoint", async (t) => {
  const target = await fixture(t);
  const source = await fixture(t, (_body, response) => {
    response.writeHead(307, { location: target.config.endpoint });
    response.end();
  });
  await assert.rejects(
    source.client.callTool("example.write", {}),
    (e: GatewayError) => e.outcomeUnknown,
  );
  assert.equal(source.requests.length, 1);
  assert.equal(target.requests.length, 0);
});

test("response body cap produces an explicit uncertain error instead of partial apparent success", async (t) => {
  const f = await fixture(t, (_body, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("x".repeat(MAX_RESPONSE_BYTES + 1));
  });
  await assert.rejects(
    f.client.callTool("example.write", {}),
    (e: GatewayError) => e.code === "resource_limit" && e.outcomeUnknown,
  );
  assert.equal(f.requests.length, 1);
});

test("cancellation, timeout, and shutdown settle without replay; pre-abort sends nothing", async (t) => {
  const f = await fixture(t, () => {});
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(f.client.callTool("example.write", {}, pre.signal));
  assert.equal(f.requests.length, 0);
  for (const kind of ["cancel", "timeout", "shutdown"]) {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    f.state.handler = () => {
      notifyStarted();
    };
    f.client.configure({
      ...f.config,
      callTimeoutMs: kind === "timeout" ? 80 : 2000,
    });
    const controller = new AbortController();
    const call = f.client.callTool("example.write", {}, controller.signal);
    const rejected = assert.rejects(
      call,
      (e: GatewayError) => e.code === "cancelled" && e.outcomeUnknown,
    );
    await started;
    if (kind === "cancel") controller.abort();
    if (kind === "shutdown") f.client.close();
    await rejected;
  }
  assert.equal(f.requests.length, 3);
});

test("page budget spans stale-cursor restart instead of granting another 100 pages", async (t) => {
  let pages = 0;
  const f = await fixture(t, (body, response) => {
    pages++;
    if (pages === 99) return rpcError(response, body, "stale_cursor");
    reply(
      response,
      body,
      pages === 101
        ? { tools: [] }
        : { tools: [], nextCursor: `page-${pages}` },
    );
  });
  await assert.rejects(
    f.client.listTools(),
    (e: GatewayError) => e.code === "resource_limit",
  );
  assert.equal(f.requests.length, 100);
  assert.equal(f.client.getCachedTools(), undefined);
});

test("aggregate byte budget includes discarded attempts and stops before parsing the over-budget body", async (t) => {
  let pages = 0;
  const padding = "x".repeat(12 * 1024 * 1024);
  const f = await fixture(t, (body, response) => {
    pages++;
    if (pages === 2) return rpcError(response, body, "stale_cursor");
    if (pages === 4) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(padding);
      return;
    }
    reply(response, body, { tools: [], padding, nextCursor: `page-${pages}` });
  });
  await assert.rejects(
    f.client.listTools(),
    (e: GatewayError) => e.code === "resource_limit",
  );
  assert.equal(f.requests.length, 4);
  assert.equal(f.client.getCachedTools(), undefined);
});

test("descriptor budget also spans stale-cursor restarts", async (t) => {
  let pages = 0;
  const tools = Array.from({ length: 6000 }, (_, index) =>
    tool(`example.tool_${index}`),
  );
  const f = await fixture(t, (body, response) => {
    pages++;
    if (pages === 2) return rpcError(response, body, "stale_cursor");
    reply(
      response,
      body,
      pages === 1 ? { tools, nextCursor: "next" } : { tools },
    );
  });
  await assert.rejects(
    f.client.listTools(),
    (e: GatewayError) => e.code === "resource_limit",
  );
  assert.equal(f.requests.length, 3);
  assert.equal(f.client.getCachedTools(), undefined);
});

test("malformed invocation IDs are discarded rather than exposed as correlation evidence", async (t) => {
  const f = await fixture(t);
  for (const invalid of [
    "e1293036-d6fd-4c97-8eed-e195910230f7",
    "81ARZ3NDEKTSV4RRFFQ69G5FAV",
    "01ARZ3NDEKTSV4RRFFQ69G5FAI",
    invocationId.toLowerCase(),
    `${invocationId}\n`,
  ]) {
    f.state.handler = (body, response) =>
      rpcError(response, body, "call_rejected", { invocationId: invalid });
    await assert.rejects(
      f.client.callTool("example.write", {}),
      (e: GatewayError) =>
        e.code === "call_rejected" && e.invocationId === undefined,
    );
  }
});
