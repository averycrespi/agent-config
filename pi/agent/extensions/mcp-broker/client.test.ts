import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrokerClient,
  extractProviders,
  filterReadOnly,
  isReadOnly,
  type BrokerTool,
} from "./client.ts";

function tool(name: string): BrokerTool {
  return { name };
}

test("extractProviders splits on the first '.' to derive namespaces", () => {
  assert.deepEqual(
    extractProviders([tool("github.create_pr"), tool("git.git_push")]),
    ["git", "github"],
  );
});

test("extractProviders dedupes namespaces that appear multiple times", () => {
  assert.deepEqual(
    extractProviders([
      tool("github.create_pr"),
      tool("github.list_prs"),
      tool("github.merge_pr"),
    ]),
    ["github"],
  );
});

test("extractProviders returns namespaces sorted alphabetically", () => {
  assert.deepEqual(
    extractProviders([tool("zzz.a"), tool("aaa.b"), tool("mmm.c")]),
    ["aaa", "mmm", "zzz"],
  );
});

test("extractProviders ignores tools with no namespace separator", () => {
  assert.deepEqual(
    extractProviders([tool("noDot"), tool("github.create_pr")]),
    ["github"],
  );
});

test("extractProviders skips tools whose name starts with '.' (no namespace)", () => {
  assert.deepEqual(extractProviders([tool(".foo")]), []);
});

test("extractProviders handles an empty tool list", () => {
  assert.deepEqual(extractProviders([]), []);
});

test("extractProviders uses only the prefix before the first '.'", () => {
  assert.deepEqual(extractProviders([tool("ns.sub.deep_tool")]), ["ns"]);
});

// --- isReadOnly ---

test("isReadOnly returns true only when readOnlyHint is strictly true", () => {
  assert.equal(
    isReadOnly({ name: "t", annotations: { readOnlyHint: true } }),
    true,
  );
});

test("isReadOnly returns false when readOnlyHint is false", () => {
  assert.equal(
    isReadOnly({ name: "t", annotations: { readOnlyHint: false } }),
    false,
  );
});

test("isReadOnly returns false when readOnlyHint is the string 'true'", () => {
  assert.equal(
    isReadOnly({
      name: "t",
      annotations: { readOnlyHint: "true" as unknown as boolean },
    }),
    false,
  );
});

test("isReadOnly returns false when annotations is present but readOnlyHint is absent", () => {
  assert.equal(isReadOnly({ name: "t", annotations: {} }), false);
});

test("isReadOnly returns false when annotations is absent", () => {
  assert.equal(isReadOnly({ name: "t" }), false);
});

// --- filterReadOnly ---

test("filterReadOnly keeps only tools with readOnlyHint === true", () => {
  const tools: BrokerTool[] = [
    { name: "read.a", annotations: { readOnlyHint: true } },
    { name: "write.b", annotations: { readOnlyHint: false } },
    { name: "write.c", annotations: {} },
    { name: "write.d" },
    {
      name: "write.e",
      annotations: { readOnlyHint: "true" as unknown as boolean },
    },
  ];
  assert.deepEqual(filterReadOnly(tools), [
    { name: "read.a", annotations: { readOnlyHint: true } },
  ]);
});

test("filterReadOnly returns all tools when all have readOnlyHint === true", () => {
  const tools: BrokerTool[] = [
    { name: "a.read", annotations: { readOnlyHint: true } },
    { name: "b.read", annotations: { readOnlyHint: true } },
  ];
  assert.deepEqual(filterReadOnly(tools), tools);
});

test("filterReadOnly returns empty array when no tools pass", () => {
  const tools: BrokerTool[] = [
    { name: "write.a" },
    { name: "write.b", annotations: { readOnlyHint: false } },
  ];
  assert.deepEqual(filterReadOnly(tools), []);
});

test("filterReadOnly preserves annotations on kept tools", () => {
  const tool: BrokerTool = {
    name: "search.query",
    annotations: { readOnlyHint: true, idempotentHint: true },
  };
  const result = filterReadOnly([tool]);
  assert.deepEqual(result[0]?.annotations, {
    readOnlyHint: true,
    idempotentHint: true,
  });
});

test("BrokerClient.listTools times out stalled broker operations", async () => {
  const client = new BrokerClient({ networkTimeoutMs: 5 });
  (client as any).client = {
    listTools: () => new Promise(() => {}),
    close: async () => {},
  };

  await assert.rejects(() => client.listTools(), /timed out after 5ms/);
  assert.equal((client as any).cachedTools, null);
  assert.equal((client as any).cachedProviders, null);
});

test("BrokerClient.listTools invalidates stale cache and retries once", async () => {
  const client = new BrokerClient({ networkTimeoutMs: 5 });
  const calls: string[] = [];
  (client as any).cachedTools = [{ name: "old.tool" }];
  (client as any).cachedProviders = ["old"];
  (client as any).fetchTools = async () => {
    calls.push("fetch");
    if (calls.length === 1) throw new Error("broker unreachable");
    return [{ name: "github.gh_list_prs" }];
  };

  const tools = await client.listTools();

  assert.deepEqual(tools, [{ name: "github.gh_list_prs" }]);
  assert.deepEqual(calls, ["fetch", "fetch"]);
  assert.deepEqual((client as any).cachedTools, [
    { name: "github.gh_list_prs" },
  ]);
  assert.deepEqual((client as any).cachedProviders, ["github"]);
});

test("BrokerClient.close closes the live MCP client and clears caches", async () => {
  const closed: string[] = [];
  const client = new BrokerClient();

  (client as any).client = {
    close: async () => {
      closed.push("client");
    },
  };
  (client as any).cachedTools = [{ name: "github.gh_list_prs" }];
  (client as any).cachedProviders = ["github"];

  await (client as any).close();

  assert.deepEqual(closed, ["client"]);
  assert.equal((client as any).client, null);
  assert.equal((client as any).cachedTools, null);
  assert.equal((client as any).cachedProviders, null);
});
