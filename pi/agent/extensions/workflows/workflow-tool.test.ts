import assert from "node:assert/strict";
import test from "node:test";
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

test("workflows config display includes all seven effective fields", () => {
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
    { script: "const x = 1;" },
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
    { script },
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
    { script },
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
    { script },
    undefined,
    undefined,
    { cwd: "/tmp" },
  );
  assert.match(result.content[0].text, /\[Circular\]/);
});

test("renderWorkflowCall suppresses noisy script metadata", () => {
  const component = renderWorkflowCall(
    { script: 'export const meta = { name: "x", description: "x" };' },
    {},
    {},
  );
  assert.deepEqual(component.render(80), []);
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
