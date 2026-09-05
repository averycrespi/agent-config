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
    assert.match(result.content[0].text, /researched/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].intent, "inspect files");
    assert.deepEqual(calls[0].capabilities, ["read-filesystem"]);
    assert.equal(calls[0].profile, "balanced");
    assert.equal("thinking" in calls[0], false);
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
        profile: "fast",
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
  assert.ok(lines.includes("✓ Search docs · 1s"));
  assert.ok(lines.includes("  fast (web)"));
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
        profile: "fast",
        status: "running",
        startedAt: 3000,
      },
      {
        id: 1,
        intent: "Oldest done",
        capabilities: [],
        profile: "fast",
        status: "done",
        startedAt: 1000,
        finishedAt: 1500,
      },
      {
        id: 2,
        intent: "Middle failed",
        capabilities: [],
        profile: "fast",
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
  assert.match(lines[0], /^workflow run ordered/);
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
        profile: "fast",
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
        profile: "fast",
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

test("workflow default rendering shows progress and inventory without diagnostics", () => {
  const context = rendererContext();
  assert.deepEqual(
    renderWorkflowCall(
      { action: "run", name: "research" },
      theme,
      context,
    ).render(200),
    [],
  );

  const snapshot = workflowSnapshot({
    logs: [{ level: "info", message: "fetched sources", timestamp: 2000 }],
    agents: [
      {
        ...workflowSnapshot().agents[0],
        logFile: "/tmp/agent.log",
        diagnosticWarnings: ["provider warning"],
      },
    ],
  });
  for (const isPartial of [true, false]) {
    const lines = renderWorkflowResult(
      { content: [], details: { snapshot } },
      { isPartial, expanded: false },
      theme,
      context,
    ).render(200);
    if (isPartial) stopRendererTimer(context);
    assert.ok(lines.some((line) => line.startsWith("✓ Search docs · ")));
    assert.doesNotMatch(lines.join("\n"), /Logs|agent\.log|provider warning/);
  }

  const errorLines = renderWorkflowResult(
    {
      content: [{ type: "text", text: "Error: timed out" }],
      details: {
        snapshot,
        errorCode: "workflow_timeout",
        recoveryFile: "/tmp/recovery.gz",
      },
    },
    { isPartial: false, expanded: false },
    theme,
    context,
  ).render(200);
  assert.ok(errorLines.some((line) => line.startsWith("✓ Search docs · ")));
  assert.doesNotMatch(errorLines.join("\n"), /Recovery:|recovery\.gz/);

  const inputError = renderWorkflowResult(
    {
      content: [{ type: "text", text: "Invalid workflow input: bad args" }],
      details: { action: "run", inputError: true },
    },
    { isPartial: false, expanded: false },
    theme,
    context,
  ).render(200);
  assert.equal(inputError.length, 1);

  const listLines = renderWorkflowResult(
    {
      content: [],
      details: {
        action: "list",
        inventory: {
          storeDir: "/workflows",
          entries: [
            { name: "research", description: "Research", valid: true },
            { name: "broken", diagnostic: "bad metadata", valid: false },
          ],
        },
      },
    },
    { isPartial: false, expanded: false },
    theme,
    context,
  ).render(200);
  assert.ok(listLines.includes("✓ research — Research"));
  assert.ok(listLines.includes("✗ broken"));
  assert.doesNotMatch(listLines.join("\n"), /store \/workflows|bad metadata/);

  const validateLines = renderWorkflowResult(
    {
      content: [],
      details: {
        action: "validate",
        meta: { name: "research" },
        sourceFile: "/workflows/research.js",
      },
    },
    { isPartial: false, expanded: false },
    theme,
    context,
  ).render(200);
  assert.deepEqual(validateLines, ["✓ workflow validate research"]);
});

test("expanded workflows preserve default progress and add diagnostics", () => {
  const context = rendererContext();
  const snapshot = workflowSnapshot({
    logs: [{ level: "info", message: "fetched sources", timestamp: 2000 }],
    agents: [
      {
        ...workflowSnapshot().agents[0],
        logFile: "/tmp/agent.log",
        diagnosticWarnings: ["provider warning"],
      },
      {
        id: 2,
        intent: "Audit sources",
        capabilities: ["read-filesystem"],
        profile: "balanced",
        status: "done",
        startedAt: 2000,
        finishedAt: 8000,
      },
    ],
  });
  const cases = [
    {
      label: "running",
      result: { content: [], details: { snapshot } },
      partial: true,
      diagnostic: /Logs/,
    },
    {
      label: "success",
      result: { content: [], details: { snapshot } },
      partial: false,
      diagnostic: /agent\.log/,
    },
    {
      label: "error",
      result: {
        content: [{ type: "text", text: "Error: timed out" }],
        details: {
          snapshot,
          errorCode: "workflow_timeout",
          recoveryFile: "/tmp/recovery.gz",
        },
      },
      partial: false,
      diagnostic: /Recovery: \/tmp\/recovery\.gz/,
    },
    {
      label: "list",
      result: {
        content: [],
        details: {
          action: "list",
          inventory: {
            storeDir: "/workflows",
            entries: [
              { name: "research", valid: true },
              { name: "broken", diagnostic: "bad metadata", valid: false },
            ],
          },
        },
      },
      partial: false,
      diagnostic: /store \/workflows[\s\S]*bad metadata/,
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
      diagnostic: /source \/workflows\/research\.js/,
    },
  ];

  for (const item of cases) {
    const defaultLines = renderWorkflowResult(
      item.result,
      { isPartial: item.partial, expanded: false },
      theme,
      context,
    ).render(300);
    const expandedLines = renderWorkflowResult(
      item.result,
      { isPartial: item.partial, expanded: true },
      theme,
      context,
    ).render(300);
    if (item.partial) stopRendererTimer(context);
    assert.equal(expandedLines[0], defaultLines[0], item.label);
    const isProgressLine = (line: string) =>
      /^(?:✓|✗|!|●|○|…) (?:Search docs|Audit sources) · /.test(line) ||
      /^  (?:fast|balanced)/.test(line);
    assert.deepEqual(
      expandedLines.filter(isProgressLine),
      defaultLines.filter(isProgressLine),
      `${item.label} preserves complete progress rows in order`,
    );
    assert.match(expandedLines.join("\n"), item.diagnostic, item.label);
    assert.doesNotMatch(defaultLines.join("\n"), item.diagnostic, item.label);
  }
});

test("workflow summaries use explicit action grammar", () => {
  const context = rendererContext();
  const running = renderWorkflowResult(
    { content: [], details: { snapshot: workflowSnapshot() } },
    { isPartial: true },
    theme,
    context,
  );
  assert.equal(
    running.render(200)[0],
    "workflow run research · search · 1 done · 0 running · 0 failed · 12s",
  );
  stopRendererTimer(context);

  const success = renderWorkflowResult(
    { content: [], details: { snapshot: workflowSnapshot() } },
    { isPartial: false },
    theme,
    context,
  );
  assert.equal(
    success.render(200)[0],
    "✓ workflow run research · 1 done · 0 failed · 12s",
  );

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
              profile: "balanced",
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
  assert.equal(
    partialFailure.render(200)[0],
    "! workflow run research · 1 done · 1 agent failed · 1 branch failed · 12s",
  );

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
  assert.equal(
    failure.render(200)[0],
    "✗ workflow run research · workflow_timeout · 1 done · 1 failed · 1 timed out · 12s — timed out",
  );

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
  assert.equal(list.render(200)[0], "✓ workflow list · 1 saved");

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

test("workflow agent rows keep timeout before the volatile tool", () => {
  const snapshot = workflowSnapshot({
    agents: [
      {
        ...workflowSnapshot().agents[0],
        status: "running",
        explicitTimeoutMs: 30_000,
        activity: {
          intent: "Search docs",
          capabilities: ["read-web"],
          profile: "fast",
          phase: "web_fetch",
          activeTool: "web_fetch",
          recentEvents: [],
          toolUseCount: 3,
          totalTokens: 7200,
          resolved: false,
          startedAt: Date.now() - 18_000,
          lastUpdateAt: Date.now(),
        },
      },
    ],
  });

  const lines = renderSnapshot(snapshot, theme);
  assert.match(
    lines.find((line) => line.startsWith("● Search docs")) ?? "",
    /^● Search docs · \d+s · 3 tool uses · 7\.2k tokens$/,
  );
  assert.equal(
    lines.find((line) => line.startsWith("  fast")),
    "  fast (web) · timeout 30s · web_fetch",
  );
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
    "✓ [*workflow*] run research{ · }{1 done · 0 failed · 12s}",
    "",
    "✓ Search docs{ · }{12s}",
    "  {fast (web)}",
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
          profile: "fast\nspoof\x1b[2J",
        },
      ],
    }),
    theme,
  );
  assert.ok(hostilePolicy.every((line) => !line.includes("\n")));
  assert.doesNotMatch(hostilePolicy.join("\n"), /\x1b/);
});
