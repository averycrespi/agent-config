import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compactAgentProgressLine,
  formatRunningLine,
  formatTokens,
  getActivity,
  statsLine,
} from "./render.ts";

// ─── formatTokens ────────────────────────────────────────────────────────────

test("formatTokens: below 1k renders as bare integer", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
});

test("formatTokens: >= 1k renders as Nk with one decimal", () => {
  assert.equal(formatTokens(1_000), "1.0k");
  assert.equal(formatTokens(20_300), "20.3k");
});

test("formatTokens: >= 1M renders as NM with one decimal", () => {
  assert.equal(formatTokens(1_000_000), "1.0M");
  assert.equal(formatTokens(2_450_000), "2.5M");
});

// ─── statsLine ───────────────────────────────────────────────────────────────

test("statsLine: duration always included", () => {
  assert.equal(statsLine(0, 0, 3_000), "3s");
});

test("statsLine: singular tool use", () => {
  assert.equal(statsLine(1, 0, 5_000), "1 tool use · 5s");
});

test("statsLine: plural tool uses", () => {
  assert.equal(statsLine(4, 0, 14_000), "4 tool uses · 14s");
});

test("statsLine: tokens only when > 0", () => {
  assert.equal(
    statsLine(5, 20_300, 20_000),
    "5 tool uses · 20.3k tokens · 20s",
  );
});

test("statsLine: omits zero tools and zero tokens", () => {
  assert.equal(statsLine(0, 0, 63_000), "1m 03s");
});

// ─── formatRunningLine ───────────────────────────────────────────────────────

test("formatRunningLine: undefined agent returns bare Running...", () => {
  assert.equal(formatRunningLine(undefined), "Running...");
});

test("formatRunningLine: zero tool uses renders 'Running... (Xs)'", () => {
  const line = formatRunningLine({
    intent: "x",
    phase: "starting",
    recentEvents: [],
    toolUseCount: 0,
    totalTokens: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  });
  assert.match(line, /^Running\.\.\. \(\d+s\)$/);
});

test("formatRunningLine: singular tool use", () => {
  const line = formatRunningLine({
    intent: "x",
    phase: "bash",
    recentEvents: [],
    toolUseCount: 1,
    totalTokens: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  });
  assert.match(line, /^Running: 1 tool use \(\d+s\)$/);
});

test("formatRunningLine: plural tool uses", () => {
  const line = formatRunningLine({
    intent: "x",
    phase: "bash",
    recentEvents: [],
    toolUseCount: 4,
    totalTokens: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  });
  assert.match(line, /^Running: 4 tool uses \(\d+s\)$/);
});

// ─── compactAgentProgressLine ───────────────────────────────────────────────

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
};

test("compactAgentProgressLine: done row includes status, label, stats", () => {
  assert.equal(
    compactAgentProgressLine(
      {
        intent: "docs",
        agentType: "explore",
        phase: "done",
        recentEvents: [],
        toolUseCount: 2,
        totalTokens: 4100,
        resolved: true,
        startedAt: 1000,
        lastUpdateAt: 13000,
      },
      theme,
    ),
    "✓ explore docs · 2 tool uses · 4.1k tokens · 12s",
  );
});

test("compactAgentProgressLine: running row includes latest activity", () => {
  const line = compactAgentProgressLine(
    {
      intent: "tests",
      agentType: "review",
      phase: "read",
      recentEvents: [{ kind: "tool", text: "read: package.json" }],
      toolUseCount: 1,
      totalTokens: 0,
      startedAt: Date.now() - 8000,
      lastUpdateAt: Date.now(),
    },
    theme,
  );
  assert.match(
    line,
    /^● review tests · 1 tool use · \d+s · read: package\.json$/,
  );
});

test("compactAgentProgressLine: failure row includes first error and log", () => {
  assert.equal(
    compactAgentProgressLine(
      {
        intent: "security",
        agentType: "review",
        phase: "error",
        recentEvents: [],
        toolUseCount: 0,
        totalTokens: 0,
        resolved: true,
        errorMessage: "Error: subagent failed\nstack",
        logFile: "/tmp/log.txt",
        startedAt: 1000,
        lastUpdateAt: 2000,
      },
      theme,
    ),
    "✗ review security · 1s · Error: subagent failed · Log: /tmp/log.txt",
  );
});

// ─── getActivity ─────────────────────────────────────────────────────────────

test("getActivity: null / primitives return undefined", () => {
  assert.equal(getActivity(null), undefined);
  assert.equal(getActivity(undefined), undefined);
  assert.equal(getActivity("string"), undefined);
  assert.equal(getActivity(42), undefined);
});

test("getActivity: returns details.activity when present", () => {
  const activity = {
    intent: "i",
    phase: "done",
    recentEvents: [],
    toolUseCount: 0,
    totalTokens: 0,
    startedAt: 1,
    lastUpdateAt: 2,
  };
  assert.equal(getActivity({ activity }), activity);
});

test("getActivity: returns record itself when shape matches SubagentRunState", () => {
  const record = {
    intent: "x",
    phase: "thinking",
    recentEvents: [],
    toolUseCount: 0,
    totalTokens: 0,
    startedAt: 100,
    lastUpdateAt: 200,
  };
  assert.equal(getActivity(record), record);
});

test("getActivity: returns undefined for record missing required fields", () => {
  assert.equal(
    getActivity({ intent: "x", phase: "done" }), // missing timestamps
    undefined,
  );
});
