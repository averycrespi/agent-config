import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { Service } from "../background/service.ts";
import { SERVICE_EVENT, type Execution } from "../background/api.ts";
import { validate } from "../background/store.ts";
import registerWorkflowsExtension from "./index.ts";
import { DEFAULT_WORKFLOW_CONFIG } from "./config.ts";
import { formatConfigForDisplay } from "../_shared/config.ts";
import { _runSubagent } from "./runtime.ts";
import { persistWorkflowScript } from "./script-artifacts.ts";
import { registerWorkflowTool as registerWorkflowToolProduction } from "./workflow-tool.ts";

const ARTIFACT_DIR = join(tmpdir(), `workflow-tool-${process.pid}`);
after(() => rm(ARTIFACT_DIR, { recursive: true, force: true }));
const registry = { find: () => ({ provider: "p", id: "m", reasoning: true }) };

function registerWorkflowTool(
  pi: Parameters<typeof registerWorkflowToolProduction>[0],
  loadConfig: Parameters<typeof registerWorkflowToolProduction>[1] = async () =>
    DEFAULT_WORKFLOW_CONFIG,
  overrides: Parameters<typeof registerWorkflowToolProduction>[2] = {},
) {
  registerWorkflowToolProduction(pi, loadConfig, {
    persistScript: (source, toolCallId, name) =>
      persistWorkflowScript(source, toolCallId, name, ARTIFACT_DIR),
    ...overrides,
  });
}

function harness() {
  let tool: any;
  let records: Execution[] = [];
  const events = createEventBus();
  const service = new Service(
    {
      read: () => structuredClone(records),
      write: (r) => {
        records = validate(r);
      },
    },
    {
      anchor: () => "anchor",
      inBranch: () => true,
      idle: () => true,
      changed() {},
      handoff() {},
      event() {},
    },
  );
  events.on(SERVICE_EVENT, (v: any) => v.accept(service));
  const notifications: Array<[string, string]> = [];
  return {
    service,
    async settled(id: string) {
      for (let i = 0; i < 300; i++) {
        const record = service.inspect("workflow", id);
        if (record.status !== "running") return record;
        await new Promise<void>((r) => setTimeout(r, 20));
      }
      throw Error("workflow did not settle");
    },
    pi: {
      events,
      registerTool(value: any) {
        tool = value;
      },
    },
    get tool() {
      return tool;
    },
    notifications,
    context: {
      cwd: "/repo",
      modelRegistry: registry,
      ui: {
        notify: (message: string, level: string) =>
          notifications.push([message, level]),
      },
    },
  };
}

function successfulOutcome(stdout = "ok") {
  return {
    ok: true,
    aborted: false,
    stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
  } as const;
}

test("tool guidance exposes only explicit workflow execution policy", () => {
  let registered: any;
  registerWorkflowsExtension({
    registerCommand() {},
    registerTool(value: any) {
      registered = value;
    },
  } as any);
  const guidance = [
    registered.description,
    ...registered.promptGuidelines,
  ].join("\n");
  for (const term of [
    "intent",
    "capabilities",
    "profile",
    "verify",
    "report",
    "budget",
  ]) {
    assert.match(guidance, new RegExp(term));
  }
  assert.doesNotMatch(guidance, /agent\?|model\?|model: "small"|model: "big"/);
  assert.match(registered.description, /Omit timeoutMs normally/);
  assert.match(registered.description, /agentTimeoutMs.*10 minutes/);
  assert.match(registered.description, /per-attempt.*whole-run/);
  assert.match(
    guidance,
    /blanket short deadlines.*substantial.*strong-profile/,
  );
  assert.match(guidance, /timeout alone does not prove.*stalled/);
  assert.match(guidance, /partial results.*before.*retry/i);
  assert.match(guidance, /dependent phases, aggregation, verification gates/);
  assert.match(guidance, /subagent is for one independent question/);
  assert.match(guidance, /parallel-only batches/);
  assert.match(guidance, /Continue independent authorized work/);
  assert.match(guidance, /Yield when none remains; do not poll/);
  assert.match(
    guidance,
    /without duplicating child work or changing files under review/,
  );
  assert.match(guidance, /Inspect the exact retained result/);
  assert.match(guidance, /Preserve skill-required workflows/);
  assert.match(
    guidance,
    /Use script with the selected mcp provider for gateway composition without subagent reasoning/,
  );
  assert.match(guidance, /parallel\(\) represents failed branches as null/);
  assert.match(
    guidance,
    /parallelSettled\(\) when completeness or per-branch failure accounting matters/,
  );
  assert.match(guidance, /Never silently discard failed required branches/);
  assert.match(guidance, /export async function run\(\)/);
  assert.match(guidance, /run\(\) must return its final value/);
});

test("workflow config display omits removed model tiers", () => {
  const display = formatConfigForDisplay(
    "workflows",
    DEFAULT_WORKFLOW_CONFIG as unknown as Record<string, unknown>,
  );
  for (const field of [
    "workflowTimeoutMs",
    "agentTimeoutMs",
    "maxConcurrency",
    "maxTokensPerRun",
    "maxAgentsPerRun",
    "userWorkflowsDir",
  ])
    assert.match(display, new RegExp(`"${field}"`));
  assert.doesNotMatch(display, /modelTierSmall|modelTierBig/);
});

