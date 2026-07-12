import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { parseWorkflowScript } from "./parser.ts";
import {
  createWorkflowAgentSpawner,
  _spawnSubagent,
  runWorkflow,
} from "./runtime.ts";
import type { AgentDefinition } from "../subagents/api.ts";
import { DEFAULT_TIMEOUT_MS } from "./types.ts";
import { createWorkflowRunLedger } from "./ledger.ts";

const readOnlyAgents: AgentDefinition[] = [
  {
    name: "explorer",
    description: "Explore",
    tools: ["read"],
    extensions: [],
    systemPrompt: "Explore only",
    disableSkills: true,
    disablePromptTemplates: true,
  },
];

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

function script(body: string) {
  return parseWorkflowScript(
    `export const meta = { name: "test", description: "test" };\n${body}`,
  );
}

test("runtime exposes args, phase, log, parallel ordering, and pipeline", async () => {
  const updates: any[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      phase("fanout");
      log(args.topic);
      const values = await parallel([
        () => agent("a"),
        () => agent("b"),
        () => agent("c"),
      ], { concurrency: 2 });
      return await pipeline(values, (value) => value + "!", (value, index) => index + ":" + value);
    }`),
    {
      cwd: "/tmp",
      args: { topic: "hello" },
      onUpdate: (s) => updates.push(s),
      spawnAgent: async (request) => ({
        ok: true,
        text: request.prompt.toUpperCase(),
      }),
    },
  );
  assert.deepEqual(result.result, ["0:A!", "1:B!", "2:C!"]);
  assert.deepEqual(result.phases, ["fanout"]);
  assert.equal(result.logs[0].message, "hello");
  assert.ok(updates.length > 0);
  assert.equal(updates[0].meta.name, "test");
  assert.equal(updates[0].phase, undefined);
  assert.deepEqual(updates[0].agents, []);
});

test("runtime defensively normalizes configured and per-call concurrency", async () => {
  async function observedMax(
    maxConcurrency: number | undefined,
    perCall: string,
    count = 20,
  ): Promise<number> {
    let active = 0;
    let maximum = 0;
    const thunks = Array.from(
      { length: count },
      (_, index) => `() => agent("${index}")`,
    ).join(",");
    await runWorkflow(
      script(`export async function run() {
        return await parallel([${thunks}], { concurrency: ${perCall} });
      }`),
      {
        cwd: "/tmp",
        maxConcurrency,
        spawnAgent: async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { ok: true, text: "ok" };
        },
      },
    );
    return maximum;
  }

  assert.equal(await observedMax(2, "20"), 2);
  assert.equal(await observedMax(99, "20"), 16);
  for (const value of [undefined, Number.NaN, 1.5, 0, -1]) {
    assert.equal(await observedMax(value, "20", 8), 4);
  }
  assert.equal(await observedMax(3, "1.5", 8), 3);
  assert.equal(await observedMax(3, "0", 8), 3);
});

test("runtime resolves agent calls with structured output values when requested", async () => {
  const requests: any[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      return await agent("find auth files", {
        agent: "explorer",
        intent: "auth",
        output: {
          schema: {
            type: "object",
            required: ["files"],
            properties: { files: { type: "array", items: { type: "string" } } },
          },
        },
      });
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (request) => {
        requests.push(request);
        return {
          ok: true,
          text: "fallback text",
          hasStructured: true,
          value: { files: ["src/auth.ts"] },
        } as any;
      },
    },
  );

  assert.deepEqual(result.result, { files: ["src/auth.ts"] });
  assert.deepEqual(requests[0].output, {
    schema: {
      type: "object",
      required: ["files"],
      properties: { files: { type: "array", items: { type: "string" } } },
    },
  });
});

test("verify defaults to reviewer and resolves structured verdicts", async () => {
  const requests: any[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      const confirmed = await verify("The tests pass", { context: { suite: "unit" } });
      const refuted = await verify("The sky is green", {
        agent: "analyst", intent: "check color", model: "small", retries: 2, timeoutMs: 1234
      });
      return { confirmed, refuted };
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (request) => {
        requests.push(request);
        return {
          ok: true,
          text: null,
          hasStructured: true,
          value:
            requests.length === 1
              ? { confirmed: true, reasons: ["unit evidence"] }
              : { confirmed: false, reasons: ["contradicted"] },
        };
      },
    },
  );

  assert.deepEqual(result.result, {
    confirmed: { ok: true, reasons: ["unit evidence"] },
    refuted: { ok: false, reasons: ["contradicted"] },
  });
  assert.equal(requests[0].agent, "reviewer");
  assert.equal(requests[0].intent, "Verify claim");
  assert.match(requests[0].prompt, /The tests pass/);
  assert.match(requests[0].prompt, /{"suite":"unit"}/);
  assert.deepEqual(requests[0].output.schema.required, [
    "confirmed",
    "reasons",
  ]);
  assert.equal(requests[0].output.schema.additionalProperties, false);
  assert.equal(requests[1].agent, "analyst");
  assert.equal(requests[1].intent, "check color");
  assert.equal(requests[1].model, "small");
  assert.equal(requests[1].retries, 2);
  assert.equal(requests[1].timeoutMs, 1234);
});

test("verify failures compose as ordinary agent failures", async () => {
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallelSettled([() => verify("claim")]);
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async () => ({
        ok: false,
        text: null,
        error: "structured verdict missing",
        errorCode: "structured_output_not_called",
      }),
    },
  );
  assert.deepEqual(result.result, [
    {
      ok: false,
      error: {
        code: "structured_output_not_called",
        message: "structured verdict missing",
        details: {
          code: "structured_output_not_called",
          message: "structured verdict missing",
          agentId: 1,
          intent: "Verify claim",
          logFile: undefined,
        },
      },
    },
  ]);
});

test("report awaits gates, returns original values, and normalizes rejections", async () => {
  const result = await runWorkflow(
    script(`export async function run() {
      if (false) await verify("parser marker");
      const first = { answer: 42 };
      const accepted = await report(first, { gate: async (value) => value.answer === 42 });
      const acceptedObject = await report("ok", { gate: async () => ({ ok: true }) });
      const rejected = await parallelSettled([
        () => report("bad", { gate: async () => ({ ok: false, reasons: ["wrong", 7, "unsafe"] }) }),
        () => report("boom", { gate: async () => { throw new Error("gate exploded"); } }),
      ]);
      return { same: accepted === first, acceptedObject, rejected };
    }`),
    { cwd: "/tmp", spawnAgent: async () => ({ ok: true, text: "unused" }) },
  );

  assert.equal((result.result as any).same, true);
  assert.equal((result.result as any).acceptedObject, "ok");
  assert.deepEqual((result.result as any).rejected, [
    {
      ok: false,
      error: {
        code: "workflow_report_rejected",
        message: "workflow report rejected: wrong; unsafe",
        details: { reasons: ["wrong", "unsafe"] },
      },
    },
    {
      ok: false,
      error: { code: "workflow_script_error", message: "gate exploded" },
    },
  ]);
});

test("workflow agent spawner returns structured values from spawn outcomes", async () => {
  const agents: AgentDefinition[] = [
    {
      name: "explorer",
      description: "Explore",
      tools: ["read"],
      extensions: [],
      systemPrompt: "Explore only",
      disableSkills: true,
      disablePromptTemplates: true,
    },
  ];
  const calls: any[] = [];
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    calls.push(invocation);
    return {
      ok: true,
      aborted: false,
      stdout: "fallback text",
      stderr: "",
      exitCode: 0,
      signal: null,
      structured: { ok: true, value: { files: ["src/auth.ts"] } },
    };
  });

  try {
    const spawn = createWorkflowAgentSpawner({
      cwd: "/repo",
      logId: "wf",
      agents,
    });
    const response = await spawn({
      id: 1,
      prompt: "go",
      output: {
        schema: {
          type: "object",
          required: ["files"],
          properties: {
            files: { type: "array", items: { type: "string" } },
          },
        },
      },
    } as any);

    assert.equal(response.ok, true);
    assert.equal((response as any).hasStructured, true);
    assert.deepEqual((response as any).value, { files: ["src/auth.ts"] });
    assert.deepEqual(calls[0].output, {
      schema: {
        type: "object",
        required: ["files"],
        properties: {
          files: { type: "array", items: { type: "string" } },
        },
      },
    });
  } finally {
    stub.mock.restore();
  }
});

test("workflow agent spawner resolves only configured fixed model aliases", async () => {
  const calls: any[] = [];
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    calls.push(invocation);
    return {
      ok: true,
      aborted: false,
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  });
  const agents: AgentDefinition[] = [
    {
      name: "explorer",
      description: "Explore",
      tools: ["read"],
      extensions: [],
      model: "definition/model",
      systemPrompt: "Explore only",
      disableSkills: true,
      disablePromptTemplates: true,
    },
  ];

  try {
    const spawn = createWorkflowAgentSpawner({
      cwd: "/repo",
      logId: "wf",
      agents,
      model: "parent/model",
      modelTiers: { small: "tier/small" },
    });
    assert.equal(
      (await spawn({ id: 1, prompt: "small", model: "small" })).ok,
      true,
    );
    assert.equal((await spawn({ id: 2, prompt: "default" })).ok, true);
    const unknown = await spawn({ id: 3, prompt: "unknown", model: "medium" });
    const unconfigured = await spawn({
      id: 4,
      prompt: "big",
      model: "big",
    });

    assert.deepEqual(
      calls.map((call) => call.model),
      ["tier/small", "definition/model"],
    );
    assert.equal(unknown.errorCode, "agent_policy_rejected");
    assert.match(unknown.error ?? "", /medium/);
    assert.equal(unconfigured.errorCode, "agent_policy_rejected");
    assert.match(unconfigured.error ?? "", /not configured/);
    assert.equal(calls.length, 2);
  } finally {
    stub.mock.restore();
  }
});

test("parallel aggregates branch failures as null and logs them", async () => {
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallel([
        () => agent("ok"),
        () => agent("bad"),
      ]);
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (request) =>
        request.prompt === "bad"
          ? { ok: false, text: null, error: "boom" }
          : { ok: true, text: "ok" },
    },
  );
  assert.deepEqual(result.result, ["ok", null]);
  assert.equal(result.agentFailureCount, 1);
  assert.equal(result.loggedBranchFailureCount, 1);
  assert.equal(result.settledBranchFailureCount, 0);
  assert.match(result.logs.at(-1)?.message ?? "", /boom/);
});

test("runtime converts rejected spawn promises into agent failures", async () => {
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallel([
        () => agent("ok"),
        () => agent("throws"),
      ]);
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (request) => {
        if (request.prompt === "throws") throw new Error("spawn exploded");
        return { ok: true, text: "ok" };
      },
    },
  );

  assert.deepEqual(result.result, ["ok", null]);
  assert.equal(result.agentFailureCount, 1);
  assert.equal(result.loggedBranchFailureCount, 1);
  assert.equal(result.settledBranchFailureCount, 0);
  assert.match(result.logs.at(-1)?.message ?? "", /spawn exploded/);
});

test("parallelSettled preserves branch failure codes", async () => {
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallelSettled([
        () => agent("ok"),
        () => agent("throws"),
      ]);
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (request) => {
        if (request.prompt === "throws") throw new Error("spawn exploded");
        return { ok: true, text: "ok" };
      },
    },
  );

  assert.deepEqual(result.result, [
    { ok: true, value: "ok" },
    {
      ok: false,
      error: {
        code: "agent_spawn_exception",
        message: "spawn exploded",
        details: {
          code: "agent_spawn_exception",
          message: "spawn exploded",
          agentId: 2,
        },
      },
    },
  ]);
  assert.equal(result.agentFailureCount, 1);
  assert.equal(result.loggedBranchFailureCount, 0);
  assert.equal(result.settledBranchFailureCount, 1);
});

test("agent retries retryable failures when requested", async () => {
  const prompts: string[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      return await agent("flaky", { retries: 1 });
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            ok: false,
            text: null,
            error: "provider hiccup",
            errorCode: "subagent_failed",
          } as any;
        }
        return { ok: true, text: "recovered" };
      },
    },
  );

  assert.equal(result.result, "recovered");
  assert.deepEqual(prompts, ["flaky", "flaky"]);
});

test("agent retries skip permanent provider schema rejections", async () => {
  let calls = 0;
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallelSettled([
        () => agent("invalid schema", { retries: 2 }),
      ]);
    }`),
    {
      cwd: "/tmp",
      spawnAgent: async () => {
        calls += 1;
        return {
          ok: false,
          text: null,
          error: "provider rejected tool schema",
          errorCode: "provider_schema_rejected",
        } as any;
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(
    (result.result as any)[0].error.code,
    "provider_schema_rejected",
  );
});

test("runtime previews cyclic workflow results safely", async () => {
  const updates: any[] = [];
  const result = await runWorkflow(
    script(`export async function run() {
      await agent("ok");
      const value = { name: "cycle" };
      value.self = value;
      return value;
    }`),
    {
      cwd: "/tmp",
      onUpdate: (snapshot) => updates.push(snapshot),
      spawnAgent: async () => ({ ok: true, text: "ok" }),
    },
  );

  assert.equal((result.result as any).name, "cycle");
  assert.match(updates.at(-1)?.resultPreview ?? "", /\[Circular\]/);
});

test("run cap rejects later calls without aborting admitted work", async () => {
  const ledger = createWorkflowRunLedger({ maxAgents: 2 });
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return successfulOutcome(invocation.prompt);
  });
  try {
    const spawnAgent = createWorkflowAgentSpawner({
      cwd: "/tmp",
      logId: "cap",
      agents: readOnlyAgents,
      ledger,
    });
    const result = await runWorkflow(
      script(`export async function run() {
        return await parallelSettled([
          () => agent("first"), () => agent("second"), () => agent("third")
        ]);
      }`),
      { cwd: "/tmp", ledger, spawnAgent },
    );

    assert.deepEqual(result.result, [
      { ok: true, value: "first" },
      { ok: true, value: "second" },
      {
        ok: false,
        error: {
          code: "workflow_run_cap_exceeded",
          message: "workflow agent run cap exceeded",
          details: {
            code: "workflow_run_cap_exceeded",
            message: "workflow agent run cap exceeded",
            agentId: 3,
            intent: undefined,
            logFile: undefined,
          },
        },
      },
    ]);
    assert.equal(stub.mock.callCount(), 2);
    assert.equal(ledger.snapshot().launched, 2);
  } finally {
    stub.mock.restore();
  }
});

