import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createWorkflowRunLedger } from "./ledger.ts";
import { parseWorkflowScript } from "./parser.ts";
import {
  _runSubagent,
  createWorkflowAgentSpawner,
  runWorkflow,
} from "./runtime.ts";
import type { WorkflowAgentRequest } from "./types.ts";

const POLICY = `intent: "test run", capabilities: [], modelTier: "medium", thinking: "high"`;
const registry = { find: () => ({ provider: "p", id: "m", reasoning: true }) };

function script(body: string) {
  return parseWorkflowScript(
    `export const meta = { name: "test", description: "test" };\n${body}`,
  );
}
function request(
  overrides: Partial<WorkflowAgentRequest> = {},
): WorkflowAgentRequest {
  return {
    id: 1,
    prompt: "inspect",
    intent: "inspect repository",
    capabilities: ["read-filesystem"],
    modelTier: "medium",
    thinking: "high",
    ...overrides,
  };
}
function successfulOutcome(stdout = "ok") {
  return {
    ok: true as const,
    aborted: false,
    stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
  };
}

test("runtime preserves args, phases, logs, bounded parallelism, and pipeline ordering", async () => {
  let active = 0;
  let maximum = 0;
  const result = await runWorkflow(
    script(`export async function run() {
      phase("fanout");
      log(args.topic);
      const values = await parallel([
        () => agent("a", { ${POLICY} }),
        () => agent("b", { ${POLICY} }),
        () => agent("c", { ${POLICY} }),
      ], { concurrency: 2 });
      return await pipeline(values, (value) => value + "!", (value, index) => index + ":" + value);
    }`),
    {
      cwd: "/tmp",
      args: { topic: "hello" },
      maxConcurrency: 2,
      spawnAgent: async (value) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { ok: true, text: value.prompt.toUpperCase() };
      },
    },
  );
  assert.deepEqual(result.result, ["0:A!", "1:B!", "2:C!"]);
  assert.deepEqual(result.phases, ["fanout"]);
  assert.equal(result.logs[0].message, "hello");
  assert.equal(maximum, 2);
});

test("agent requires explicit intent, capabilities, tier, and thinking", async () => {
  for (const options of [
    `capabilities: [], modelTier: "medium", thinking: "high"`,
    `intent: "x", modelTier: "medium", thinking: "high"`,
    `intent: "x", capabilities: [], thinking: "high"`,
    `intent: "x", capabilities: [], modelTier: "medium"`,
  ]) {
    await assert.rejects(
      runWorkflow(
        script(
          `export async function run() { return await agent("x", { ${options} }); }`,
        ),
        {
          cwd: "/tmp",
          spawnAgent: async () => ({ ok: true, text: "unexpected" }),
        },
      ),
      /agent (intent|capabilities|modelTier|thinking)/,
    );
  }
});

test("verify requires the same explicit execution policy and remains a strict verdict helper", async () => {
  await assert.rejects(
    runWorkflow(
      script(
        `export async function run() { return await verify("claim", { intent: "verify" }); }`,
      ),
      {
        cwd: "/tmp",
        spawnAgent: async () => ({ ok: true, text: "unexpected" }),
      },
    ),
    /agent capabilities/,
  );

  const calls: any[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      return await verify("The tests pass", {
        intent: "verify tests",
        capabilities: ["read-filesystem"],
        modelTier: "large",
        thinking: "high",
        context: { suite: "unit" },
        retries: 1,
        timeoutMs: 1234,
      });
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (value) => {
        calls.push(value);
        return {
          ok: true,
          text: null,
          hasStructured: true,
          value: { confirmed: true, reasons: ["unit evidence"] },
        };
      },
    },
  );
  assert.deepEqual(result.result, { ok: true, reasons: ["unit evidence"] });
  assert.equal(calls[0].intent, "verify tests");
  assert.deepEqual(calls[0].capabilities, ["read-filesystem"]);
  assert.equal(calls[0].modelTier, "large");
  assert.equal(calls[0].thinking, "high");
  assert.equal(calls[0].retries, 1);
  assert.equal(calls[0].timeoutMs, 1234);
  assert.deepEqual(calls[0].output.schema.required, ["confirmed", "reasons"]);
  assert.equal(calls[0].output.schema.additionalProperties, false);
  assert.match(calls[0].prompt, /The tests pass/);
  assert.match(calls[0].prompt, /{"suite":"unit"}/);
  assert.equal("agent" in calls[0], false);
  assert.equal("model" in calls[0], false);
});

