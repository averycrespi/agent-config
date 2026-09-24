import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { Service } from "../background/service.ts";
import { SERVICE_EVENT, type Execution } from "../background/api.ts";
import { validate } from "../background/store.ts";
import { DEFAULT_WORKFLOW_CONFIG } from "./config.ts";
import { registerWorkflowTool } from "./workflow-tool.ts";
import { _runSubagent } from "./runtime.ts";

const call = `agent("inspect", { intent: "inspect", capabilities: [], profile: "fast" })`;
const source = (body: string) =>
  `export const meta = { name: "fixture", description: "fixture" }; export async function run() { ${body} }`;
const success = (stdout = "ok") => ({
  ok: true,
  aborted: false,
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function harness(config = {}) {
  let tool: any;
  let records: Execution[] = [];
  const events = createEventBus();
  const terminal = deferred<Execution>();
  const sent: Execution[] = [];
  const store = {
    read: () => structuredClone(records),
    write: (value: Execution[]) => {
      records = validate(value);
    },
  };
  const hooks = {
    anchor: () => "anchor",
    inBranch: () => true,
    idle: () => true,
    changed() {},
    handoff: (r: Execution) => sent.push(r),
    event: (type: string, r: Execution) => {
      if (type === "terminal") terminal.resolve(r);
    },
  };
  const service = new Service(store, hooks);
  events.on(SERVICE_EVENT, (value: any) => value.accept(service));
  const cwd = await mkdtemp(join(tmpdir(), "workflow-background-test-"));
  registerWorkflowTool(
    { events, registerTool: (t: any) => (tool = t) } as any,
    async () => ({
      ...DEFAULT_WORKFLOW_CONFIG,
      workflowTimeoutMs: 5000,
      userWorkflowsDir: cwd,
      ...config,
    }),
  );
  const context = {
    cwd,
    modelRegistry: { find: () => ({ provider: "p", id: "m" }) },
    ui: { notify() {} },
  };
  const execute = (params: unknown, signal?: AbortSignal) =>
    tool.execute(crypto.randomUUID(), params, signal, undefined, context);
  return {
    tool,
    execute,
    context,
    cwd,
    service,
    store,
    hooks,
    sent,
    terminal: terminal.promise,
  };
}
async function retained(record: Execution) {
  return JSON.parse(
    await readFile(
      (record.result as { resultFile: string }).resultFile,
      "utf8",
    ),
  );
}

test("background named source, args, config and context are pinned; one workflow owns all agents", async () => {
  const h = await harness();
  const gate = deferred<void>();
  const entered = deferred<void>();
  const requests: any[] = [];
  const stub = mock.method(_runSubagent, "fn", async (request: any) => {
    requests.push(request);
    entered.resolve();
    await gate.promise;
    return success();
  });
  try {
    const path = join(h.cwd, "fixture.js");
    await writeFile(
      path,
      source(
        `phase("inspect"); await ${call}; return { value: args.value, cwd };`,
      ),
    );
    const args = { value: "original" };
    const result = await h.execute({
      action: "run",
      name: "fixture",
      args,
      execution: "background",
    });
    const id = result.details.execution.id;
    args.value = "changed";
    const originalCwd = h.context.cwd;
    h.context.cwd = "/changed";
    await writeFile(path, source(`await ${call}; return "replaced";`));
    await entered.promise;
    assert.equal(h.service.list("workflow").length, 1);
    assert.equal(h.service.list("subagents").length, 0);
    assert.equal(requests[0].cwd, originalCwd);
    assert.equal(h.service.inspect("workflow", id).activity?.phase, "inspect");
    assert.equal(
      (await h.execute({ action: "inspect", id })).details.background.status,
      "running",
    );
    gate.resolve();
    const done = await h.terminal;
    assert.equal(done.status, "success");
    assert.deepEqual((await retained(done)).details.result, {
      value: "original",
      cwd: originalCwd,
    });
    assert.equal((done.result as any).accounting.launched, 1);
    assert.deepEqual(done.activity, {
      started: 1,
      completed: 1,
      failed: 0,
      phase: "inspect",
    });
    h.service.flush();
    h.service.flush();
    assert.equal(h.sent.length, 1);
    assert.equal(
      (await h.execute({ action: "dismiss", id })).details.background.dismissed,
      true,
    );
  } finally {
    gate.resolve();
    h.service.close();
    stub.mock.restore();
  }
});

test("inline gates, branch failures, incomplete review data, retries and caps remain distinct", async () => {
  for (const scenario of [
    {
      body: `const value = await ${call}; return await report(value, { gate: () => true });`,
      status: "success",
      attempts: 1,
    },
    {
      body: `await ${call}; return await report(42, { gate: () => false });`,
      status: "failed",
      code: "workflow_report_rejected",
      attempts: 1,
    },
    {
      body: `await ${call}; return { complete: false, outcome: "incomplete" };`,
      status: "failed",
      attempts: 1,
    },
    {
      body: `return await parallelSettled([() => ${call}]);`,
      status: "failed",
      fail: true,
      attempts: 1,
    },
    {
      body: `await ${call}; return await ${call};`,
      status: "failed",
      config: { maxAgentsPerRun: 1 },
      code: "workflow_run_cap_exceeded",
      attempts: 1,
    },
    {
      body: `return await agent("retry", { intent: "retry", capabilities: [], profile: "fast", retries: 1 });`,
      status: "success",
      retry: true,
      attempts: 2,
    },
  ]) {
    const h = await harness(scenario.config);
    let attempts = 0;
    const stub = mock.method(_runSubagent, "fn", async () => {
      attempts++;
      return scenario.fail || (scenario.retry && attempts === 1)
        ? { ...success(), ok: false, errorCode: "provider_error" as const }
        : success();
    });
    try {
      await h.execute({
        action: "run",
        script: source(scenario.body),
        execution: "background",
      });
      const done = await h.terminal;
      assert.equal(done.status, scenario.status);
      const saved = await retained(done);
      assert.equal(saved.details.errorCode, scenario.code);
      assert.equal(attempts, scenario.attempts);
      assert.equal((done.result as any).accounting.launched, 1);
      if (scenario.fail)
        assert.equal(saved.details.settledBranchFailureCount, 1);
    } finally {
      h.service.close();
      stub.mock.restore();
    }
  }
});

test("cancel aborts and drains admitted work before settlement; recovery retains structured partial success", async () => {
  const h = await harness();
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const drain = deferred<void>();
  let calls = 0;
  const stub = mock.method(_runSubagent, "fn", async (request: any) => {
    calls++;
    if (calls === 1)
      return {
        ...success(),
        structured: { ok: true, value: { evidence: "retained" } },
      };
    entered.resolve();
    request.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    await drain.promise;
    return { ...success(), ok: false, aborted: true };
  });
  try {
    const r = await h.execute({
      action: "run",
      execution: "background",
      script: source(
        `await agent("first", { intent: "first", capabilities: [], profile: "fast", output: { schema: { type: "object" } } }); await ${call}; return await ${call};`,
      ),
    });
    await entered.promise;
    await h.execute({ action: "cancel", id: r.details.execution.id });
    await aborted.promise;
    assert.equal(
      h.service.inspect("workflow", r.details.execution.id).status,
      "running",
    );
    assert.equal(h.sent.length, 0);
    drain.resolve();
    const done = await h.terminal;
    assert.equal(done.status, "cancelled");
    const saved = await retained(done);
    assert.equal(saved.details.errorCode, "workflow_aborted");
    assert.equal(saved.details.counts.outstanding, 0);
    assert.ok(saved.details.recoveryFile);
    const recovery = JSON.parse(
      gunzipSync(await readFile(saved.details.recoveryFile)).toString(),
    );
    assert.deepEqual(recovery.calls[0].structuredValue, {
      evidence: "retained",
    });
    assert.equal(recovery.calls[1].failure.code, "workflow_aborted");
    assert.equal(calls, 2);
  } finally {
    drain.resolve();
    h.service.close();
    stub.mock.restore();
  }
});

test("interruption retains stable outcome reference, drains, and restoration never replays", async () => {
  const h = await harness();
  const entered = deferred<void>();
  const exited = deferred<void>();
  let calls = 0;
  const stub = mock.method(_runSubagent, "fn", async (request: any) => {
    calls++;
    entered.resolve();
    await new Promise<void>((r) =>
      request.signal.addEventListener("abort", () => r(), { once: true }),
    );
    exited.resolve();
    return { ...success(), ok: false, aborted: true };
  });
  try {
    const r = await h.execute({
      action: "run",
      execution: "background",
      script: source(`return await ${call};`),
    });
    await entered.promise;
    h.service.close();
    await exited.promise;
    const restored = new Service(h.store, h.hooks);
    const record = restored.inspect("workflow", r.details.execution.id);
    assert.equal(record.status, "interrupted");
    assert.ok((record.result as any).resultFile);
    assert.equal(calls, 1);
    restored.close();
  } finally {
    h.service.close();
    stub.mock.restore();
  }
});

test("background executes the actual saved review definition without hiding incomplete coverage", async () => {
  for (const gaps of [[], ["Missing acceptance evidence"]]) {
    const h = await harness({
      userWorkflowsDir: join(process.cwd(), "pi/agent/workflows"),
    });
    const stub = mock.method(_runSubagent, "fn", async () => ({
      ...success(),
      structured: { ok: true, value: { findings: [], gaps: [] } },
    }));
    try {
      await h.execute({
        action: "run",
        name: "review",
        execution: "background",
        args: {
          target: { kind: "working-tree", label: "fixture" },
          objective: "Verify fixture",
          acceptanceCriteria: ["Correct"],
          changedFiles: ["fixture.ts"],
          contextPaths: ["AGENTS.md"],
          checks: [
            { name: "tests", status: "passed", summary: "fixture passed" },
          ],
          knownGaps: gaps,
        },
      });
      const done = await h.terminal;
      const value = (await retained(done)).details.result;
      assert.equal(value.complete, gaps.length === 0);
      assert.equal(done.status, gaps.length ? "failed" : "success");
      assert.match(value.report, /Review coverage is not delivery readiness/);
    } finally {
      h.service.close();
      stub.mock.restore();
    }
  }
});

test("background budget and whole-run timeout abort without added retries", async () => {
  for (const budget of [true, false]) {
    const h = await harness(
      budget ? { maxTokensPerRun: 5 } : { workflowTimeoutMs: 100 },
    );
    let calls = 0;
    const stub = mock.method(_runSubagent, "fn", async (request: any) => {
      calls++;
      if (budget)
        request.onEvent({
          type: "message_end",
          message: {
            role: "assistant",
            content: "done",
            usage: { totalTokens: 7 },
          },
        });
      if (!request.signal.aborted)
        await new Promise<void>((r) =>
          request.signal.addEventListener("abort", () => r(), { once: true }),
        );
      return { ...success(), ok: false, aborted: true };
    });
    try {
      await h.execute({
        action: "run",
        execution: "background",
        script: source(
          `return await agent("test", { intent: "test", capabilities: [], profile: "fast", retries: 2 });`,
        ),
      });
      const done = await h.terminal;
      assert.equal(
        (await retained(done)).details.errorCode,
        budget ? "workflow_budget_exceeded" : "workflow_timeout",
      );
      assert.equal(done.status, budget ? "failed" : "timeout");
      assert.equal(calls, 1);
      if (budget) assert.equal((done.result as any).accounting.used, 7);
    } finally {
      h.service.close();
      stub.mock.restore();
    }
  }
});

test("missing service and invalid action combinations never start an agent", async () => {
  let tool: any;
  registerWorkflowTool({
    events: createEventBus(),
    registerTool: (t: any) => (tool = t),
  } as any);
  const ctx = { cwd: "/repo", modelRegistry: {} };
  await assert.rejects(
    tool.execute(
      "missing",
      {
        action: "run",
        execution: "background",
        script: source(`return await ${call};`),
      },
      undefined,
      undefined,
      ctx,
    ),
    /background_unavailable/,
  );
  const h = await harness();
  for (const params of [
    { action: "list", execution: "background" },
    {
      action: "validate",
      execution: "background",
      script: source(`return await ${call};`),
    },
    { action: "inspect" },
    { action: "executions", args: {} },
  ]) {
    assert.equal((await h.execute(params)).details.inputError, true);
  }
  assert.equal(h.service.list("workflow").length, 0);
  h.service.close();
});