test("retries reuse a logical reservation and accumulate every attempt", async () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 100, maxAgents: 1 });
  let attempt = 0;
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    attempt += 1;
    invocation.onEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { totalTokens: attempt === 1 ? 5 : 7 },
      },
    });
    if (attempt === 1) {
      return {
        ...successfulOutcome(""),
        ok: false,
        errorCode: "provider_error",
      };
    }
    return successfulOutcome("done");
  });
  try {
    const spawnAgent = createWorkflowAgentSpawner({
      cwd: "/tmp",
      logId: "retry-budget",
      agents: readOnlyAgents,
      ledger,
    });
    const result = await runWorkflow(
      script(
        `export async function run() { return await agent("retry", { retries: 1 }); }`,
      ),
      { cwd: "/tmp", ledger, spawnAgent },
    );
    assert.equal(result.result, "done");
    assert.equal(stub.mock.callCount(), 2);
    assert.deepEqual(ledger.snapshot(), {
      total: 100,
      used: 12,
      launched: 1,
      maxAgents: 1,
    });
  } finally {
    stub.mock.restore();
  }
});

test("token exhaustion prevents a retry after a retryable provider failure", async () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 5 });
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    invocation.onEvent({
      type: "message_end",
      message: { role: "assistant", usage: { totalTokens: 5 } },
    });
    return {
      ...successfulOutcome(""),
      ok: false,
      errorCode: "provider_error",
    };
  });
  try {
    const spawnAgent = createWorkflowAgentSpawner({
      cwd: "/tmp",
      logId: "retry-stop",
      agents: readOnlyAgents,
      ledger,
    });
    const result = await runWorkflow(
      script(`export async function run() {
        return await parallelSettled([() => agent("retry", { retries: 2 })]);
      }`),
      { cwd: "/tmp", ledger, spawnAgent },
    );
    assert.equal(
      (result.result as any[])[0].error.code,
      "workflow_budget_exceeded",
    );
    assert.equal(stub.mock.callCount(), 1);
  } finally {
    stub.mock.restore();
  }
});

