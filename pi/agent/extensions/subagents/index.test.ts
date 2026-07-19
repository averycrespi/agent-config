import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import {
  _runSubagent,
  buildDelegationGuidance,
  buildPolicyDescription,
  createSubagentsConfigReloader,
  runParallelSpawn,
  validateSpawnAgentSpecs,
} from "./index.ts";
import { DEFAULT_SUBAGENTS_CONFIG, type SubagentsConfig } from "./config.ts";
import { _resolveExtensions } from "./run.ts";
import { createConcurrencyGate } from "./pool.ts";
import { buildSpawnAgentsParams, type SpawnAgentItem } from "./types.ts";

const config: SubagentsConfig = {
  ...DEFAULT_SUBAGENTS_CONFIG,
  modelTierSmall: "test/model",
  modelTierMedium: "test/model",
  modelTierLarge: "test/model",
};
const model = {
  provider: "test",
  id: "model",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};
const ctx = {
  cwd: process.cwd(),
  modelRegistry: { find: () => model },
  hasUI: false,
  ui: { setStatus() {}, setWidget() {} },
};
const valid = (overrides: Partial<SpawnAgentItem> = {}): SpawnAgentItem => ({
  intent: "Inspect policy",
  prompt: "Inspect the repository policy.",
  capabilities: ["read-filesystem"],
  model_tier: "medium",
  thinking: "high",
  ...overrides,
});

function okOutcome(stdout = "done") {
  return {
    ok: true,
    aborted: false,
    stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
  } as const;
}

test("direct schema rejects raw and legacy request fields", () => {
  const schema = buildSpawnAgentsParams("tiers") as any;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.agents.items.additionalProperties, false);
  const properties = schema.properties.agents.items.properties;
  for (const field of [
    "agent",
    "role",
    "preset",
    "tools",
    "extensions",
    "model",
    "env",
    "skills",
    "templates",
  ]) {
    assert.equal(field in properties, false);
  }
});

test("delegation guidance documents explicit policy without named agents", () => {
  const guidance = buildDelegationGuidance(config);
  assert.match(guidance, /capabilities: \[\] is valid/);
  assert.match(guidance, /small=test\/model/);
  assert.match(guidance, /medium=test\/model/);
  assert.match(guidance, /read-filesystem/);
  assert.doesNotMatch(guidance, /agent definition|explorer|reviewer/);
  assert.match(buildPolicyDescription(config), /large=test\/model/);
});

test("preflight accepts explicit empty capabilities", async () => {
  assert.deepEqual(
    await validateSpawnAgentSpecs([valid({ capabilities: [] })], config, ctx),
    [],
  );
});

test("preflight collects policy, file, and schema errors", async () => {
  const errors = await validateSpawnAgentSpecs(
    [
      valid({
        intent: " ",
        prompt: " ",
        capabilities: ["read-web", "unknown" as any],
        model_tier: "missing" as any,
        thinking: "max",
        files: ["", "missing.txt"],
        output_schema: { type: "wat" },
      }),
    ],
    {
      ...config,
      allowedCapabilities: ["read-filesystem"],
      allowedThinkingLevels: ["low", "medium", "high"],
    },
    { ...ctx, modelRegistry: { find: () => undefined } },
  );
  const joined = errors.join("\n");
  assert.match(joined, /intent is required/);
  assert.match(joined, /prompt is required/);
  assert.match(joined, /globally disallowed/);
  assert.match(joined, /unknown capability/);
  assert.match(joined, /modelTier must be one of/);
  assert.match(joined, /thinking level is globally disallowed/);
  assert.match(joined, /files\[0\]/);
  assert.match(joined, /files\[1\]/);
  assert.match(joined, /output_schema/);
});

