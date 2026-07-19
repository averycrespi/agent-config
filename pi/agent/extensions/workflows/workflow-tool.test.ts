import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import registerWorkflowsExtension from "./index.ts";
import { DEFAULT_WORKFLOW_CONFIG } from "./config.ts";
import { formatConfigForDisplay } from "../_shared/config.ts";
import {
  renderSnapshot,
  renderWorkflowCall,
  renderWorkflowResult,
} from "./display.ts";
import { _runSubagent } from "./runtime.ts";
import { persistWorkflowScript } from "./script-artifacts.ts";
import { registerWorkflowTool as registerWorkflowToolProduction } from "./workflow-tool.ts";

const ARTIFACT_DIR = join(tmpdir(), `workflow-tool-${process.pid}`);
after(() => rm(ARTIFACT_DIR, { recursive: true, force: true }));
const registry = { find: () => ({ provider: "p", id: "m", reasoning: true }) };
const theme = {
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
};

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
  const notifications: Array<[string, string]> = [];
  return {
    pi: {
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
    "modelTier",
    "thinking",
    "verify",
    "report",
    "budget",
  ]) {
    assert.match(guidance, new RegExp(term));
  }
  assert.doesNotMatch(guidance, /agent\?|model\?|model: "small"|model: "big"/);
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
    "maxVisibleSettledAgents",
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

test("tool validates a saved or inline workflow without execution", async () => {
  const h = harness();
  registerWorkflowTool(h.pi as any);
  const script = `export const meta = { name: "validated", description: "test" };
export async function run() { if (false) await agent("unused", { intent: "unused", capabilities: [], modelTier: "medium", thinking: "high" }); return "ok"; }`;
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
    modelTier: "medium",
    thinking: "high"
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
    assert.match(result.content[0].text, /researched/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].intent, "inspect files");
    assert.deepEqual(calls[0].capabilities, ["read-filesystem"]);
    assert.equal(calls[0].modelTier, "medium");
    assert.equal(calls[0].thinking, "high");
    assert.equal(calls[0].modelRegistry, registry);
    assert.equal("agent" in calls[0], false);
    assert.ok(updates.length > 0);
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
        "modelTierSmall was removed; configure model tiers under extension:subagents.",
      );
      return DEFAULT_WORKFLOW_CONFIG;
    },
  );
  await h.tool.execute(
    "call",
    {
      action: "run",
      script: `export const meta = { name: "warning", description: "warning" };
export async function run() { if (false) await agent("unused", { intent: "unused", capabilities: [], modelTier: "medium", thinking: "high" }); return "ok"; }`,
    },
    undefined,
    undefined,
    h.context,
  );
  assert.deepEqual(h.notifications, [
    [
      "modelTierSmall was removed; configure model tiers under extension:subagents.",
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
  return await agent("fail", { intent: "fail safely", capabilities: [], modelTier: "medium", thinking: "high" });
}`,
      },
      undefined,
      undefined,
      h.context,
    );
    assert.equal(result.details.errorCode, "provider_error");
    assert.equal(typeof result.details.recoveryFile, "string");
    assert.match(result.content[0].text, /provider failed/);
  } finally {
    mock.restoreAll();
  }
});

test("snapshot rendering is intent-first and metadata-rich", () => {
  const snapshot: any = {
    meta: { name: "research", description: "test" },
    phases: ["search"],
    phase: "search",
    logs: [],
    agents: [
      {
        id: 1,
        intent: "Search docs",
        capabilities: ["read-web"],
        modelTier: "small",
        thinking: "medium",
        status: "done",
        startedAt: 1000,
        finishedAt: 2000,
      },
    ],
    agentFailureCount: 0,
    loggedBranchFailureCount: 0,
    settledBranchFailureCount: 0,
    startedAt: 1000,
    finishedAt: 2000,
  };
  const lines = renderSnapshot(snapshot, theme, { final: true });
  assert.ok(
    lines.some((line) =>
      line.includes("✓ Search docs · read-web · small/medium"),
    ),
  );
  assert.ok(
    lines.every(
      (line) => !line.includes("explorer") && !line.includes("reviewer"),
    ),
  );
});

test("workflow renderers truncate controls and narrow widths", () => {
  const context: any = {
    state: {},
    invalidate() {},
    args: { action: "run" },
    isError: false,
  };
  const call = renderWorkflowCall(
    { action: "run", name: "bad\x1b[2J\nname" },
    theme,
    context,
  );
  assert.ok(call.render(20).every((line: string) => visibleWidth(line) <= 20));
  assert.doesNotMatch(call.render(200).join("\n"), /\x1b|\nname/);

  const result = renderWorkflowResult(
    {
      content: [{ type: "text", text: "ok" }],
      details: { action: "validate", meta: { name: "valid" } },
    },
    { isPartial: false },
    theme,
    context,
  );
  assert.deepEqual(result.render(200), ["✓ validated valid"]);
});
