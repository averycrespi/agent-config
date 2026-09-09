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
  prepareSpawnAgentsArguments,
  runParallelSpawn,
  validateSpawnAgentSpecs,
} from "./index.ts";
import { DEFAULT_SUBAGENTS_CONFIG, type SubagentsConfig } from "./config.ts";
import { _resolveExtensions } from "./run.ts";
import { createConcurrencyGate } from "./pool.ts";
import { buildSpawnAgentsParams, type SpawnAgentItem } from "./types.ts";

const config: SubagentsConfig = {
  ...DEFAULT_SUBAGENTS_CONFIG,
  profileFastModel: "test/model",
  profileBalancedModel: "test/model",
  profileStrongModel: "test/model",
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
  profile: "balanced",
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
    "model_tier",
    "thinking",
    "env",
    "skills",
    "templates",
  ]) {
    assert.equal(field in properties, false);
  }
});

test("legacy direct calls migrate tier names to configured profiles", () => {
  assert.deepEqual(
    prepareSpawnAgentsArguments({
      agents: [
        {
          intent: "old",
          prompt: "old prompt",
          capabilities: [],
          model_tier: "small",
          thinking: "xhigh",
        },
      ],
    }),
    {
      agents: [
        {
          intent: "old",
          prompt: "old prompt",
          capabilities: [],
          profile: "fast",
        },
      ],
    },
  );
});

test("delegation guidance documents explicit policy without named agents", () => {
  const guidance = buildDelegationGuidance(config);
  assert.match(guidance, /capabilities: \[\] is valid/);
  assert.match(guidance, /fast, balanced, strong/);
  assert.match(guidance, /read-filesystem/);
  assert.match(guidance, /write-filesystem/);
  assert.doesNotMatch(
    guidance,
    /test\/model|agent definition|explorer|reviewer/,
  );
  assert.match(buildPolicyDescription(config), /fast, balanced, strong/);
  assert.doesNotMatch(buildPolicyDescription(config), /test\/model/);
});

test("delegation guidance requires benefit, ownership, and evidence-bearing briefs", () => {
  const guidance = buildDelegationGuidance(config);
  assert.match(guidance, /self-contained question when parallelism/);
  assert.match(
    guidance,
    /File count, task category, and read-only status alone do not justify delegation/,
  );
  assert.match(
    guidance,
    /Keep implementation and fixes in the owning session by default/,
  );
  assert.match(guidance, /only when explicitly requested by the user/);
  assert.match(
    guidance,
    /explicit execution workflow with bounded scope, one writer/,
  );
  assert.match(guidance, /structured handoff, and independent verification/);
  assert.match(guidance, /Never overlap parent or child writes/);
  for (const requirement of [
    "scope boundaries",
    "relevant context and decisions",
    "authoritative source paths",
    "explicit capabilities and profile",
    "evidence-bearing deliverable with uncertainties",
    "stop condition",
    "parent owns synthesis and checks consequential claims",
  ])
    assert.ok(guidance.includes(requirement), requirement);
  assert.doesNotMatch(guidance, /reading more than a few files|Delegate when:/);
});

test("delegation guidance distinguishes simple batches from workflow orchestration", () => {
  const guidance = buildDelegationGuidance(config);
  assert.match(
    guidance,
    /prefer spawn_agents for a one-shot independent batch/,
  );
  assert.match(guidance, /owning session will synthesize/);
  assert.match(
    guidance,
    /Use workflow when an applicable saved workflow or explicit orchestration/,
  );
  assert.match(
    guidance,
    /dependent phases, programmatic aggregation, or verification gates/,
  );
  assert.match(
    guidance,
    /Parallelism or structured output alone does not require workflow/,
  );
  assert.match(guidance, /Preserve skill-required workflows/);
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
        profile: "missing" as any,
        files: ["", "missing.txt"],
        output_schema: { type: "wat" },
      }),
    ],
    {
      ...config,
      allowedCapabilities: ["read-filesystem"],
    },
    { ...ctx, modelRegistry: { find: () => undefined } },
  );
  const joined = errors.join("\n");
  assert.match(joined, /intent is required/);
  assert.match(joined, /prompt is required/);
  assert.match(joined, /globally disallowed/);
  assert.match(joined, /unknown capability/);
  assert.match(joined, /profile must be one of/);
  assert.match(joined, /files\[0\]/);
  assert.match(joined, /files\[1\]/);
  assert.match(joined, /output_schema/);
});