test("streamed token exhaustion aborts active agents but leaves worker fan-in alive", async () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 10 });
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    if (invocation.prompt === "fast") return successfulOutcome("fast");
    if (invocation.prompt === "cross") {
      await new Promise((resolve) => setImmediate(resolve));
      invocation.onEvent({
        type: "message_end",
        message: { role: "assistant", usage: { totalTokens: 10 } },
      });
    } else if (!invocation.signal.aborted) {
      await new Promise<void>((resolve) =>
        invocation.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    }
    return {
      ...successfulOutcome(""),
      ok: false,
      aborted: true,
      signal: "SIGTERM",
    };
  });
  try {
    const spawnAgent = createWorkflowAgentSpawner({
      cwd: "/tmp",
      logId: "token-budget",
      agents: readOnlyAgents,
      ledger,
    });
    const result = await runWorkflow(
      script(`export async function run() {
        return await parallelSettled([
          () => agent("fast"), () => agent("cross"), () => agent("blocked")
        ]);
      }`),
      { cwd: "/tmp", ledger, spawnAgent },
    );
    const branches = result.result as any[];
    assert.deepEqual(branches[0], { ok: true, value: "fast" });
    assert.equal(branches[1].error.code, "workflow_budget_exceeded");
    assert.equal(branches[2].error.code, "workflow_budget_exceeded");
    assert.equal(ledger.snapshot().used, 10);
    assert.equal(result.settledBranchFailureCount, 2);
  } finally {
    stub.mock.restore();
  }
});

