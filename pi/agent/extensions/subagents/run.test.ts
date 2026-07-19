import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { DEFAULT_SUBAGENTS_CONFIG } from "./config.ts";
import {
  _loadConfig,
  _spawnSubagent,
  _thinkingLevels,
  resolveSubagentRequest,
  runSubagent,
  type RunSubagentRequest,
} from "./run.ts";

const model = { provider: "p", id: "m", reasoning: true };
const config = {
  ...DEFAULT_SUBAGENTS_CONFIG,
  modelTierSmall: "p/m",
  modelTierMedium: "p/m",
  modelTierLarge: "p/m",
};
const request = (
  overrides: Partial<RunSubagentRequest> = {},
): RunSubagentRequest => ({
  intent: "Inspect",
  prompt: "Inspect policy",
  capabilities: ["read-broker", "read-web"],
  modelTier: "medium",
  thinking: "high",
  cwd: "/repo",
  modelRegistry: { find: () => model },
  ...overrides,
});

function okOutcome() {
  return {
    ok: true,
    aborted: false,
    stdout: "ok",
    stderr: "",
    exitCode: 0,
    signal: null,
  } as const;
}

test("resolver creates an internal invocation from central policy", () => {
  mock.method(_thinkingLevels, "fn", () => ["low", "medium", "high"]);
  try {
    const result = resolveSubagentRequest(request(), config);
    assert.deepEqual(result.errors, []);
    assert.equal(result.prepared?.modelSelector, "p/m");
    assert.deepEqual(result.prepared?.invocation.toolAllowlist, [
      "mcp_search",
      "mcp_describe",
      "mcp_call",
      "read",
      "web_search",
      "web_fetch",
    ]);
    assert.deepEqual(result.prepared?.invocation.extensionAllowlist, [
      "mcp-broker",
      "web-access",
    ]);
    assert.deepEqual(result.prepared?.invocation.env, {
      MCP_BROKER_READONLY: "1",
      MCP_BROKER_APPROVAL_MODE: "reject",
    });
    assert.equal(result.prepared?.invocation.inheritSession, "none");
    assert.equal("systemPrompt" in result.prepared!.invocation, false);
    assert.equal("disableSkills" in result.prepared!.invocation, false);
  } finally {
    mock.restoreAll();
  }
});

test("resolver fails closed for unknown, disallowed, missing-model, and unsupported values", () => {
  mock.method(_thinkingLevels, "fn", () => ["low"]);
  try {
    const result = resolveSubagentRequest(
      request({
        intent: " ",
        prompt: " ",
        capabilities: ["read-web", "unknown" as any],
        modelTier: "large",
        thinking: "high",
        modelRegistry: { find: () => undefined },
      }),
      {
        ...config,
        allowedCapabilities: ["read-filesystem"],
      },
    );
    const errors = result.errors.join("\n");
    assert.match(errors, /intent is required/);
    assert.match(errors, /prompt is required/);
    assert.match(errors, /globally disallowed/);
    assert.match(errors, /unknown capability/);
    assert.match(errors, /could not be resolved/);
    assert.equal(result.prepared, undefined);
  } finally {
    mock.restoreAll();
  }
});

test("resolver honors runtime-supported max across the development type gap", () => {
  const maxModel = { ...model, thinkingLevelMap: { max: "max" } };
  assert.ok(_thinkingLevels.fn(maxModel).includes("max"));
  const result = resolveSubagentRequest(
    request({
      thinking: "max",
      modelRegistry: { find: () => maxModel },
    }),
    { ...config, allowedThinkingLevels: ["max"] },
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.prepared?.thinking, "max");
});

test("runSubagent validates before launching and forwards only normalized authority", async () => {
  let launches = 0;
  let invocation: any;
  mock.method(_loadConfig, "fn", async () => config);
  mock.method(_thinkingLevels, "fn", () => ["low", "medium", "high"]);
  mock.method(_spawnSubagent, "fn", async (value: any) => {
    launches += 1;
    invocation = value;
    return okOutcome();
  });
  try {
    const invalid = await runSubagent(
      request({ capabilities: ["bad" as any] }),
    );
    assert.equal(invalid.ok, false);
    assert.match(invalid.errorMessage!, /policy validation failed/);
    assert.equal(launches, 0);

    const output = { schema: { type: "string" } };
    const valid = await runSubagent(request({ output, capabilities: [] }));
    assert.equal(valid.ok, true);
    assert.equal(launches, 1);
    assert.deepEqual(invocation.toolAllowlist, []);
    assert.deepEqual(invocation.extensionAllowlist, []);
    assert.equal(invocation.model, "p/m");
    assert.equal(invocation.thinking, "high");
    assert.equal(invocation.output, output);
  } finally {
    mock.restoreAll();
  }
});

test("public API omits raw spawner and invocation exports", async () => {
  const api = await import("./api.ts");
  assert.equal(typeof api.runSubagent, "function");
  assert.equal("spawnSubagent" in api, false);
  assert.equal("loadAgents" in api, false);
  assert.equal("SpawnInvocation" in api, false);
});
