import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import registerWorkflowsExtension from "./index.ts";
import { registerWorkflowTool } from "./workflow-tool.ts";
import { DEFAULT_WORKFLOW_CONFIG } from "./config.ts";
import { formatConfigForDisplay } from "../_shared/config.ts";
import {
  renderSnapshot,
  renderWorkflowCall,
  renderWorkflowResult,
} from "./display.ts";

function makePi() {
  let registered: any;
  return {
    pi: {
      registerTool(tool: any) {
        registered = tool;
      },
      getThinkingLevel() {
        return "off";
      },
    },
    get tool() {
      return registered;
    },
  };
}

test("extension relies on tool prompt guidelines without duplicate prompt injection", () => {
  const beforeAgentStartPrompts: string[] = [];
  let registeredTool: any;
  const pi = {
    registerCommand() {},
    registerTool(tool: any) {
      registeredTool = tool;
    },
    getThinkingLevel() {
      return "off";
    },
    addBeforeAgentStart(prompt: string) {
      beforeAgentStartPrompts.push(prompt);
    },
  };

  registerWorkflowsExtension(pi as any);

  assert.deepEqual(beforeAgentStartPrompts, []);
  assert.ok(registeredTool.promptGuidelines.length > 0);
  const guidance = [
    registeredTool.description,
    ...registeredTool.promptGuidelines,
  ].join("\n");
  for (const term of [
    "verify",
    "report",
    "budget",
    "concurrency",
    "workflow_run_cap_exceeded",
    "workflow_budget_exceeded",
    'model: "small"',
    'model: "big"',
    "context?",
    "resolves { ok, reasons }",
    "gate: () => verdict",
  ]) {
    assert.match(
      guidance,
      new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("workflows config display includes all eight effective fields", () => {
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
    "modelTierSmall",
    "modelTierBig",
    "userWorkflowsDir",
  ]) {
    assert.match(display, new RegExp(`"${field}"`));
  }
  assert.match(display, /"modelTierSmall": "openai-codex\/gpt-5\.6-luna"/);
  assert.match(display, /"modelTierBig": "openai-codex\/gpt-5\.6-sol"/);
});

test("workflow tool surfaces config warnings during execution", async () => {
  const harness = makePi();
  const notifications: Array<[string, string]> = [];
  registerWorkflowTool(harness.pi as any, async (_cwd, warnings = []) => {
    warnings.push("Ignoring invalid maxTokensPerRun; using default.");
    return DEFAULT_WORKFLOW_CONFIG;
  });
  await harness.tool.execute(
    "wf-warning",
    {
      action: "run",
      script: `export const meta = { name: "warning", description: "warning" };
export async function run() { if (false) await agent("unused"); return "ok"; }`,
    },
    undefined,
    undefined,
    {
      cwd: "/tmp",
      ui: {
        notify(message: string, level: string) {
          notifications.push([message, level]);
        },
      },
    },
  );
  assert.deepEqual(notifications, [
    ["Ignoring invalid maxTokensPerRun; using default.", "warning"],
  ]);
});

test("workflow tool returns validation errors as tool text", async () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  const result = await harness.tool.execute(
    "wf",
    { action: "run", script: "const x = 1;" },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.match(result.content[0].text, /^Error:/);
  assert.equal(result.details.validationError, true);
});

test("workflow tool spills large final output", async () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  const script = `export const meta = { name: "large", description: "large" };
export async function run() {
  if (false) await agent("not run");
  return "x".repeat(26000);
}`;
  const result = await harness.tool.execute(
    "wf-large-test",
    { action: "run", script },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.equal(result.details.spilled, true);
  assert.match(result.content[0].text, /<persisted-output>/);
});

test("workflow tool reports agent, logged, and settled failures separately", async () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  const script = `export const meta = { name: "counts", description: "counts" };
export async function run() {
  return await parallelSettled([
    () => agent("blocked", { agent: "writer" }),
  ]);
}`;
  const result = await harness.tool.execute(
    "wf-count-test",
    { action: "run", script },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );

  assert.match(result.content[0].text, /Agent failures: 1/);
  assert.match(result.content[0].text, /Branch failures: 0 logged, 1 settled/);
  assert.equal(result.details.agentFailureCount, 1);
  assert.equal(result.details.loggedBranchFailureCount, 0);
  assert.equal(result.details.settledBranchFailureCount, 1);
});

test("workflow tool formats cyclic final results safely", async () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  const script = `export const meta = { name: "cycle", description: "cycle" };
export async function run() {
  if (false) await agent("not run");
  const value = { name: "cycle" };
  value.self = value;
  return value;
}`;
  const result = await harness.tool.execute(
    "wf-cycle-test",
    { action: "run", script },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.match(result.content[0].text, /\[Circular\]/);
});

test("workflow schema requires a Google-compatible compound action", () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  assert.deepEqual(harness.tool.parameters.required, ["action"]);
  assert.deepEqual(harness.tool.parameters.properties.action.enum, [
    "run",
    "list",
    "validate",
  ]);
  assert.equal(harness.tool.parameters.properties.script.type, "string");
  assert.equal(harness.tool.parameters.properties.name.type, "string");
});

