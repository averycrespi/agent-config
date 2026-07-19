import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_GRANTS, resolveCapabilities } from "./capabilities.ts";

const cases = [
  ["read-filesystem", ["read", "ls", "find", "grep"], [], {}],
  ["exec-shell", ["bash"], [], {}],
  [
    "read-broker",
    ["mcp_search", "mcp_describe", "mcp_call", "read"],
    ["mcp-broker"],
    { MCP_BROKER_READONLY: "1", MCP_BROKER_APPROVAL_MODE: "reject" },
  ],
  ["read-web", ["web_search", "web_fetch", "read"], ["web-access"], {}],
] as const;

for (const [capability, tools, extensions, env] of cases) {
  test(`${capability} grants its exact dependency-complete policy`, () => {
    assert.deepEqual(CAPABILITY_GRANTS[capability].tools, tools);
    assert.deepEqual(resolveCapabilities([capability]), {
      tools: [...tools],
      extensions: [...extensions],
      env,
    });
  });
}

test("capability unions follow catalog order and deduplicate dependencies", () => {
  assert.deepEqual(
    resolveCapabilities([
      "read-web",
      "read-filesystem",
      "read-web",
      "read-broker",
    ]),
    {
      tools: [
        "read",
        "ls",
        "find",
        "grep",
        "mcp_search",
        "mcp_describe",
        "mcp_call",
        "web_search",
        "web_fetch",
      ],
      extensions: ["mcp-broker", "web-access"],
      env: {
        MCP_BROKER_READONLY: "1",
        MCP_BROKER_APPROVAL_MODE: "reject",
      },
    },
  );
});

test("empty capabilities produce a no-tools policy", () => {
  assert.deepEqual(resolveCapabilities([]), {
    tools: [],
    extensions: [],
    env: {},
  });
});