test("token enforcement remains active after the logical call cap denies work", async () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 5, maxAgents: 2 });
  const stub = mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    if (invocation.prompt === "cross") {
      await new Promise((resolve) => setTimeout(resolve, 20));
      invocation.onEvent({
        type: "message_end",
        message: { role: "assistant", usage: { totalTokens: 5 } },
      });
    } else if (!invocation.signal.aborted) {
      await new Promise<void>((resolve) =>
        invocation.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    }
    return {
      ...successfulOutcome(""),
      ok: false,
      aborted: true,
      signal: "SIGTERM",
    };
  });
  try {
    const spawnAgent = createWorkflowAgentSpawner({
      cwd: "/tmp",
      logId: "independent-budgets",
      agents: readOnlyAgents,
      ledger,
    });
    const result = await runWorkflow(
      script(`export async function run() {
        return await parallelSettled([
          () => agent("cross"), () => agent("blocked"), () => agent("denied")
        ]);
      }`),
      { cwd: "/tmp", ledger, spawnAgent },
    );
    const codes = (result.result as any[]).map((branch) => branch.error.code);
    assert.deepEqual(codes, [
      "workflow_budget_exceeded",
      "workflow_budget_exceeded",
      "workflow_run_cap_exceeded",
    ]);
    assert.equal(ledger.isTokenExceeded(), true);
  } finally {
    stub.mock.restore();
  }
});

