import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import registerWorkflowsExtension from "./index.ts";
import { registerWorkflowTool as registerWorkflowToolProduction } from "./workflow-tool.ts";
import { DEFAULT_WORKFLOW_CONFIG } from "./config.ts";
import { formatConfigForDisplay } from "../_shared/config.ts";
import {
  renderSnapshot,
  renderWorkflowCall,
  renderWorkflowResult,
} from "./display.ts";
import { persistWorkflowScript } from "./script-artifacts.ts";

const TEST_ARTIFACT_DIR = join(
  tmpdir(),
  `workflow-tool-artifacts-${process.pid}-${Date.now()}`,
);
after(() => rm(TEST_ARTIFACT_DIR, { recursive: true, force: true }));

function registerWorkflowTool(
  pi: Parameters<typeof registerWorkflowToolProduction>[0],
  loadConfig?: Parameters<typeof registerWorkflowToolProduction>[1],
  overrides: Parameters<typeof registerWorkflowToolProduction>[2] = {},
): void {
  registerWorkflowToolProduction(pi, loadConfig, {
    persistScript: (source, toolCallId, workflowName) =>
      persistWorkflowScript(
        source,
        toolCallId,
        workflowName,
        TEST_ARTIFACT_DIR,
      ),
    ...overrides,
  });
}

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

