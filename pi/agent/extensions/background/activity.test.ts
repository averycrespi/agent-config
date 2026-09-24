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
    /1\/2 agents settled.*1 failed.*verify/,
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