test("preflight requires mutable capabilities to run as a single agent", async () => {
  const errors = await validateSpawnAgentSpecs(
    [
      valid({ capabilities: ["read-filesystem", "write-filesystem"] }),
      valid({ intent: "Concurrent reader" }),
    ],
    config,
    ctx,
  );
  assert.match(
    errors.join("\n"),
    /mutable capabilities require exactly one agent/,
  );
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

test("separate mutable spawn calls share an exclusive gate", async () => {
  let active = 0;
  let maximum = 0;
  mock.method(_runSubagent, "fn", async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return okOutcome();
  });
  try {
    const directGate = createConcurrencyGate(2);
    const mutableGate = createConcurrencyGate(1);
    await Promise.all([
      runParallelSpawn(
        [valid({ capabilities: ["write-filesystem"] })],
        config,
        ctx,
        "write-a",
        undefined,
        directGate,
        mutableGate,
      ),
      runParallelSpawn(
        [valid({ capabilities: ["exec-shell"] })],
        config,
        ctx,
        "write-b",
        undefined,
        directGate,
        mutableGate,
      ),
    ]);
    assert.equal(maximum, 1);
  } finally {
    mock.restoreAll();
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
    extension === "mcp-gateway" ? [] : [`/extensions/${extension}`],
  );
  try {
    const result = await runParallelSpawn(
      [valid(), valid({ intent: "MCP lookup", capabilities: ["read-mcp"] })],
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
      /required capability extension is unavailable: mcp-gateway/,
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
        profile: "strong",
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
    assert.equal(calls[0].profile, "balanced");
    assert.equal("thinking" in calls[0], false);
    assert.equal("agent" in calls[0], false);
    assert.equal("model" in calls[0], false);
    assert.deepEqual(calls[1].capabilities, []);
    assert.match(result.content[0]!.text, /^## Filesystem audit/m);
    assert.match(result.content[0]!.text, /no capabilities · strong/);
    assert.equal(result.details.allOk, true);
    const agents = result.details.agents as any[];
    assert.equal(agents[0].intent, "Filesystem audit");
    assert.deepEqual(agents[0].capabilities, ["read-filesystem"]);
    assert.equal(agents[0].profile, "balanced");
    assert.equal("thinking" in agents[0], false);
    assert.ok(updates.length >= 2);
  } finally {
    mock.restoreAll();
  }
});

test("parallel spawn returns combined nested model usage including failed children", async () => {
  mock.method(_runSubagent, "fn", async (request: any) => {
    request.onEvent?.({
      type: "message_end",
      message: {
        role: "assistant",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 1,
          cacheWrite1h: 1,
          reasoning: 3,
          totalTokens: 18,
          cost: {
            input: 0.1,
            output: 0.2,
            cacheRead: 0.03,
            cacheWrite: 0.04,
            total: 0.37,
          },
        },
      },
    });
    return request.intent === "Second"
      ? {
          ...okOutcome(),
          ok: false,
          exitCode: 1,
          errorMessage: "child failed after model usage",
        }
      : okOutcome();
  });
  try {
    const result = await runParallelSpawn(
      [valid({ intent: "First" }), valid({ intent: "Second" })],
      config,
      ctx,
      "call",
      undefined,
      createConcurrencyGate(2),
    );

    assert.deepEqual((result as any).usage, {
      input: 20,
      output: 10,
      cacheRead: 4,
      cacheWrite: 2,
      cacheWrite1h: 2,
      reasoning: 6,
      totalTokens: 36,
      cost: {
        input: 0.2,
        output: 0.4,
        cacheRead: 0.06,
        cacheWrite: 0.08,
        total: 0.74,
      },
    });
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
