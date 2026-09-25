import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerScheduledTasksTool, registerHandoffTool } from "./tools.ts";

const colors: string[] = [];
const theme: any = {
  fg: (c: string, s: string) => {
    colors.push(c);
    return s;
  },
  bold: (s: string) => s,
};
function capture(register: typeof registerHandoffTool) {
  let tool: any;
  register(
    {
      registerTool: (t: any) => {
        tool = t;
      },
    } as any,
    async () => {
      throw Error("rendering must not load configuration");
    },
  );
  return tool;
}
test("scheduled task summaries use typed outcomes and never preview task bodies or logs", () => {
  const tool = capture(registerScheduledTasksTool);
  const cases: any[] = [
    ["list", [{ id: "demo" }], "1 tasks", false],
    ["read", { id: "demo", body: "PRIVATE" }, "", false],
    ["logs", undefined, "", false],
    [
      "validate",
      [{ ok: true, warnings: [] }],
      "validated, not executed",
      false,
    ],
    [
      "validate",
      [{ ok: false, errors: ["PRIVATE"], warnings: [] }],
      "request failed",
      true,
    ],
    ["run", { status: "launched" }, "started, not completed", false],
    ["run", { status: "launch_failed" }, "request failed", true],
    [
      "doctor",
      { crontabStatus: { status: "unavailable" }, issues: [], tasks: [] },
      "cron unavailable",
      false,
    ],
  ];
  for (const [action, details, expected, failed] of cases) {
    const context = { args: { action, task_id: "demo\n\x1b[2J世界" } };
    const result = {
      content: [{ type: "text", text: "PRIVATE\nretained evidence" }],
      details,
    };
    const original = JSON.stringify(result);
    colors.length = 0;
    const compact = tool.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      context,
    );
    assert.equal(compact.render(120).length, expected ? 1 : 0);
    if (expected) assert.match(compact.render(120)[0], new RegExp(expected));
    assert.doesNotMatch(
      compact.render(120).join("\n"),
      /PRIVATE|retained evidence/,
    );
    assert.equal(colors.includes("error"), failed);
    for (const width of [1, 20, 48, 80])
      for (const line of compact.render(width))
        assert.ok(visibleWidth(line) <= width);
    if (action === "run" && !failed)
      assert.match(compact.render(48)[0], /started, not completed/);
    assert.match(
      tool
        .renderResult(
          result,
          { expanded: true, isPartial: false },
          theme,
          context,
        )
        .render(120)
        .join("\n"),
      /PRIVATE\nretained evidence/,
    );
    assert.equal(JSON.stringify(result), original);
    const error = tool.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      { ...context, isError: true },
    );
    assert.match(error.render(120)[0], /request failed/);
    assert.match(
      tool
        .renderResult(
          result,
          { expanded: false, isPartial: true },
          theme,
          context,
        )
        .render(120)[0],
      /pending/,
    );
  }
});
test("mixed task inventories expose invalid entries even when the first entry is healthy", () => {
  const tool = capture(registerScheduledTasksTool);
  const result = {
    content: [
      { type: "text", text: "healthy (enabled)\nError: PRIVATE_PARSE_ERROR" },
    ],
    details: [
      { id: "healthy", enabled: true, description: "fixture" },
      { errors: ["PRIVATE_PARSE_ERROR"] },
    ],
  };
  colors.length = 0;
  const row = tool
    .renderResult(result, { expanded: false }, theme, {
      args: { action: "list" },
    })
    .render(100);
  assert.equal(row.length, 1);
  assert.match(row[0], /request failed \(1 invalid\)/);
  assert.doesNotMatch(row[0], /2 tasks|PRIVATE_PARSE_ERROR/);
  assert.ok(colors.includes("error"));
  assert.ok(!colors.includes("success"));
});

test("handoff renderers hide content, preserve marker warnings, and distinguish reads from updates", () => {
  const tool = capture(registerHandoffTool);
  for (const action of ["read", "update"]) {
    const ctx = { args: { action, content: "PRIVATE" } };
    const result = { content: [{ type: "text", text: "PRIVATE" }] };
    assert.doesNotMatch(
      tool.renderCall(ctx.args, theme, ctx).render(120)[0],
      /PRIVATE/,
    );
    const row = tool
      .renderResult(result, { expanded: false }, theme, ctx)
      .render(120);
    assert.equal(row.length, action === "read" ? 0 : 1);
    if (action !== "read") assert.match(row[0], /updated/);
    assert.doesNotMatch(row.join("\n"), /PRIVATE/);
  }
  const warning = tool
    .renderResult(
      {
        content: [
          {
            type: "text",
            text: "Updated scheduled task handoff. Handoff marker was not written because the run ID is missing.",
          },
        ],
      },
      { expanded: false },
      theme,
      { args: { action: "update" } },
    )
    .render(48)[0];
  assert.match(warning, /marker missing/);
});
