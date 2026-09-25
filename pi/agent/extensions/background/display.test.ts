import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { widgetLines } from "./index.ts";
import { executionCounts } from "./display.ts";
import { renderExecutionResult } from "./render.ts";
import { validateActivity } from "./store.ts";
import { notificationRenderer } from "../_shared/notification.ts";
import { renderWorkflowCall } from "../workflows/display.ts";
import type { Execution } from "./api.ts";

const theme: any = {
  fg: (_: string, s: string) => s,
  bg: (_: string, s: string) => s,
  bold: (s: string) => s,
};
const marked = { ...theme, fg: (c: string, s: string) => `<${c}>${s}</${c}>` };
const record = (extra: Partial<Execution> = {}): Execution => ({
  id: "11111111-2222-4333-8444-555555555555",
  owner: "workflow",
  label: "smoke-progress",
  anchor: "anchor",
  createdAt: 1000,
  deadlineMs: 60000,
  status: "running",
  cancelRequested: false,
  dismissed: false,
  effectsMayPersist: false,
  outcomeUnknown: false,
  notification: {
    id: "notice",
    intent: false,
    handoff: "none",
    consumed: false,
  },
  ...extra,
});

test("one-line widgets distinguish queued/running/done/failed/canceled and report usage", () => {
  const r = record({
    activity: {
      started: 11,
      completed: 6,
      failed: 2,
      canceled: 1,
      queued: 2,
      totalTokens: 24600,
    },
  });
  const before = JSON.stringify(r);
  const counts = executionCounts(r, marked)!;
  assert.doesNotMatch(counts, /<(success|error|warning|accent)>/);
  assert.match(counts, /<muted>1 canceled<\/muted>/);
  assert.equal(
    widgetLines([r], 200, theme, 19000)[0],
    "workflow running smoke-progress · 2 queued, 3 running, 4 done, 1 failed, 1 canceled · 24.6k tokens · 18s",
  );
  const done = record({
    status: "success",
    endedAt: 17000,
    effectsMayPersist: true,
    activity: { started: 2, completed: 2, failed: 0, canceled: 0 },
    result: { accounting: { used: 7319 } },
  });
  assert.equal(
    widgetLines([done], 200, theme)[0],
    "workflow succeeded smoke-progress · 2 done · 7.3k tokens · 16s",
  );
  assert.match(
    widgetLines([done], 1000, marked)[0],
    /<success>succeeded<\/success>/,
  );
  const canceled = record({
    status: "cancelled",
    endedAt: 5000,
    outcomeUnknown: true,
    activity: { started: 1, completed: 1, failed: 1, canceled: 1 },
    result: { accounting: { used: 0 } },
  });
  assert.equal(
    widgetLines([canceled], 200, theme)[0],
    "workflow canceled smoke-progress · 1 canceled · 4s · effects unknown",
  );
  assert.doesNotMatch(widgetLines([canceled], 200, theme)[0], /failed|tokens/);
  for (const width of [0, 1, 12, 32, 48, 64, 80, 120]) {
    const rows = widgetLines(
      [{ ...canceled, label: "long\n\x1b[2J世界".repeat(40) }],
      width,
      theme,
    );
    assert.equal(rows.length, 1);
    assert.ok(visibleWidth(rows[0]) <= width);
    assert.doesNotMatch(stripVTControlCharacters(rows[0]), /[\n\x1b]/);
    if (width >= 48) assert.match(rows[0], /effects unknown/);
  }
  assert.equal(JSON.stringify(r), before);
  const child = record({
    owner: "subagents",
    progress: { completed: 0, failed: 0, total: 1 },
    activity: {
      started: 1,
      completed: 0,
      failed: 0,
      canceled: 0,
      totalTokens: 4200,
    },
  });
  assert.equal(
    widgetLines([child], 200, theme, 7000)[0],
    "subagent running smoke-progress · 4.2k tokens · 6s",
  );
});