test("tool validates input combinations without persisting or running", async () => {
  const h = harness();
  let persists = 0;
  registerWorkflowTool(h.pi as any, undefined, {
    persistScript: async () => {
      persists += 1;
      return "/tmp/unexpected";
    },
  });
  const result = await h.tool.execute(
    "call",
    { action: "run", script: "x", name: "also-x" },
    undefined,
    undefined,
    h.context,
  );
  assert.equal(result.details.inputError, true);
  assert.equal(persists, 0);
});

test("preflight rejects result-contract mistakes before persistence or agent launch", async () => {
  const h = harness();
  let persists = 0;
  let launches = 0;
  mock.method(_runSubagent, "fn", async () => {
    launches += 1;
    return successfulOutcome();
  });
  try {
    registerWorkflowTool(h.pi as any, undefined, {
      persistScript: async () => {
        persists += 1;
        return "/tmp/unexpected";
      },
    });
    for (const action of ["validate", "run"]) {
      for (const ending of [
        "report(results);",
        "log(results);",
        "return;",
        "return report(results, {});",
      ]) {
        const result = await h.tool.execute(
          "bad-result",
          {
            action,
            script: `export const meta = { name: "bad-result", description: "test" };
export async function run() {
 const results = await parallelSettled([() => agent("inspect", { intent: "inspect", capabilities: [], profile: "fast" })]);
 ${ending}
}`,
          },
          undefined,
          undefined,
          h.context,
        );
        assert.equal(result.details.validationError, true);
        assert.match(
          result.content[0].text,
          /run\(\) must return|report\(\) requires/,
        );
      }
    }
    assert.equal(persists, 0);
    assert.equal(launches, 0);
  } finally {
    mock.restoreAll();
  }
});

test("tool validates a saved or inline workflow without execution", async () => {
  const h = harness();
  registerWorkflowTool(h.pi as any);
  const script = `export const meta = { name: "validated", description: "test" };
export async function run() { if (false) await agent("unused", { intent: "unused", capabilities: [], profile: "balanced" }); return "ok"; }`;
  const result = await h.tool.execute(
    "call",
    { action: "validate", script },
    undefined,
    undefined,
    h.context,
  );
  assert.equal(result.details.action, "validate");
  assert.equal(result.details.meta.name, "validated");
  assert.match(result.content[0].text, /is valid/);
});

test("tool runs explicit-policy workflows through sanitized subagents", async () => {
  const h = harness();
  const calls: any[] = [];
  mock.method(_runSubagent, "fn", async (value: any) => {
    calls.push(value);
    return successfulOutcome("researched");
  });
  try {
    registerWorkflowTool(h.pi as any);
    const updates: any[] = [];
    const script = `export const meta = { name: "run", description: "test" };
export async function run() {
  return await agent("inspect", {
    intent: "inspect files",
    capabilities: ["read-filesystem"],
    profile: "balanced"
  });
}`;
    const result = await h.tool.execute(
      "call",
      { action: "run", script },
      undefined,
      (value: any) => updates.push(value),
      h.context,
    );
    assert.equal(result.details.action, "run");
    const completed = await h.settled(result.details.execution.id);
    assert.equal(completed.status, "success");
    assert.match(
      await readFile((completed.result as any).resultFile, "utf8"),
      /researched/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].intent, "inspect files");
    assert.deepEqual(calls[0].capabilities, ["read-filesystem"]);
    assert.equal(calls[0].profile, "balanced");
    assert.equal("thinking" in calls[0], false);
    assert.equal(calls[0].modelRegistry, registry);
    assert.equal("agent" in calls[0], false);
    assert.equal(updates.length, 0); // Updates are retained in Background, not foreground tool progress.
  } finally {
    mock.restoreAll();
  }
});

test("tool surfaces config warnings and removed settings diagnostics", async () => {
  const h = harness();
  registerWorkflowTool(
    h.pi as any,
    async (_cwd: string, warnings: string[] = []) => {
      warnings.push(
        "modelTierSmall was removed; configure profiles under extension:subagents.",
      );
      return DEFAULT_WORKFLOW_CONFIG;
    },
  );
  await h.tool.execute(
    "call",
    {
      action: "run",
      script: `export const meta = { name: "warning", description: "warning" };
export async function run() { if (false) await agent("unused", { intent: "unused", capabilities: [], profile: "balanced" }); return "ok"; }`,
    },
    undefined,
    undefined,
    h.context,
  );
  assert.deepEqual(h.notifications, [
    [
      "modelTierSmall was removed; configure profiles under extension:subagents.",
      "warning",
    ],
  ]);
});

test("tool preserves structured failures and recovery artifacts", async () => {
  const h = harness();
  mock.method(_runSubagent, "fn", async () => ({
    ok: false,
    aborted: false,
    stdout: "",
    stderr: "provider failed",
    exitCode: 1,
    signal: null,
    errorMessage: "provider failed",
    errorCode: "provider_error" as const,
    logFile: "/tmp/subagent.log",
  }));
  try {
    registerWorkflowTool(h.pi as any);
    const result = await h.tool.execute(
      "failure",
      {
        action: "run",
        script: `export const meta = { name: "failure", description: "failure" };
export async function run() {
  return await agent("fail", { intent: "fail safely", capabilities: [], profile: "balanced" });
}`,
      },
      undefined,
      undefined,
      h.context,
    );
    const completed = await h.settled(result.details.execution.id);
    assert.equal(completed.status, "failed");
    assert.match(
      await readFile((completed.result as any).resultFile, "utf8"),
      /provider failed/,
    );
  } finally {
    mock.restoreAll();
  }
});
