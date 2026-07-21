import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  agentProgressLines,
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
  assert.equal(statsLine(1, 0, 5000), "5s · 1 tool use");
  assert.equal(
    statsLine(5, 20_300, 20_000),
    "20s · 5 tool uses · 20.3k tokens",
  );
});

test("done progress rows split intent stats from compact execution policy", () => {
  assert.deepEqual(agentProgressLines(state() as any, theme), [
    "✓ docs · 12s · 2 tool uses · 4.1k tokens",
    "  medium:high (fs)",
  ]);

  assert.deepEqual(
    agentProgressLines(
      state({
        capabilities: [
          "read-filesystem",
          "exec-shell",
          "read-broker",
          "read-web",
        ],
      }) as any,
      theme,
    ),
    [
      "✓ docs · 12s · 2 tool uses · 4.1k tokens",
      "  medium:high (fs, shell, broker, web)",
    ],
  );
});

test("running progress rows keep volatile tool identity at the end", () => {
  const lines = agentProgressLines(
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
  assert.match(lines[0]!, /^● tests · \d+s · 1 tool use$/);
  assert.equal(lines[1], "  small:medium (web) · web_fetch");
});

test("failure rows omit empty capabilities and keep retained logs hidden", () => {
  const lines = agentProgressLines(
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
  assert.deepEqual(lines, [
    "✗ security · 1s",
    "  medium:high · Error: subagent failed",
  ]);
  assert.doesNotMatch(lines.join("\n"), /Log:/);
});

function context() {
  return {
    state: {} as Record<string, unknown>,
    invalidate() {},
    lastComponent: undefined as any,
  };
}

test("aggregate and per-agent separators are muted", () => {
  const markerTheme = {
    bold: (text: string) => text,
    fg: (color: string, text: string) =>
      color === "muted" ? `{${text}}` : text,
  };

  assert.deepEqual(agentProgressLines(state() as any, markerTheme), [
    "✓ docs{ · }{12s · 2 tool uses · 4.1k tokens}",
    "  {medium:high (fs)}",
  ]);

  const result = renderAgentsResult(
    {
      content: [],
      details: { total: 1, failed: 0, agents: [state()] },
    },
    { isPartial: false },
    markerTheme,
    context(),
  );
  assert.deepEqual(result.render(200), [
    "✓ spawn_agents{ · }{1 done · 0 failed · 12s}",
  ]);
});

test("collapsed result is one aggregate line for running and final states", () => {
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
    assert.equal(partialLines.length, 1);
    assert.match(
      partialLines[0]!,
      /^spawn_agents · 1 done · 1 running · 0 failed · \d+(?:m \d+s|s)$/,
    );
    assert.doesNotMatch(partialLines[0]!, /docs|tests/);

    ctx.lastComponent = partial;
    const final = renderAgentsResult(
      {
        content: [],
        details: {
          total: 2,
          failed: 1,
          agents: [
            state(),
            state({
              intent: "tests",
              phase: "error",
              resolved: false,
              errorMessage: "Error: failed",
              startedAt: 2000,
              lastUpdateAt: 3000,
            }),
          ],
        },
      },
      { isPartial: false },
      theme,
      ctx,
    );
    assert.deepEqual(final.render(200), [
      "✗ spawn_agents · 1 done · 1 failed · 12s",
    ]);
  } finally {
    clearInterval(ctx.state.renderTimer as ReturnType<typeof setInterval>);
  }
});

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
      { isPartial: true, expanded: true },
      theme,
      ctx,
    );
    const partialLines = partial.render(200);
    assert.match(partialLines.join("\n"), /^spawn_agents · 1 done · 1 running/);
    assert.ok(
      partialLines.some((line: string) => line.startsWith("✓ docs · ")),
    );
    assert.ok(
      partialLines.some((line: string) => line === "  medium:high (fs)"),
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
  const lines = agentProgressLines(
    state({
      intent: "bad\x1b]8;;https://evil.example\x07link\x1b]8;;\x07\nnext",
      phase: "error",
      errorMessage: "Error: nope\x1b[2J\nsecret",
    }) as any,
    theme,
  );
  assert.doesNotMatch(lines.join("\n"), /\x1b/);
  assert.match(lines[0]!, /badlink next/);
  assert.match(lines[1]!, /Error: nope/);
  assert.doesNotMatch(lines.join("\n"), /secret/);
});

test("getActivity accepts nested or direct activity shapes", () => {
  const activity = state();
  assert.equal(getActivity({ activity }), activity);
  assert.equal(getActivity(activity), activity);
  assert.equal(getActivity({ intent: "x", phase: "done" }), undefined);
  assert.equal(getActivity(null), undefined);
});