test("budget is an immutable advisory worker facade", async () => {
  const ledger = createWorkflowRunLedger();
  const result = await runWorkflow(
    script(`export async function run() {
      await agent("one");
      const before = {
        total: budget.total,
        spent: budget.spent(),
        remaining: budget.remaining(),
        launched: budget.launched,
        maxAgents: budget.maxAgents,
      };
      let assignmentRejected = false;
      let redefineRejected = false;
      try { budget.spent = () => 999; } catch { assignmentRejected = true; }
      try { Object.defineProperty(budget, "total", { value: 999 }); } catch { redefineRejected = true; }
      return { before, assignmentRejected, redefineRejected, frozen: Object.isFrozen(budget) };
    }`),
    {
      cwd: "/tmp",
      ledger,
      spawnAgent: async (request) => {
        ledger.reserve(request.id);
        return { ok: true, text: "ok" };
      },
    },
  );
  assert.deepEqual(result.result, {
    before: {
      total: null,
      spent: 0,
      remaining: Infinity,
      launched: 1,
      maxAgents: null,
    },
    assignmentRejected: true,
    redefineRejected: true,
    frozen: true,
  });
});

test("runtime default workflow timeout is one hour", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 60 * 60 * 1000);
});

test("agent timeout fails only that agent branch", async () => {
  const result = await runWorkflow(
    script(`export async function run() {
      return await parallelSettled([
        () => agent("slow", { timeoutMs: 50 }),
        () => agent("fast"),
      ]);
    }`),
    {
      cwd: "/tmp",
      timeoutMs: 1_000,
      spawnAgent: async (request) => {
        if (request.prompt === "fast") return { ok: true, text: "fast ok" };
        return await new Promise(() => undefined);
      },
    },
  );

  assert.deepEqual(result.result, [
    {
      ok: false,
      error: {
        code: "agent_timeout",
        message: "agent timed out after 50ms",
        details: {
          code: "agent_timeout",
          message: "agent timed out after 50ms",
          agentId: 1,
        },
      },
    },
    { ok: true, value: "fast ok" },
  ]);
});

