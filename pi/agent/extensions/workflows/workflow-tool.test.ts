import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkflowTool } from "./workflow-tool.ts";
import { renderSnapshot } from "./display.ts";

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

test("renderSnapshot summarizes workflow progress compactly", () => {
  const lines = renderSnapshot({
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
  });
  assert.match(lines[0], /audit/);
  assert.match(lines[1], /1 done, 1 running/);
  assert.match(lines[2], /hello/);
});
