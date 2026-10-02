import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getActivity, renderAgentsResult } from "./render.ts";
const theme: any = { bold: (s: string) => s, fg: (_c: string, s: string) => s };
const ctx = (action = "run") => ({
  state: {},
  args: { action },
  invalidate() {},
});

test("historical foreground results use sanitized text, not retired agent layouts or Background", () => {
  const result = {
    content: [
      { type: "text", text: "old output\n  nested: value\n\x1b[2Jdiagnostic" },
    ],
    details: { total: 2, agents: [{ intent: "old agent" }] },
  };
  const compact = renderAgentsResult(
    result,
    { isPartial: false },
    theme,
    ctx(),
  ).render(60);
  const expanded = renderAgentsResult(
    result,
    { isPartial: false, expanded: true },
    theme,
    ctx(),
  ).render(60);
  assert.deepEqual(compact, ["historical result"]);
  assert.deepEqual(expanded, [
    "historical result",
    "",
    "old output",
    "  nested: value",
    "diagnostic",
  ]);
  assert.doesNotMatch(expanded.join("\n"), /subagents|succeeded|\x1b/);
});

test("current receipts and pre-admission failures retain truthful state and additive expansion", () => {
  for (const [details, action, expected] of [
    [{ execution: { id: "id", status: "running" } }, "run", "running · id"],
    [{ execution: { id: "id", status: "failed" } }, "run", "failed · id"],
    [{ executions: [] }, "list", "0 executions"],
    [{ validationError: true }, "run", "request failed"],
  ] as const) {
    const result = {
      content: [{ type: "text", text: "Error: invalid\x1b[2J" }],
      details,
    };
    const compact = renderAgentsResult(
      result,
      { isPartial: false },
      theme,
      ctx(action),
    ).render(80);
    const expanded = renderAgentsResult(
      result,
      { isPartial: false, expanded: true },
      theme,
      ctx(action),
    );
    assert.equal(compact[0], expected);
    assert.deepEqual(expanded.render(80).slice(0, compact.length), compact);
    assert.equal(expanded.render(80)[compact.length], "");
    assert.ok(expanded.render(12).every((line) => visibleWidth(line) <= 12));
    assert.doesNotMatch(expanded.render(80).join("\n"), /\x1b/);
  }
});

test("getActivity remains available to execution consumers", () => {
  const activity = {
    intent: "example",
    phase: "done",
    startedAt: 1,
    lastUpdateAt: 2,
  };
  assert.equal(getActivity({ activity }), activity);
  assert.equal(getActivity(activity), activity);
  assert.equal(getActivity({ intent: "x", phase: "done" }), undefined);
  assert.equal(getActivity(null), undefined);
});