test("workflow timeout aborts in-flight agent requests", async () => {
  let signalAborted = false;

  await assert.rejects(
    runWorkflow(
      script(`export async function run() { return await agent("slow"); }`),
      {
        cwd: "/tmp",
        timeoutMs: 200,
        spawnAgent: async (request) =>
          await new Promise((resolve) => {
            request.signal?.addEventListener(
              "abort",
              () => {
                signalAborted = true;
                resolve({ ok: false, text: null, error: "aborted" });
              },
              { once: true },
            );
          }),
      },
    ),
    /timed out/,
  );

  assert.equal(signalAborted, true);
});

test("aborts runaway worker promptly", async () => {
  const controller = new AbortController();
  const promise = runWorkflow(
    script(
      `export async function run() { while (true) {} await agent("never"); }`,
    ),
    {
      cwd: "/tmp",
      signal: controller.signal,
      spawnAgent: async () => ({ ok: true, text: "never" }),
    },
  );
  controller.abort();
  await assert.rejects(promise, /aborted|exited/);
});

test("agent spawner uses safe spawn defaults and rejects writable agents", async () => {
  const agents: AgentDefinition[] = [
    {
      name: "explorer",
      description: "Explore",
      tools: ["read"],
      extensions: [],
      systemPrompt: "Explore only",
      disableSkills: true,
      disablePromptTemplates: true,
    },
    {
      name: "writer",
      description: "Writer",
      tools: ["write"],
      extensions: [],
      systemPrompt: "Write",
      disableSkills: false,
      disablePromptTemplates: false,
    },
  ];
  const calls: any[] = [];
  const updates: any[] = [];
  mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    calls.push(invocation);
    invocation.onEvent?.({ type: "agent_start" });
    invocation.onEvent?.({
      type: "tool_execution_start",
      toolName: "read",
      args: { path: "README.md" },
    });
    invocation.onEvent?.({ type: "tool_execution_end", toolName: "read" });
    return {
      ok: true,
      aborted: false,
      stdout: "done",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  });

  const spawn = createWorkflowAgentSpawner({
    cwd: "/repo",
    logId: "wf",
    agents,
    model: "p/m",
    thinking: "high",
    onAgentUpdate: (state) => updates.push(state),
  });
  assert.equal((await spawn({ id: 1, prompt: "go" })).text, "done");
  assert.equal(calls[0].inheritSession, "none");
  assert.equal(calls[0].env, undefined);
  assert.deepEqual(calls[0].toolAllowlist, ["read"]);
  assert.equal(calls[0].cwd, "/repo");
  assert.equal(calls[0].model, "p/m");
  assert.equal(calls[0].thinking, "high");
  assert.ok(updates.some((state) => state.activity?.toolUseCount === 1));
  assert.equal(updates.at(-1)?.activity?.resolved, true);
  assert.equal(updates.at(-1)?.activity?.agentType, "explorer");

  const rejected = await spawn({ id: 2, prompt: "write", agent: "writer" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? "", /not allowed/);
});
