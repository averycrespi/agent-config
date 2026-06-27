import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { parseWorkflowScript } from "./parser.ts";
import {
  createWorkflowAgentSpawner,
  _spawnSubagent,
  runWorkflow,
} from "./runtime.ts";
import type { AgentDefinition } from "../subagents/api.ts";

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
  assert.equal(result.failureCount, 1);
  assert.match(result.logs.at(-1)?.message ?? "", /boom/);
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
      name: "explore",
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
  mock.method(_spawnSubagent, "fn", async (invocation: any) => {
    calls.push(invocation);
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
  });
  assert.equal((await spawn({ id: 1, prompt: "go" })).text, "done");
  assert.equal(calls[0].inheritSession, "none");
  assert.equal(calls[0].env, undefined);
  assert.deepEqual(calls[0].toolAllowlist, ["read"]);
  assert.equal(calls[0].cwd, "/repo");
  assert.equal(calls[0].model, "p/m");
  assert.equal(calls[0].thinking, "high");

  const rejected = await spawn({ id: 2, prompt: "write", agent: "writer" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? "", /not allowed/);
});
