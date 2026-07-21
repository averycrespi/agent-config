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

test("snapshot keeps agents in start order directly beneath the title", () => {
  const snapshot: any = {
    meta: { name: "ordered", description: "test" },
    phases: ["work"],
    phase: "work",
    logs: [],
    agents: [
      {
        id: 3,
        intent: "Newest running",
        capabilities: [],
        modelTier: "small",
        thinking: "low",
        status: "running",
        startedAt: 3000,
      },
      {
        id: 1,
        intent: "Oldest done",
        capabilities: [],
        modelTier: "small",
        thinking: "low",
        status: "done",
        startedAt: 1000,
        finishedAt: 1500,
      },
      {
        id: 2,
        intent: "Middle failed",
        capabilities: [],
        modelTier: "small",
        thinking: "low",
        status: "error",
        errorMessage: "failed",
        startedAt: 2000,
        finishedAt: 2500,
      },
    ],
    agentFailureCount: 1,
    loggedBranchFailureCount: 0,
    settledBranchFailureCount: 0,
    startedAt: 1000,
    finishedAt: 4000,
  };

  const lines = renderSnapshot(snapshot, theme);
  assert.match(lines[0], /^workflow ordered/);
  assert.deepEqual(
    lines
      .filter((line) => /(Oldest done|Middle failed|Newest running)/.test(line))
      .map(
        (line) => line.match(/Oldest done|Middle failed|Newest running/)?.[0],
      ),
    ["Oldest done", "Middle failed", "Newest running"],
  );
  assert.equal(lines[1], "");
  assert.match(lines[2], /Oldest done/);
});

test("workflow widget title uses a concise failed count", () => {
  const snapshot: any = {
    meta: { name: "counts", description: "test" },
    phases: [],
    logs: [],
    agents: [
      {
        id: 1,
        intent: "Running",
        capabilities: [],
        modelTier: "small",
        thinking: "low",
        status: "running",
        startedAt: 1000,
      },
    ],
    agentFailureCount: 0,
    loggedBranchFailureCount: 0,
    settledBranchFailureCount: 0,
    startedAt: 1000,
    finishedAt: 2000,
  };

  const [title] = renderSnapshot(snapshot, theme);
  assert.match(title, /0 done · 1 running · 0 failed/);
  assert.doesNotMatch(title, /agents? failed/);
});

function workflowSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    meta: { name: "research", description: "test" },
    phase: "search",
    phases: ["search"],
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
        finishedAt: 13000,
      },
    ],
    agentFailureCount: 0,
    loggedBranchFailureCount: 0,
    settledBranchFailureCount: 0,
    startedAt: 1000,
    finishedAt: 13000,
    ...overrides,
  } as any;
}

function rendererContext(args: Record<string, unknown> = {}) {
  return {
    state: {},
    invalidate() {},
    args: { action: "run", name: "research", ...args },
    isError: false,
  } as any;
}

function stopRendererTimer(context: any) {
  clearInterval(context.state.renderTimer as ReturnType<typeof setInterval>);
  context.state.renderTimer = undefined;
}

test("workflow collapsed rendering is always one total line", () => {
  const context = rendererContext();
  assert.deepEqual(
    renderWorkflowCall(
      { action: "run", name: "research" },
      theme,
      context,
    ).render(200),
    [],
  );

  const snapshot = workflowSnapshot();
  const cases = [
    {
      label: "running",
      result: { content: [], details: { snapshot } },
      options: { isPartial: true },
    },
    {
      label: "success",
      result: { content: [], details: { snapshot } },
      options: { isPartial: false },
    },
    {
      label: "snapshot error",
      result: {
        content: [{ type: "text", text: "Error: timed out" }],
        details: {
          snapshot,
          errorCode: "workflow_timeout",
          counts: {
            completed: 1,
            failed: 1,
            timedOut: 1,
            canceled: 0,
            outstanding: 0,
          },
        },
      },
      options: { isPartial: false },
    },
    {
      label: "input error",
      result: {
        content: [{ type: "text", text: "Invalid workflow input: bad args" }],
        details: { action: "run", inputError: true },
      },
      options: { isPartial: false },
    },
    {
      label: "list",
      result: {
        content: [],
        details: {
          action: "list",
          inventory: { storeDir: "/workflows", entries: [] },
        },
      },
      options: { isPartial: false },
    },
    {
      label: "validate",
      result: {
        content: [],
        details: {
          action: "validate",
          meta: { name: "research" },
          sourceFile: "/workflows/research.js",
        },
      },
      options: { isPartial: false },
    },
  ];

  for (const item of cases) {
    const lines = renderWorkflowResult(
      item.result,
      item.options,
      theme,
      context,
    ).render(200);
    if (item.options.isPartial) stopRendererTimer(context);
    assert.equal(lines.length, 1, item.label);
  }
});