test("control summaries retain state and split semantic color from uncertainty", () => {
  for (const [status, word, color] of [
    ["success", "succeeded", "success"],
    ["failed", "failed", "error"],
    ["cancelled", "canceled", "warning"],
  ] as const) {
    const r = record({
      status,
      effectsMayPersist: true,
      outcomeUnknown: status === "cancelled",
      result: { errorMessage: "Intentional failure\n\x1b[2J token=PRIVATE" },
    });
    const before = JSON.stringify(r);
    const result = {
      content: [{ type: "text" as const, text: "retained evidence" }],
      details: undefined,
    };
    const ctx = { args: { action: "inspect" } };
    const line = renderExecutionResult(
      "workflow",
      [r],
      result,
      {},
      marked,
      ctx,
    ).render(1000)[0];
    assert.match(line, new RegExp(`<${color}>${word}</${color}>`));
    assert.doesNotMatch(line, /PRIVATE|\x1b/);
    if (status === "success") assert.doesNotMatch(line, /effects|Intentional/);
    else {
      assert.match(line, /<dim> · <\/dim><warning>effects/);
      assert.match(line, /Intentional failure/);
    }
    const dismissed = renderExecutionResult(
      "workflow",
      [r],
      result,
      {},
      theme,
      { args: { action: "dismiss" } },
    ).render(200)[0];
    assert.match(dismissed, /^dismissed/);
    assert.doesNotMatch(dismissed, /evidence retained/);
    assert.equal(JSON.stringify(r), before);
  }
});

test("wake puts identity before warnings; ordinary success is green without effects boilerplate", () => {
  for (const status of ["success", "failed", "cancelled"] as const) {
    const message: any = {
      content: "Original effects metadata remains model-facing",
      details: {
        display: {
          version: 1,
          owner: "workflow",
          name: "smoke",
          status,
          effectsMayPersist: true,
        },
      },
    };
    const before = JSON.stringify(message);
    const row = notificationRenderer("background")(
      message,
      { expanded: false } as any,
      theme,
    )!
      .render(120)[0]
      .trim();
    assert.equal(
      row,
      status === "success"
        ? "workflow succeeded smoke"
        : `workflow ${status === "cancelled" ? "canceled" : "failed"} smoke (effects may persist)`,
    );
    assert.equal(JSON.stringify(message), before);
  }
});

test("workflow calls show literal inline metadata or a short control ID, never source", () => {
  const script =
    'export const meta = { name: "smoke-test", description: "PRIVATE" }; export async function run() { return await agent("PRIVATE", {}); }';
  assert.equal(
    renderWorkflowCall({ action: "run", script }, theme, {}).render(200)[0],
    "workflow run smoke-test",
  );
  for (const action of ["inspect", "cancel", "dismiss"])
    assert.equal(
      renderWorkflowCall({ action, id: record().id }, theme, {}).render(200)[0],
      `workflow ${action} 11111111`,
    );
  assert.equal(
    renderWorkflowCall(
      {
        action: "run",
        script:
          'export const meta = { name: process.exit(), description: "PRIVATE" };',
      },
      theme,
      {},
    ).render(200)[0],
    "workflow run",
  );
});

test("successful inspections include available telemetry and Script widgets show elapsed time", () => {
  const r = record({
    status: "success",
    endedAt: 6000,
    activity: {
      started: 2,
      completed: 2,
      failed: 0,
      canceled: 0,
      totalTokens: 3400,
    },
  });
  const result = { content: [], details: undefined };
  assert.equal(
    renderExecutionResult("workflow", [r], result, {}, theme, {
      args: { action: "inspect" },
    }).render(200)[0],
    "succeeded · 2 done · 3.4k tokens · 5s",
  );
  assert.equal(
    widgetLines([record({ owner: "script" })], 200, theme, 6000)[0],
    "script running smoke-progress · 5s",
  );
  const script = record({ owner: "script", status: "success", endedAt: 9000 });
  assert.equal(
    widgetLines([script], 200, theme, 99000)[0],
    "script succeeded smoke-progress · 8s",
  );
  assert.equal(
    renderExecutionResult("script", [script], result, {}, theme, {
      args: { action: "inspect" },
    }).render(200)[0],
    "succeeded · 8s",
  );
});

test("optional telemetry validates ranges while historical activity remains readable", () => {
  const base = { started: 3, completed: 1, failed: 1 };
  validateActivity(base);
  validateActivity({ ...base, queued: 2, canceled: 1, totalTokens: 7319 });
  for (const extra of [
    { queued: 3 },
    { queued: -1 },
    { canceled: 2 },
    { canceled: 0.5 },
    { totalTokens: -1 },
    { totalTokens: Infinity },
  ])
    assert.throws(
      () => validateActivity({ ...base, ...extra }),
      /invalid_activity/,
    );
});