test("runtime forwards structured output values and preserves explicit policy", async () => {
  const calls: any[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      return await agent("find auth files", {
        intent: "find auth",
        capabilities: ["read-filesystem"],
        modelTier: "medium",
        thinking: "high",
        output: { schema: { type: "object", required: ["files"], properties: { files: { type: "array", items: { type: "string" } } } } },
      });
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (value) => {
        calls.push(value);
        return {
          ok: true,
          text: "fallback",
          hasStructured: true,
          value: { files: ["src/auth.ts"] },
        };
      },
    },
  );
  assert.deepEqual(result.result, { files: ["src/auth.ts"] });
  assert.equal(calls[0].intent, "find auth");
  assert.deepEqual(calls[0].capabilities, ["read-filesystem"]);
  assert.equal(calls[0].modelTier, "medium");
  assert.equal(calls[0].thinking, "high");
});

test("unsupported structured schemas fail before spawn", async () => {
  let spawns = 0;
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallelSettled([() => agent("go", {
        ${POLICY},
        output: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } },
      })]);
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async () => {
        spawns += 1;
        return { ok: true, text: "unexpected" };
      },
    },
  );
  assert.equal(spawns, 0);
  assert.equal((result.result as any)[0].error.code, "agent_policy_rejected");
  assert.match((result.result as any)[0].error.message, /oneOf is unsupported/);
});

test("retries are bounded and activity accounting keeps attempts distinct", async () => {
  let calls = 0;
  const result = await runWorkflow(
    script(`export async function run() {
      return await agent("flaky", { ${POLICY}, retries: 2 });
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async () => {
        calls += 1;
        return calls < 3
          ? {
              ok: false,
              text: null,
              error: "temporary",
              errorCode: "subagent_failed",
            }
          : { ok: true, text: "recovered" };
      },
    },
  );
  assert.equal(result.result, "recovered");
  assert.equal(calls, 3);
});

test("per-agent timeout aborts an attempt and returns a structured failure", async () => {
  let sawAbort = false;
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallelSettled([() => agent("slow", { ${POLICY}, timeoutMs: 5 })]);
    }`),
    {
      cwd: "/tmp",
      agentTimeoutMs: 100,
      spawnAgent: async (value) => {
        await new Promise<void>((resolve) => {
          value.signal?.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        return {
          ok: false,
          text: null,
          error: "aborted",
          errorCode: "subagent_aborted",
        };
      },
    },
  );
  assert.equal(sawAbort, true);
  assert.equal((result.result as any)[0].error.code, "agent_timeout");
});

test("workflow cancellation stops admission and returns an abort diagnostic", async () => {
  const controller = new AbortController();
  const pending = runWorkflow(
    script(
      `export async function run() { return await agent("slow", { ${POLICY} }); }`,
    ),
    {
      cwd: "/tmp",
      signal: controller.signal,
      spawnAgent: async (value) => {
        await new Promise<void>((resolve) =>
          value.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        return {
          ok: false,
          text: null,
          error: "aborted",
          errorCode: "subagent_aborted",
        };
      },
    },
  );
  controller.abort();
  await assert.rejects(pending, (error: any) => {
    assert.equal(error.code, "workflow_aborted");
    return true;
  });
});

test("ledger run cap denies later calls without invoking the spawner", async () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 0, maxAgents: 1 });
  let calls = 0;
  const spawn = createWorkflowAgentSpawner({
    cwd: "/repo",
    logId: "workflow",
    modelRegistry: registry,
    ledger,
  });
  mock.method(_runSubagent, "fn", async () => {
    calls += 1;
    return successfulOutcome();
  });
  try {
    assert.equal((await spawn(request({ id: 1 }))).ok, true);
    const denied = await spawn(request({ id: 2 }));
    assert.equal(denied.ok, false);
    assert.equal(denied.errorCode, "workflow_run_cap_exceeded");
    assert.equal(calls, 1);
  } finally {
    mock.restoreAll();
  }
});