test("workflow execute-time validation collects action field errors", async () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  const result = await harness.tool.execute(
    "matrix",
    { action: "validate", script: "x", name: "y", args: { extra: true } },
    undefined,
    undefined,
    { cwd: "/tmp", ui: { notify() {} } },
  );
  assert.match(result.content[0].text, /exactly one of script or name/);
  assert.match(result.content[0].text, /args is not accepted/);
  assert.equal(result.details.inputError, true);

  const list = await harness.tool.execute(
    "matrix-list",
    { action: "list", script: "x", name: "y", args: 1 },
    undefined,
    undefined,
    { cwd: "/tmp", ui: { notify() {} } },
  );
  assert.match(list.content[0].text, /script is not accepted/);
  assert.match(list.content[0].text, /name is not accepted/);
  assert.match(list.content[0].text, /args is not accepted/);
});

test("list and inline validation do not load agents or write artifacts", async () => {
  const harness = makePi();
  let agentLoads = 0;
  let artifactWrites = 0;
  registerWorkflowTool(harness.pi as any, async () => DEFAULT_WORKFLOW_CONFIG, {
    loadAgents: () => {
      agentLoads += 1;
      return [];
    },
    persistScript: async () => {
      artifactWrites += 1;
      return "/tmp/not-used.js";
    },
  });
  const context = { cwd: "/tmp", ui: { notify() {} } };
  const listed = await harness.tool.execute(
    "list",
    { action: "list" },
    undefined,
    undefined,
    context,
  );
  assert.equal(listed.details.action, "list");
  const validated = await harness.tool.execute(
    "validate",
    {
      action: "validate",
      script: `export const meta = { name: "inline", description: "inline" };\nexport async function run() { if (false) await agent("unused"); }`,
    },
    undefined,
    undefined,
    context,
  );
  assert.equal(validated.details.action, "validate");
  assert.equal(validated.details.meta.name, "inline");
  assert.equal(agentLoads, 0);
  assert.equal(artifactWrites, 0);
});

