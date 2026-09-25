import assert from "node:assert/strict";
import test from "node:test";
import { Service } from "./service.ts";
import { validate } from "./store.ts";
import { widgetLines } from "./index.ts";
import type { Execution, ProgressUpdate } from "./api.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

test("dynamic activity and initial references validate atomically without changing fixed batch progress", async () => {
  let records: Execution[] = [];
  let update!: (value: ProgressUpdate) => void;
  let finish!: () => void;
  const service = new Service(
    {
      read: () => records,
      write: (value) => {
        records = validate(value);
      },
    },
    {
      anchor: () => "anchor",
      inBranch: () => true,
      idle: () => false,
      changed() {},
      handoff() {},
      event() {},
    },
  );
  const r = service.admit({
    owner: "workflow",
    label: "fixture",
    deadlineMs: Date.now() + 5000,
    result: { resultFile: "/reference" },
    run: async (_s, report) => {
      update = report;
      await new Promise<void>((resolve) => (finish = resolve));
      return {
        status: "success",
        effectsMayPersist: false,
        outcomeUnknown: false,
      };
    },
  });
  assert.deepEqual(service.inspect("workflow", r.id).result, {
    resultFile: "/reference",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  update({
    activity: {
      started: 1,
      completed: 0,
      failed: 0,
      phase: "inspect\u001b[31m\nnext",
    },
  });
  update({
    activity: { started: 2, completed: 1, failed: 1, phase: "verify" },
  });
  const before = service.inspect("workflow", r.id);
  for (const value of [
    { activity: { started: 1, completed: 1, failed: 1 } },
    { activity: { started: 2, completed: 0, failed: 0 } },
    { activity: { started: 2, completed: 3, failed: 0 } },
    {
      activity: { started: 2, completed: 1, failed: 1, phase: "x".repeat(201) },
    },
    {
      activity: {
        started: 2,
        completed: 1,
        failed: 1,
        profile: "x".repeat(41),
      },
    },
  ])
    assert.throws(() => update(value), /invalid_activity/);
  assert.deepEqual(service.inspect("workflow", r.id), before);
  update({ progress: { total: 4, completed: 1, failed: 0 } });
  assert.throws(
    () => update({ progress: { total: 5, completed: 1, failed: 0 } }),
    /invalid_progress/,
  );
  const theme = { fg: (_: string, s: string) => s } as any;
  assert.match(
    widgetLines([before], 150, theme)[0],
    /workflow running.*1\/2 settled.*1 failed.*verify/,
  );
  for (const width of [12, 32, 80])
    assert.ok(
      widgetLines([before], width, theme).every(
        (line) => visibleWidth(line) <= width,
      ),
    );
  finish();
  service.close();
});

test("widget sources, singular batches and critical warnings precede optional identity", () => {
  const theme = { fg: (_: string, s: string) => s } as any;
  const base: Execution = {
    id: "11111111-2222-4333-8444-555555555555",
    owner: "script",
    label: "OPTIONAL".repeat(20),
    anchor: "anchor",
    createdAt: 0,
    deadlineMs: 1000,
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
  };
  for (const [owner, total, expected] of [
    ["script", undefined, "script"],
    ["workflow", undefined, "workflow"],
    ["subagents", 1, "subagent"],
    ["subagents", 2, "subagents"],
  ] as const) {
    const r = {
      ...base,
      owner,
      ...(total ? { progress: { total, completed: 0, failed: 0 } } : {}),
    };
    const before = JSON.stringify(r);
    assert.match(
      widgetLines([r], 160, theme)[0],
      new RegExp(`^${expected} running`),
    );
    r.outcomeUnknown = true;
    for (const width of [48, 64]) {
      const line = widgetLines([r], width, theme)[0];
      assert.match(line, /effects unknown/);
      assert.doesNotMatch(line, /11111111/);
      assert.ok(visibleWidth(line) <= width);
    }
    r.outcomeUnknown = false;
    assert.equal(JSON.stringify(r), before);
  }
  const child = {
    ...base,
    owner: "subagents",
    label: "Count vowels",
    createdAt: 1000,
    progress: { total: 1, completed: 0, failed: 0 },
    activity: {
      started: 1,
      completed: 0,
      failed: 0,
      profile: "fast",
      phase: "thinking",
    },
  };
  assert.equal(
    widgetLines([child], 120, theme, 9000)[0],
    "subagent running · Count vowels · fast · 8s · thinking",
  );
  assert.doesNotMatch(
    widgetLines([child], 120, theme, 9000)[0],
    /0\/1 settled/,
  );
  assert.match(widgetLines([child], 42, theme, 9000)[0], /^subagent running/);
  const workflow = {
    ...base,
    owner: "workflow",
    label: "Review",
    createdAt: 1000,
    activity: { started: 3, completed: 2, failed: 0, phase: "verify" },
  };
  assert.equal(
    widgetLines([workflow], 120, theme, 9000)[0],
    "workflow running · Review · 2/3 settled · verify · 8s",
  );
  const uncertain = {
    ...base,
    status: "interrupted" as const,
    outcomeUnknown: true,
    persistenceFailed: true,
    notification: { ...base.notification, handoff: "unknown" as const },
  };
  const line = widgetLines([uncertain], 64, theme)[0];
  assert.match(
    line,
    /^script interrupted · unknown\/persist failed\/handoff\?/,
  );
  assert.doesNotMatch(line, /11111111/);
  assert.match(
    widgetLines([{ ...base, effectsMayPersist: true }], 80, theme)[0],
    /effects may persist/,
  );
});