test("workflows config display includes all nine effective fields", () => {
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

test("workflow tool persists path-only abnormal recovery without masking the cause", async () => {
  const harness = makePi();
  let envelope: any;
  registerWorkflowTool(harness.pi as any, undefined, {
    persistRecovery: async (_id, value) => {
      envelope = value;
      return { retained: true, path: "/tmp/recovery.json.gz" };
    },
  });
  const result = await harness.tool.execute(
    "wf-recovery",
    {
      action: "run",
      args: { secretArg: "ARG_SECRET" },
      script: `export const meta = { name: "recovery", description: "recovery" };
export async function run() {
  await parallelSettled([() => agent("PROMPT_SECRET", { agent: "writer" })]);
  const error = new Error("top-level boom");
  error.details = { secret: args.secretArg };
  throw error;
}`,
    },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );

  assert.equal(result.details.errorCode, "workflow_script_error");
  assert.equal(result.details.recoveryFile, "/tmp/recovery.json.gz");
  assert.match(result.content[0].text, /top-level boom/);
  assert.match(result.content[0].text, /1 failed/);
  assert.match(
    result.content[0].text,
    /Recovery artifact: \/tmp\/recovery\.json\.gz/,
  );
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.calls.length, 1);
  assert.equal(envelope.calls[0].failure.code, "agent_policy_rejected");
  assert.deepEqual(envelope.primaryFailure, {
    code: "workflow_script_error",
    message: "workflow script failed",
  });
  assert.doesNotMatch(
    JSON.stringify(envelope),
    /PROMPT_SECRET|ARG_SECRET|top-level boom/,
  );
  assert.equal("calls" in result.details, false);
});

test("workflow tool skips empty recovery and preserves persistence failures as warnings", async () => {
  const harness = makePi();
  let persistCalls = 0;
  registerWorkflowTool(harness.pi as any, undefined, {
    persistRecovery: async () => {
      persistCalls += 1;
      throw new Error("disk unavailable");
    },
  });

  const missing = await harness.tool.execute(
    "wf-missing",
    {
      action: "run",
      script: `export const meta = { name: "missing", description: "missing" };
export async function run() { if (false) await agent("unused"); }`,
    },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.equal(missing.details.errorCode, "workflow_missing_result");
  assert.equal(persistCalls, 0);
  assert.ok(missing.details.scriptFile);
  assert.ok(missing.details.snapshot);

  const failed = await harness.tool.execute(
    "wf-persist-warning",
    {
      action: "run",
      script: `export const meta = { name: "warning", description: "warning" };
export async function run() {
  await parallelSettled([() => agent("blocked", { agent: "writer" })]);
  throw new Error("primary failure");
}`,
    },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.equal(persistCalls, 1);
  assert.equal(failed.details.errorCode, "workflow_script_error");
  assert.match(failed.content[0].text, /primary failure/);
  assert.match(failed.content[0].text, /disk unavailable/);
  assert.match(failed.details.persistenceWarning, /disk unavailable/);
  assert.equal(failed.details.recoveryFile, undefined);
});

test("workflow tool preserves artifact visibility when hostile metadata forces spillover", async () => {
  const harness = makePi();
  registerWorkflowTool(harness.pi as any);
  const name = "n".repeat(26_000);
  const script = `export const meta = { name: ${JSON.stringify(name)}, description: "large name" };\nexport async function run() { if (false) await agent("not run"); return "ok"; }`;
  const result = await harness.tool.execute(
    "wf-hostile-name",
    { action: "run", script },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.equal(result.details.spilled, true);
  assert.match(result.content[0].text, /Run script:/);
  assert.ok(result.content[0].text.includes(result.details.scriptFile));
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
  assert.equal(harness.tool.parameters.additionalProperties, false);
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

  for (const [label, params] of [
    ["run-empty", { action: "run" }],
    ["run-both", { action: "run", script: "x", name: "y" }],
    ["validate-empty", { action: "validate" }],
  ] as const) {
    const invalid = await harness.tool.execute(
      label,
      params,
      undefined,
      undefined,
      { cwd: "/tmp", ui: { notify() {} } },
    );
    assert.match(invalid.content[0].text, /exactly one of script or name/);
    assert.equal(invalid.details.inputError, true);
  }
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
  const config = {
    ...DEFAULT_WORKFLOW_CONFIG,
    maxVisibleSettledAgents: 2,
    userWorkflowsDir: dir,
  };
  const harness = makePi();
  let agentLoads = 0;
  let artifactWrites = 0;
  registerWorkflowTool(harness.pi as any, async () => config, {
    loadAgents: () => {
      agentLoads += 1;
      return [];
    },
    persistScript: async (script, toolCallId) => {
      artifactWrites += 1;
      const path = join(dir, `${toolCallId}.js`);
      await writeFile(path, script);
      return path;
    },
  });
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
  assert.equal(agentLoads, 0);
  assert.equal(artifactWrites, 0);

  const result = await harness.tool.execute(
    "run-saved",
    { action: "run", name: "saved", args: { ok: true } },
    undefined,
    undefined,
    context,
  );
  assert.equal(result.details.sourceFile, sourceFile);
  assert.equal(result.details.maxVisibleSettledAgents, 2);
  assert.match(result.details.scriptFile, /\.js$/);
  assert.match(
    result.content[0].text,
    new RegExp(
      result.details.scriptFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
  assert.match(result.content[0].text, /Saved source:/);
  assert.equal(agentLoads, 1);
  assert.equal(artifactWrites, 1);
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
  assert.match(result.content[0].text, /Error \[workflow_script_error\]: boom/);
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

test("renderWorkflowCall uses a stable themed summary without inline source", () => {
  const theme = {
    bold: (value: string) => `<bold>${value}</bold>`,
    fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
  };
  const component = renderWorkflowCall(
    {
      action: "run",
      script: 'export const meta = { name: "secret", description: "secret" };',
    },
    theme,
    { lastComponent: undefined },
  );
  const line = component.render(120)[0]!;
  assert.equal(
    line,
    "<toolTitle><bold>workflow</bold></toolTitle> <muted>run</muted>",
  );
  assert.doesNotMatch(line, /secret|export const/);
});

test("renderWorkflowCall bounds dynamic display fields before width truncation", () => {
  const theme = {
    bold: (value: string) => value,
    fg: (_color: string, value: string) => value,
  };
  const component = renderWorkflowCall(
    { action: "run", name: "x".repeat(10_000) },
    theme,
    { lastComponent: undefined },
  );
  assert.ok(visibleWidth(component.render(20_000)[0]!) < 2_100);
});

test("list and validate rendering is compact by default and detailed when expanded", () => {
  const theme = { fg: (_color: string, value: string) => value };
  const result = {
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
            description:
              "one\nline\t\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007",
            valid: true,
            sourcePath: "/tmp/workflows/safe.js",
          },
        ],
      },
    },
  };
  const collapsed = renderWorkflowResult(result, { expanded: false }, theme, {
    state: {},
    invalidate() {},
  });
  assert.deepEqual(collapsed.render(120), ["✓ 1 saved workflow"]);

  const expanded = renderWorkflowResult(result, { expanded: true }, theme, {
    state: {},
    invalidate() {},
  });
  assert.ok(
    expanded.render(30).every((line: string) => visibleWidth(line) <= 30),
  );
  assert.match(expanded.render(120).join("\n"), /saved workflows.*safe/s);
  assert.doesNotMatch(
    expanded.render(120).join("\n"),
    /raw inventory|\u001b|\u0007|\nline/,
  );

  const validateResult = {
    content: [{ type: "text", text: "Workflow safe is valid." }],
    details: {
      action: "validate",
      meta: { name: "safe", description: "safe" },
      sourceFile: "/tmp/workflows/safe.js",
    },
  };
  const validateCollapsed = renderWorkflowResult(
    validateResult,
    { expanded: false },
    theme,
    { state: {}, invalidate() {} },
  );
  assert.deepEqual(validateCollapsed.render(120), ["✓ validated safe"]);
  const validateExpanded = renderWorkflowResult(
    validateResult,
    { expanded: true },
    theme,
    { state: {}, invalidate() {} },
  );
  assert.match(
    validateExpanded.render(120)[0],
    /validated safe.*workflows\/safe.js/,
  );
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
  assert.match(lines[2], /^● reviewer: b · initializing/);
  assert.match(lines[3], /^✓ explorer: a · 1 tool use/);
  assert.equal(lines[4], "");
  assert.match(lines[6], /hello/);
});

test("renderSnapshot bounds settled agents while keeping running agents visible", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (color: string, text: string) =>
      color === "dim" ? `<dim>${text}</dim>` : text,
  };
  const agent = (
    id: number,
    status: "running" | "done" | "error" | "aborted",
    explicitTimeoutMs?: number,
  ) => ({
    id,
    agent: "explorer",
    intent: `agent-${id}`,
    prompt: `agent-${id}`,
    status,
    effectiveTimeoutMs: 600_000,
    ...(explicitTimeoutMs === undefined ? {} : { explicitTimeoutMs }),
    startedAt: id,
    ...(status === "running" ? {} : { finishedAt: id + 100 }),
  });
  const lines = renderSnapshot(
    {
      meta: { name: "audit", description: "Audit" },
      phases: [],
      logs: [],
      agents: [
        agent(1, "done"),
        agent(2, "error"),
        agent(3, "running"),
        agent(4, "done"),
        agent(5, "aborted"),
        agent(6, "running"),
        agent(7, "done", 25),
      ],
      agentFailureCount: 2,
      loggedBranchFailureCount: 0,
      settledBranchFailureCount: 0,
      startedAt: Date.now(),
    },
    theme,
    { maxVisibleSettledAgents: 2 },
  );

  assert.equal(
    lines[2],
    "<dim>↑ 3 earlier agents hidden · 2 done · 1 failed</dim>",
  );
  assert.match(lines[3], /^● explorer: agent-3/);
  assert.match(lines[4], /^● explorer: agent-6/);
  assert.match(lines[5], /^! explorer: agent-5/);
  assert.match(lines[6], /^✓ explorer: agent-7.*timeout 25ms/);
  assert.equal(lines.length, 7);
  assert.ok(!lines.some((line) => line.includes("agent-1")));
  assert.ok(!lines.some((line) => line.includes("agent-2")));
  assert.ok(!lines.some((line) => line.includes("agent-4")));
  assert.ok(!lines.some((line) => line.includes("timeout 600000ms")));
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

test("renderWorkflowResult keeps run summaries compact until expanded", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const result = {
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
  };
  const collapsed = renderWorkflowResult(
    result,
    { isPartial: false, expanded: false },
    theme,
    { state: {}, invalidate() {} },
  );
  assert.deepEqual(collapsed.render(120), ["✓ audit · 1 done · 0 failed · 1s"]);

  const expanded = renderWorkflowResult(
    result,
    { isPartial: false, expanded: true },
    theme,
    { state: {}, invalidate() {} },
  );
  const lines = expanded.render(120);
  assert.equal(lines[0], "");
  assert.match(lines[1], /^Workflow: audit ✓ · 1s · 1 done · 0 agents failed$/);
  assert.match(lines[3], /^✓ explorer: a · 1 tool use · 1s$/);
  assert.ok(!lines.some((line) => line.startsWith("✓ workflow")));
  assert.ok(!lines.some((line) => line.includes("Workflow audit completed")));
});

test("partial workflow results are compact, expandable, and control-safe", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const result = {
    content: [{ type: "text", text: "Running workflow audit..." }],
    details: {
      snapshot: {
        meta: { name: "audit", description: "Audit" },
        phase: "fanout",
        phases: ["fanout"],
        logs: [
          {
            level: "info",
            message: "hello\nworld\u001b]8;;https://example.com\u0007link",
            timestamp: 1,
          },
        ],
        agents: [
          {
            id: 1,
            agent: "explorer",
            intent: "done",
            prompt: "done",
            status: "done",
            startedAt: 1,
          },
          {
            id: 2,
            agent: "reviewer",
            intent: "running",
            prompt: "running",
            status: "running",
            startedAt: 1,
            activity: {
              intent: "running",
              agentType: "reviewer",
              phase: "bash",
              recentEvents: [
                {
                  kind: "tool",
                  text: "recent\u001b]8;;https://example.com\u0007link",
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
        startedAt: Date.now(),
      },
    },
  };
  const collapsedContext = { state: {}, invalidate() {} };
  const collapsed = renderWorkflowResult(
    result,
    { isPartial: true, expanded: false },
    theme,
    collapsedContext,
  );
  assert.match(
    collapsed.render(120)[0],
    /^Running audit · fanout · 1 done · 1 running · 0 failed · 0s$/,
  );
  assert.equal(collapsed.render(120).length, 1);

  const expandedContext = { state: {}, invalidate() {} };
  const expanded = renderWorkflowResult(
    result,
    { isPartial: true, expanded: true },
    theme,
    expandedContext,
  );
  const expandedLines = expanded.render(160);
  assert.equal(expandedLines[0], "");
  const expandedText = expandedLines.join("\n");
  assert.match(expandedText, /recentlink/);
  assert.match(expandedText, /Logs.*hello worldlink/s);
  assert.doesNotMatch(expandedText, /\u001b|\u0007/);

  renderWorkflowResult(result, { isPartial: false }, theme, collapsedContext);
  renderWorkflowResult(result, { isPartial: false }, theme, expandedContext);
});

test("renderWorkflowResult keeps contextual headers for errors", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  };
  const component = renderWorkflowResult(
    { content: [{ type: "text", text: "provider exploded" }], details: {} },
    { isPartial: false },
    theme,
    {
      state: {},
      invalidate() {},
      isError: true,
      args: { action: "run", name: "deep-research" },
    },
  );
  assert.deepEqual(component.render(120), [
    "<error>✗ workflow run deep-research</error>",
    "<error>provider exploded</error>",
  ]);
});

test("renderWorkflowResult preserves snapshot context on run errors", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const result = {
    content: [{ type: "text", text: "Error: verifier failed" }],
    details: {
      action: "run",
      snapshot: {
        meta: { name: "audit", description: "Audit" },
        phases: ["verify"],
        logs: [],
        agents: [],
        agentFailureCount: 1,
        loggedBranchFailureCount: 0,
        settledBranchFailureCount: 0,
        startedAt: 1,
        finishedAt: 1001,
      },
    },
  };
  const collapsed = renderWorkflowResult(
    result,
    { isPartial: false, expanded: false },
    theme,
    { state: {}, invalidate() {} },
  );
  assert.deepEqual(collapsed.render(120), [
    "✗ audit · workflow_script_error · 1s — Error: verifier failed",
  ]);

  const expanded = renderWorkflowResult(
    result,
    { isPartial: false, expanded: true },
    theme,
    { state: {}, invalidate() {} },
  );
  assert.equal(expanded.render(120)[0], "");
  assert.match(expanded.render(120)[1], /^Workflow: audit ✗ · 1s/);
  assert.equal(expanded.render(120).at(-1), "Error: verifier failed");
});

test("workflow error rendering shows bounded cause counts and path-only diagnostics", () => {
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const result = {
    content: [
      {
        type: "text",
        text: "Error [workflow_timeout]: hostile\nmessage\u001b]8;;x\u0007",
      },
    ],
    details: {
      action: "run",
      errorCode: "workflow_timeout",
      counts: {
        completed: 2,
        failed: 1,
        timedOut: 1,
        canceled: 1,
        outstanding: 0,
      },
      recoveryFile: "/tmp/recovery.json.gz\u001b]8;;x\u0007",
      snapshot: {
        meta: { name: "audit", description: "Audit" },
        phases: ["verify"],
        logs: [],
        agents: [
          {
            id: 1,
            agent: "reviewer",
            intent: "verify",
            prompt: "PROMPT MUST NOT RENDER",
            status: "error",
            errorCode: "agent_timeout",
            errorMessage: "agent timed out",
            effectiveTimeoutMs: 25,
            explicitTimeoutMs: 25,
            logFile: "/tmp/child.log.gz",
            startedAt: 1,
            finishedAt: 26,
          },
        ],
        agentFailureCount: 1,
        loggedBranchFailureCount: 0,
        settledBranchFailureCount: 0,
        startedAt: 1,
        finishedAt: 1001,
      },
    },
  };
  const collapsed = renderWorkflowResult(
    result,
    { isPartial: false, expanded: false },
    theme,
    { state: {}, invalidate() {} },
  );
  const collapsedLines = collapsed.render(70);
  assert.equal(collapsedLines.length, 1);
  assert.match(collapsedLines[0], /workflow_timeout/);
  assert.ok(visibleWidth(collapsedLines[0]) <= 70);
  assert.doesNotMatch(collapsedLines[0], /\u001b\]8|\u0007/);

  const expanded = renderWorkflowResult(
    result,
    { isPartial: false, expanded: true },
    theme,
    { state: {}, invalidate() {} },
  );
  const expandedLines = expanded.render(160);
  assert.equal(expandedLines[0], "");
  const expandedText = expandedLines.join("\n");
  assert.match(expandedText, /timeout 25ms/);
  assert.match(expandedText, /failure agent_timeout/);
  assert.match(expandedText, /\/tmp\/child\.log\.gz/);
  assert.match(expandedText, /Recovery: \/tmp\/recovery\.json\.gz/);
  assert.doesNotMatch(expandedText, /PROMPT MUST NOT RENDER|\u001b\]8|\u0007/);
});
