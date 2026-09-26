import assert from "node:assert/strict";
import test from "node:test";
import type { Execution } from "./api.ts";
import { DEFAULT_WIDGET_CONFIG } from "./config.ts";
import { widgetVisible } from "./visibility.ts";

const record = (status: Execution["status"]): Execution => ({
  id: "id",
  owner: "script",
  label: "example",
  anchor: "anchor",
  createdAt: 0,
  deadlineMs: 100000,
  endedAt: 1000,
  status,
  dismissed: false,
  cancelRequested: false,
  effectsMayPersist: true,
  outcomeUnknown: true,
  persistenceFailed: true,
  notification: {
    id: "notice",
    intent: true,
    handoff: "unknown",
    consumed: false,
  },
});

test("all terminal states and warnings use the same visibility-only deadline", () => {
  for (const owner of ["script", "subagents", "workflow"]) {
    for (const status of [
      "success",
      "failed",
      "timeout",
      "cancelled",
      "interrupted",
    ] as const) {
      const r = { ...record(status), owner };
      const before = structuredClone(r);
      assert.equal(widgetVisible(r, DEFAULT_WIDGET_CONFIG, 15999), true);
      assert.equal(widgetVisible(r, DEFAULT_WIDGET_CONFIG, 16000), false);
      assert.equal(
        widgetVisible(r, { autoHide: false, terminalHideAfterMs: 0 }, 90000),
        true,
      );
      assert.equal(
        widgetVisible(r, { autoHide: true, terminalHideAfterMs: 0 }, 1000),
        false,
      );
      assert.equal(
        widgetVisible(
          { ...r, endedAt: undefined },
          DEFAULT_WIDGET_CONFIG,
          90000,
        ),
        true,
      );
      assert.deepEqual(r, before);
    }
  }
});

test("running stays visible; existing dismissal and consumption still hide earlier", () => {
  assert.equal(
    widgetVisible(record("running"), DEFAULT_WIDGET_CONFIG, 90000),
    true,
  );
  for (const autoHide of [true, false]) {
    const config = { ...DEFAULT_WIDGET_CONFIG, autoHide };
    assert.equal(
      widgetVisible({ ...record("success"), dismissed: true }, config, 1000),
      false,
    );
    const r = record("failed");
    r.notification.consumed = true;
    assert.equal(widgetVisible(r, config, 1000), false);
  }
});