test("named validation and run report source and immutable script paths", async (t) => {
  const dir = join(tmpdir(), `workflow-tool-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = `export const meta = { name: "saved", description: "saved" };\nexport async function run() { if (false) await agent("unused"); return args; }`;
  const sourceFile = join(dir, "saved.js");
  await writeFile(sourceFile, source);
  const config = { ...DEFAULT_WORKFLOW_CONFIG, userWorkflowsDir: dir };
  const harness = makePi();
  registerWorkflowTool(harness.pi as any, async () => config);
  const context = { cwd: dir, ui: { notify() {} } };

  const validated = await harness.tool.execute(
    "validate-saved",
    { action: "validate", name: "saved" },
    undefined,
    undefined,
    context,
  );
  assert.equal(validated.details.sourceFile, sourceFile);
  assert.equal(validated.details.meta.name, "saved");

  const result = await harness.tool.execute(
    "run-saved",
    { action: "run", name: "saved", args: { ok: true } },
    undefined,
    undefined,
    context,
  );
  assert.equal(result.details.sourceFile, sourceFile);
  assert.match(result.details.scriptFile, /\.js$/);
  assert.match(
    result.content[0].text,
    new RegExp(
      result.details.scriptFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
  assert.match(result.content[0].text, /Saved source:/);
});

test("unknown and parser-invalid workflows never persist or spawn", async () => {
  const harness = makePi();
  let writes = 0;
  let loads = 0;
  registerWorkflowTool(harness.pi as any, async () => DEFAULT_WORKFLOW_CONFIG, {
    resolveSaved: async () => {
      throw new Error('Unknown saved workflow "missing"');
    },
    persistScript: async () => {
      writes += 1;
      return "/tmp/no.js";
    },
    loadAgents: () => {
      loads += 1;
      return [];
    },
  });
  const context = { cwd: "/tmp", ui: { notify() {} } };
  const unknown = await harness.tool.execute(
    "unknown",
    { action: "run", name: "missing" },
    undefined,
    undefined,
    context,
  );
  assert.match(unknown.content[0].text, /Unknown saved workflow/);
  const forbidden = await harness.tool.execute(
    "forbidden",
    {
      action: "run",
      script: `export const meta = { name: "bad", description: "bad" };\nexport async function run() { return fetch("https://example.com") || agent("unused"); }`,
    },
    undefined,
    undefined,
    context,
  );
  assert.match(forbidden.content[0].text, /fetch is not allowed/);
  assert.equal(writes, 0);
  assert.equal(loads, 0);
});

test("runtime failures retain script and saved source paths", async (t) => {
  const dir = join(tmpdir(), `workflow-failure-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceFile = join(dir, "failure.js");
  await writeFile(
    sourceFile,
    `export const meta = { name: "failure", description: "failure" };\nexport async function run() { if (false) await agent("unused"); throw new Error("boom"); }`,
  );
  const harness = makePi();
  registerWorkflowTool(harness.pi as any, async () => ({
    ...DEFAULT_WORKFLOW_CONFIG,
    userWorkflowsDir: dir,
  }));
  const result = await harness.tool.execute(
    "failure",
    { action: "run", name: "failure" },
    undefined,
    undefined,
    { cwd: dir, ui: { notify() {} } },
  );
  assert.match(result.content[0].text, /Error: boom/);
  assert.match(result.content[0].text, /Run script:/);
  assert.match(result.content[0].text, /Saved source:/);
  assert.equal(result.details.sourceFile, sourceFile);
  assert.match(result.details.scriptFile, /\.js$/);
});

test("artifact persistence fails closed before agent loading", async () => {
  const harness = makePi();
  let agentLoads = 0;
  registerWorkflowTool(harness.pi as any, async () => DEFAULT_WORKFLOW_CONFIG, {
    loadAgents: () => {
      agentLoads += 1;
      return [];
    },
    persistScript: async () => {
      throw new Error("disk denied");
    },
  });
  const result = await harness.tool.execute(
    "persist-fail",
    {
      action: "run",
      script: `export const meta = { name: "fail", description: "fail" };\nexport async function run() { if (false) await agent("unused"); }`,
    },
    undefined,
    undefined,
    { cwd: "/tmp", ui: { notify() {} } },
  );
  assert.match(result.content[0].text, /disk denied/);
  assert.equal(result.details.artifactError, true);
  assert.equal(agentLoads, 0);
});

test("extension registers workflows-list with live inventory output", async () => {
  const commands = new Map<string, any>();
  const pi = {
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    registerTool() {},
    getThinkingLevel() {
      return "off";
    },
  };
  registerWorkflowsExtension(pi as any);
  assert.ok(commands.has("workflows-list"));
  const notifications: Array<[string, string]> = [];
  await commands.get("workflows-list").handler("", {
    cwd: "/tmp",
    ui: {
      notify(message: string, level: string) {
        notifications.push([message, level]);
      },
    },
  });
  assert.match(notifications[0]![0], /^Saved workflows:/);
});

test("renderWorkflowCall suppresses noisy script metadata", () => {
  const component = renderWorkflowCall(
    {
      action: "run",
      script: 'export const meta = { name: "x", description: "x" };',
    },
    {},
    {},
  );
  assert.deepEqual(component.render(80), []);
});

test("list and validate rendering is compact, width-aware, and source-free", () => {
  const theme = { fg: (_color: string, value: string) => value };
  const list = renderWorkflowResult(
    {
      content: [
        { type: "text", text: "raw inventory that should not be rendered" },
      ],
      details: {
        action: "list",
        inventory: {
          storeDir: "/tmp/workflows",
          entries: [
            {
              filename: "safe.js",
              name: "safe",
              description: "one line",
              valid: true,
              sourcePath: "/tmp/workflows/safe.js",
            },
          ],
        },
      },
    },
    {},
    theme,
    { state: {}, invalidate() {} },
  );
  assert.ok(list.render(30).every((line: string) => visibleWidth(line) <= 30));
  assert.doesNotMatch(list.render(120).join("\n"), /raw inventory/);

  const validate = renderWorkflowResult(
    {
      content: [{ type: "text", text: "Workflow safe is valid." }],
      details: {
        action: "validate",
        meta: { name: "safe", description: "safe" },
        sourceFile: "/tmp/workflows/safe.js",
      },
    },
    {},
    theme,
    { state: {}, invalidate() {} },
  );
  assert.match(validate.render(120)[0], /validated safe/);
});

test("renderSnapshot shows compact workflow agent rows and logs", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const lines = renderSnapshot(
    {
      meta: { name: "audit", description: "Audit" },
      phase: "fanout",
      phases: ["fanout"],
      logs: [{ level: "info", message: "hello", timestamp: 1 }],
      agents: [
        {
          id: 1,
          agent: "explorer",
          intent: "a",
          prompt: "a",
          status: "done",
          startedAt: 1,
          activity: {
            intent: "a",
            agentType: "explorer",
            phase: "done",
            recentEvents: [],
            toolUseCount: 1,
            totalTokens: 12,
            resolved: true,
            startedAt: 1,
            lastUpdateAt: 1001,
          },
        },
        {
          id: 2,
          agent: "reviewer",
          intent: "b",
          prompt: "b",
          status: "running",
          startedAt: 1,
        },
      ],
      agentFailureCount: 0,
      loggedBranchFailureCount: 0,
      settledBranchFailureCount: 0,
      startedAt: Date.now(),
    },
    theme,
  );
  assert.match(lines[0], /Workflow: audit · fanout/);
  assert.match(lines[0], /1 done · 1 running/);
  assert.equal(lines[1], "");
  assert.match(lines[2], /^✓ explorer: a · 1 tool use/);
  assert.match(lines[3], /^● reviewer: b · initializing/);
  assert.equal(lines[4], "");
  assert.match(lines[6], /hello/);
});