test("expanded workflows preserve the collapsed header and add details", () => {
  const context = rendererContext();
  const cases = [
    {
      label: "running",
      result: {
        content: [],
        details: { snapshot: workflowSnapshot() },
      },
      partial: true,
    },
    {
      label: "success",
      result: {
        content: [],
        details: { snapshot: workflowSnapshot() },
      },
      partial: false,
    },
    {
      label: "error",
      result: {
        content: [{ type: "text", text: "Error: timed out" }],
        details: {
          snapshot: workflowSnapshot(),
          errorCode: "workflow_timeout",
          recoveryFile: "/tmp/recovery.gz",
        },
      },
      partial: false,
    },
    {
      label: "list",
      result: {
        content: [],
        details: {
          action: "list",
          inventory: {
            storeDir: "/workflows",
            entries: [{ name: "research", valid: true }],
          },
        },
      },
      partial: false,
    },
    {
      label: "validate",
      result: {
        content: [],
        details: {
          action: "validate",
          meta: { name: "research" },
          sourceFile: "/workflows/research.js",
        },
      },
      partial: false,
    },
  ];

  for (const item of cases) {
    const collapsed = renderWorkflowResult(
      item.result,
      { isPartial: item.partial },
      theme,
      context,
    ).render(300);
    const expanded = renderWorkflowResult(
      item.result,
      { isPartial: item.partial, expanded: true },
      theme,
      context,
    ).render(300);
    if (item.partial) stopRendererTimer(context);
    assert.equal(expanded[0], collapsed[0], item.label);
    assert.ok(expanded.length > collapsed.length, item.label);
  }
});

test("workflow summaries follow the spawn_agents-style grammar", () => {
  const context = rendererContext();
  const running = renderWorkflowResult(
    { content: [], details: { snapshot: workflowSnapshot() } },
    { isPartial: true },
    theme,
    context,
  );
  assert.deepEqual(running.render(200), [
    "workflow research · search · 1 done · 0 running · 0 failed · 12s",
  ]);
  stopRendererTimer(context);

  const success = renderWorkflowResult(
    { content: [], details: { snapshot: workflowSnapshot() } },
    { isPartial: false },
    theme,
    context,
  );
  assert.deepEqual(success.render(200), [
    "✓ workflow research · 1 done · 0 failed · 12s",
  ]);

  const partialFailure = renderWorkflowResult(
    {
      content: [],
      details: {
        snapshot: workflowSnapshot({
          agents: [
            workflowSnapshot().agents[0],
            {
              id: 2,
              intent: "Audit",
              capabilities: [],
              modelTier: "medium",
              thinking: "high",
              status: "error",
              startedAt: 2000,
              finishedAt: 3000,
            },
          ],
          agentFailureCount: 1,
          loggedBranchFailureCount: 1,
        }),
      },
    },
    { isPartial: false },
    theme,
    context,
  );
  assert.deepEqual(partialFailure.render(200), [
    "! workflow research · 1 done · 1 agent failed · 1 branch failed · 12s",
  ]);

  const failure = renderWorkflowResult(
    {
      content: [{ type: "text", text: "Error: timed out" }],
      details: {
        snapshot: workflowSnapshot(),
        errorCode: "workflow_timeout",
        counts: {
          completed: 1,
          failed: 1,
          timedOut: 1,
          canceled: 0,
          outstanding: 0,
        },
      },
    },
    { isPartial: false },
    theme,
    context,
  );
  assert.deepEqual(failure.render(200), [
    "✗ workflow research · workflow_timeout · 1 done · 1 failed · 1 timed out · 12s — timed out",
  ]);

  const list = renderWorkflowResult(
    {
      content: [],
      details: {
        action: "list",
        inventory: { storeDir: "/workflows", entries: [{ valid: true }] },
      },
    },
    { isPartial: false },
    theme,
    rendererContext({ action: "list", name: undefined }),
  );
  assert.deepEqual(list.render(200), ["✓ workflow list · 1 saved"]);

  const validate = renderWorkflowResult(
    {
      content: [],
      details: { action: "validate", meta: { name: "research" } },
    },
    { isPartial: false },
    theme,
    rendererContext({ action: "validate" }),
  );
  assert.deepEqual(validate.render(200), ["✓ workflow validate research"]);
});

test("workflow headers and fallback agent rows mute every separator", () => {
  const markerTheme = {
    bold: (value: string) => `*${value}*`,
    fg: (color: string, value: string) =>
      color === "toolTitle"
        ? `[${value}]`
        : color === "muted"
          ? `{${value}}`
          : value,
  };
  const lines = renderSnapshot(workflowSnapshot(), markerTheme, {
    final: true,
  });
  assert.deepEqual(lines, [
    "✓ [*workflow*] research{ · }{1 done · 0 failed · 12s}",
    "",
    "✓ Search docs{ · }{read-web · small/medium}{ · }{done}",
  ]);
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
  assert.deepEqual(result.render(200), ["✓ workflow validate valid"]);

  const hostilePolicy = renderSnapshot(
    workflowSnapshot({
      agents: [
        {
          ...workflowSnapshot().agents[0],
          capabilities: ["read-web\x1b[2J\nspoof"],
          modelTier: "small\nspoof",
          thinking: "medium\x1b[2J",
        },
      ],
    }),
    theme,
  );
  assert.ok(hostilePolicy.every((line) => !line.includes("\n")));
  assert.doesNotMatch(hostilePolicy.join("\n"), /\x1b/);
});
