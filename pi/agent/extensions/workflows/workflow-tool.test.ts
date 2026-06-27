import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkflowTool } from "./workflow-tool.ts";
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
          agent: "explore",
          intent: "a",
          prompt: "a",
          status: "done",
          startedAt: 1,
          activity: {
            intent: "a",
            agentType: "explore",
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
          agent: "review",
          intent: "b",
          prompt: "b",
          status: "running",
          startedAt: 1,
        },
      ],
      failureCount: 0,
      startedAt: Date.now(),
    },
    theme,
  );
  assert.match(lines[0], /Workflow: audit · fanout/);
  assert.match(lines[0], /1 done · 1 running/);
  assert.equal(lines[1], "");
  assert.match(lines[2], /^✓ explore: a · 1 tool use/);
  assert.match(lines[3], /^● review: b · initializing/);
  assert.equal(lines[4], "");
  assert.match(lines[6], /hello/);
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
              agent: "explore",
              intent: "a",
              prompt: "a",
              status: "done",
              startedAt: 1,
              activity: {
                intent: "a",
                agentType: "explore",
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
          failureCount: 0,
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
  assert.match(lines[0], /^Workflow: audit ✓ · 1s · 1 done · 0 failed$/);
  assert.match(lines[2], /^✓ explore: a · 1 tool use · 1s$/);
  assert.ok(!lines.some((line) => line.startsWith("✓ workflow")));
  assert.ok(!lines.some((line) => line.includes("Workflow audit completed")));
});