test("workflow spawner calls sanitized API and publishes intent-first metadata", async () => {
  const calls: any[] = [];
  const updates: any[] = [];
  mock.method(_runSubagent, "fn", async (value: any) => {
    calls.push(value);
    value.onEvent?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: "done",
        usage: { totalTokens: 7 },
      },
    });
    return {
      ...successfulOutcome("fallback"),
      structured: { ok: true, value: { answer: 42 } },
      logFile: "/tmp/subagent.log",
    };
  });
  try {
    const spawn = createWorkflowAgentSpawner({
      cwd: "/repo",
      logId: "workflow",
      modelRegistry: registry,
      onAgentUpdate: (value) => updates.push(value),
    });
    const response = await spawn(
      request({
        capabilities: ["read-web"],
        modelTier: "large",
        output: { schema: { type: "object" } },
      }),
    );
    assert.equal(response.ok, true);
    assert.deepEqual(response.value, { answer: 42 });
    assert.equal(calls[0].intent, "inspect repository");
    assert.deepEqual(calls[0].capabilities, ["read-web"]);
    assert.equal(calls[0].modelTier, "large");
    assert.equal(calls[0].thinking, "high");
    assert.equal(calls[0].modelRegistry, registry);
    assert.equal("agent" in calls[0], false);
    assert.equal("model" in calls[0], false);
    const latest = updates.at(-1);
    assert.equal(latest.intent, "inspect repository");
    assert.deepEqual(latest.capabilities, ["read-web"]);
    assert.equal(latest.activity.modelTier, "large");
    assert.equal(latest.activity.totalTokens, 7);
  } finally {
    mock.restoreAll();
  }
});

test("workflow spawner preserves provider, cancellation, log, and diagnostic failures", async () => {
  mock.method(_runSubagent, "fn", async () => ({
    ok: false,
    aborted: false,
    stdout: "",
    stderr: "provider failed",
    exitCode: 1,
    signal: null,
    errorMessage: "provider failed",
    errorCode: "provider_error" as const,
    logFile: "/tmp/failure.log",
    diagnosticWarnings: ["warning"],
  }));
  try {
    const spawn = createWorkflowAgentSpawner({
      cwd: "/repo",
      logId: "workflow",
      modelRegistry: registry,
    });
    const response = await spawn(request());
    assert.equal(response.ok, false);
    assert.equal(response.errorCode, "provider_error");
    assert.equal(response.errorDetails?.logFile, "/tmp/failure.log");
    assert.deepEqual(response.errorDetails?.diagnosticWarnings, ["warning"]);
  } finally {
    mock.restoreAll();
  }
});

test("report gates terminate with pass or structured rejection", async () => {
  const passed = await runWorkflow(
    script(`export async function run() {
      if (false) await agent("unused", { ${POLICY} });
      const value = { answer: 42 };
      return await report(value, { gate: () => ({ ok: value.answer === 42 }) });
    }`),
    { cwd: "/tmp", spawnAgent: async () => ({ ok: true, text: "unused" }) },
  );
  assert.deepEqual(passed.result, { answer: 42 });

  await assert.rejects(
    runWorkflow(
      script(
        `export async function run() { if (false) await agent("unused", { ${POLICY} }); return await report("bad", { gate: () => ({ ok: false, reasons: ["unsafe"] }) }); }`,
      ),
      { cwd: "/tmp", spawnAgent: async () => ({ ok: true, text: "unused" }) },
    ),
    (error: any) => {
      assert.equal(error.code, "workflow_report_rejected");
      assert.deepEqual(error.details, { reasons: ["unsafe"] });
      return true;
    },
  );
});
