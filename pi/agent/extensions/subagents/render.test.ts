import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  agentProgressLine,
  formatTokens,
  getActivity,
  renderAgentsResult,
  statsLine,
} from "./render.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
};
const state = (overrides: Record<string, unknown> = {}) => ({
  intent: "docs",
  capabilities: ["read-filesystem"],
  modelTier: "medium",
  thinking: "high",
  phase: "done",
  recentEvents: [],
  toolUseCount: 2,
  totalTokens: 4100,
  resolved: true,
  startedAt: 1000,
  lastUpdateAt: 13000,
  ...overrides,
});

for (const [value, expected] of [
  [0, "0"],
  [999, "999"],
  [1_000, "1.0k"],
  [20_300, "20.3k"],
  [1_000_000, "1.0M"],
  [2_450_000, "2.5M"],
] as const) {
  test(`formatTokens formats ${value}`, () =>
    assert.equal(formatTokens(value), expected));
}

test("statsLine includes only nonzero counters and duration", () => {
  assert.equal(statsLine(0, 0, 3000), "3s");
  assert.equal(statsLine(1, 0, 5000), "1 tool use · 5s");
  assert.equal(
    statsLine(5, 20_300, 20_000),
    "5 tool uses · 20.3k tokens · 20s",
  );
});

test("done progress row is intent-first and includes execution policy", () => {
  assert.equal(
    agentProgressLine(state() as any, theme),
    "✓ docs · read-filesystem · medium/high · 2 tool uses · 4.1k tokens · 12s",
  );
});

test("running progress row includes safe tool identity without arguments", () => {
  const line = agentProgressLine(
    state({
      intent: "tests",
      capabilities: ["read-web"],
      modelTier: "small",
      thinking: "medium",
      phase: "web_fetch",
      resolved: false,
      recentEvents: [{ kind: "tool", text: "web_fetch" }],
      toolUseCount: 1,
      totalTokens: 0,
      startedAt: Date.now() - 8000,
      lastUpdateAt: Date.now(),
    }) as any,
    theme,
  );
  assert.match(
    line,
    /^● tests · read-web · small\/medium · 1 tool use · \d+s · web_fetch$/,
  );
});

test("failure row keeps status and error but hides retained log until expanded", () => {
  const line = agentProgressLine(
    state({
      intent: "security",
      capabilities: [],
      phase: "error",
      toolUseCount: 0,
      totalTokens: 0,
      errorMessage: "Error: subagent failed\nstack",
      logFile: "/tmp/log.txt",
      startedAt: 1000,
      lastUpdateAt: 2000,
    }) as any,
    theme,
  );
  assert.equal(
    line,
    "✗ security · none · medium/high · 1s · Error: subagent failed",
  );
  assert.doesNotMatch(line, /Log:/);
});

function context() {
  return {
    state: {} as Record<string, unknown>,
    invalidate() {},
    lastComponent: undefined as any,
  };
}

test("result renderer is width-aware for partial, final, and expanded states", () => {
  const ctx = context();
  try {
    const partial = renderAgentsResult(
      {
        content: [],
        details: {
          total: 2,
          agents: [
            state(),
            state({ intent: "tests", phase: "read", resolved: false }),
          ],
        },
      },
      { isPartial: true },
      theme,
      ctx,
    );
    const partialLines = partial.render(200);
    assert.match(partialLines.join("\n"), /^Spawn agents · 1 done · 1 running/);
    assert.ok(
      partialLines.some((line: string) =>
        line.includes("✓ docs · read-filesystem · medium/high"),
      ),
    );
    ctx.lastComponent = partial;
    const final = renderAgentsResult(
      {
        content: [],
        details: {
          total: 1,
          failed: 0,
          agents: [state({ logFile: "/tmp/log.txt" })],
        },
      },
      { isPartial: false, expanded: true },
      theme,
      ctx,
    );
    assert.ok(
      final.render(200).some((line: string) => line === "Log: /tmp/log.txt"),
    );
    assert.ok(
      final.render(25).every((line: string) => visibleWidth(line) <= 25),
    );
    assert.equal(ctx.state.renderTimer, undefined);
  } finally {
    clearInterval(ctx.state.renderTimer as ReturnType<typeof setInterval>);
  }
});

test("renderer strips hostile controls and collapses line breaks", () => {
  const line = agentProgressLine(
    state({
      intent: "bad\x1b]8;;https://evil.example\x07link\x1b]8;;\x07\nnext",
      phase: "error",
      errorMessage: "Error: nope\x1b[2J\nsecret",
    }) as any,
    theme,
  );
  assert.doesNotMatch(line, /\x1b|\n/);
  assert.match(line, /badlink next/);
  assert.match(line, /Error: nope/);
  assert.doesNotMatch(line, /secret/);
});

test("getActivity accepts nested or direct activity shapes", () => {
  const activity = state();
  assert.equal(getActivity({ activity }), activity);
  assert.equal(getActivity(activity), activity);
  assert.equal(getActivity({ intent: "x", phase: "done" }), undefined);
  assert.equal(getActivity(null), undefined);
});