test("preflight validates readable regular file attachments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-index-"));
  try {
    await writeFile(join(dir, "context.txt"), "context");
    assert.deepEqual(
      await validateSpawnAgentSpecs(
        [valid({ files: ["context.txt"] })],
        config,
        { ...ctx, cwd: dir },
      ),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parallel spawn is atomic when a required capability extension is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-extension-preflight-"));
  let calls = 0;
  mock.method(_runSubagent, "fn", async () => {
    calls += 1;
    return okOutcome();
  });
  mock.method(_resolveExtensions, "fn", async ([extension]: string[]) =>
    extension === "mcp-broker" ? [] : [`/extensions/${extension}`],
  );
  try {
    const result = await runParallelSpawn(
      [
        valid(),
        valid({ intent: "Broker lookup", capabilities: ["read-broker"] }),
      ],
      config,
      { ...ctx, cwd: dir },
      "call",
      undefined,
      createConcurrencyGate(2),
    );
    assert.equal(calls, 0);
    assert.equal(result.details.validationError, true);
    assert.match(
      result.content[0]!.text,
      /required capability extension is unavailable: mcp-broker/,
    );
  } finally {
    mock.restoreAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("parallel spawn is atomic when any item fails preflight", async () => {
  let calls = 0;
  mock.method(_runSubagent, "fn", async () => {
    calls += 1;
    return okOutcome();
  });
  try {
    const result = await runParallelSpawn(
      [valid(), valid({ capabilities: ["unknown" as any] })],
      config,
      ctx,
      "call",
      undefined,
      createConcurrencyGate(2),
    );
    assert.equal(calls, 0);
    assert.equal(result.details.validationError, true);
    assert.match(result.content[0]!.text, /unknown capability/);
  } finally {
    mock.restoreAll();
  }
});

test("parallel spawn forwards sanitized requests and returns intent-first metadata", async () => {
  const calls: any[] = [];
  mock.method(_runSubagent, "fn", async (request: any) => {
    calls.push(request);
    request.onEvent?.({
      type: "tool_execution_start",
      toolName: "read",
      args: { path: "/secret" },
    });
    request.onEvent?.({
      type: "tool_execution_end",
      toolName: "read",
      result: "secret content",
    });
    return okOutcome(`result ${calls.length}`);
  });
  try {
    const updates: any[] = [];
    const specs = [
      valid({ intent: "Filesystem audit" }),
      valid({
        intent: "No-tools synthesis",
        capabilities: [],
        model_tier: "large",
      }),
    ];
    const result = await runParallelSpawn(
      specs,
      config,
      ctx,
      "call",
      (update) => updates.push(update),
      createConcurrencyGate(2),
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].capabilities, ["read-filesystem"]);
    assert.equal(calls[0].modelTier, "medium");
    assert.equal(calls[0].thinking, "high");
    assert.equal("agent" in calls[0], false);
    assert.equal("model" in calls[0], false);
    assert.deepEqual(calls[1].capabilities, []);
    assert.match(result.content[0]!.text, /^## Filesystem audit/m);
    assert.match(result.content[0]!.text, /no capabilities · large\/high/);
    assert.equal(result.details.allOk, true);
    const agents = result.details.agents as any[];
    assert.equal(agents[0].intent, "Filesystem audit");
    assert.deepEqual(agents[0].capabilities, ["read-filesystem"]);
    assert.equal(agents[0].modelTier, "medium");
    assert.equal(agents[0].thinking, "high");
    assert.ok(updates.length >= 2);
  } finally {
    mock.restoreAll();
  }
});

test("parallel spawn preserves structured output contract", async () => {
  mock.method(_runSubagent, "fn", async () => ({
    ...okOutcome("prose"),
    structured: { ok: true, value: { answer: 42 } },
    logFile: "/tmp/subagent.log",
  }));
  try {
    const result = await runParallelSpawn(
      [
        valid({
          output_schema: {
            type: "object",
            additionalProperties: false,
            required: ["answer"],
            properties: { answer: { type: "number" } },
          },
        }),
      ],
      config,
      ctx,
      "call",
      undefined,
      createConcurrencyGate(1),
    );
    assert.deepEqual(result.details.structured, [
      { requested: true, ok: true, value: { answer: 42 } },
    ]);
    assert.equal(
      (result.details.agents as any[])[0].logFile,
      "/tmp/subagent.log",
    );
  } finally {
    mock.restoreAll();
  }
});

test("parallel spawn reports cancellation before launch", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runParallelSpawn(
    [valid()],
    config,
    { ...ctx, signal: controller.signal },
    "call",
    undefined,
    createConcurrencyGate(1),
  );
  assert.equal(result.details.failed, 1);
  assert.equal((result.details.agents as any[])[0].phase, "aborted");
});

test("config reloader applies only the latest completed generation", async () => {
  const limits: number[] = [];
  let resolveFirst!: (value: SubagentsConfig) => void;
  const first = new Promise<SubagentsConfig>(
    (resolve) => (resolveFirst = resolve),
  );
  let calls = 0;
  const reload = createSubagentsConfigReloader(
    { setLimit: (limit) => limits.push(limit) },
    async () => {
      calls += 1;
      return calls === 1 ? first : { ...config, maxConcurrency: 9 };
    },
  );
  const pending = reload("/a", []);
  await reload("/b", []);
  resolveFirst({ ...config, maxConcurrency: 2 });
  await pending;
  assert.deepEqual(limits, [9]);
});