test("renderSnapshot keeps multiline activity within one physical row", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const lines = renderSnapshot(
    {
      meta: { name: "audit", description: "Audit" },
      phases: [],
      logs: [],
      agents: [
        {
          id: 1,
          agent: "analyst",
          intent: "inspect",
          prompt: "inspect",
          status: "running",
          startedAt: 1,
          activity: {
            intent: "inspect",
            agentType: "analyst",
            phase: "bash",
            recentEvents: [
              {
                kind: "tool",
                text: "bash: python3 - <<'PY'\nprint('ok')\nPY",
              },
            ],
            toolUseCount: 1,
            totalTokens: 10,
            resolved: false,
            startedAt: 1,
            lastUpdateAt: 1001,
          },
        },
      ],
      agentFailureCount: 0,
      loggedBranchFailureCount: 0,
      settledBranchFailureCount: 0,
      startedAt: 1,
    },
    theme,
  );

  assert.ok(lines.every((line) => !/[\r\n]/.test(line)));
  assert.match(lines[2], /bash: python3 - <<'PY' print\('ok'\) PY/);
});

test("renderSnapshot keeps completed status while showing handled failures", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const lines = renderSnapshot(
    {
      meta: { name: "counts", description: "Counts" },
      phases: [],
      logs: [],
      agents: [],
      agentFailureCount: 1,
      loggedBranchFailureCount: 0,
      settledBranchFailureCount: 1,
      startedAt: 1,
      finishedAt: 1001,
    },
    theme,
    { final: true },
  );

  assert.match(lines[0], /^Workflow: counts ✓ · 1s/);
  assert.match(lines[0], /1 agent failed/);
  assert.match(lines[0], /1 settled branch failure/);
});

test("renderWorkflowResult uses one final workflow header when snapshot exists", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const component = renderWorkflowResult(
    {
      content: [
        {
          type: "text",
          text: "Workflow audit completed in 1.0s.\nFailures: 0\n\n[]",
        },
      ],
      details: {
        snapshot: {
          meta: { name: "audit", description: "Audit" },
          phase: "done",
          phases: ["fanout", "done"],
          logs: [],
          agents: [
            {
              id: 1,
              agent: "explorer",
              intent: "a",
              prompt: "a",
              status: "done",
              startedAt: 1,
              activity: {
                intent: "a",
                agentType: "explorer",
                phase: "done",
                recentEvents: [],
                toolUseCount: 1,
                totalTokens: 0,
                resolved: true,
                startedAt: 1,
                lastUpdateAt: 1001,
              },
            },
          ],
          agentFailureCount: 0,
          loggedBranchFailureCount: 0,
          settledBranchFailureCount: 0,
          startedAt: 1,
          finishedAt: 1001,
        },
      },
    },
    { isPartial: false },
    theme,
    { state: {}, invalidate() {} },
  );
  const lines = component.render(120);
  assert.match(lines[0], /^Workflow: audit ✓ · 1s · 1 done · 0 agents failed$/);
  assert.match(lines[2], /^✓ explorer: a · 1 tool use · 1s$/);
  assert.ok(!lines.some((line) => line.startsWith("✓ workflow")));
  assert.ok(!lines.some((line) => line.includes("Workflow audit completed")));
});
