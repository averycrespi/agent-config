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
