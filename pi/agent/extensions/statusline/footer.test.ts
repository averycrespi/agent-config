import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderFooterLine, renderFooterLines } from "./footer.ts";
import type { UsageStats } from "./utils.ts";

const theme = {
  fg(color: string, text: string) {
    switch (color) {
      case "dim":
        return `\x1b[2m${text}\x1b[0m`;
      case "warning":
        return `\x1b[33m${text}\x1b[0m`;
      case "error":
        return `\x1b[31m${text}\x1b[0m`;
      default:
        return text;
    }
  },
  bold(text: string) {
    return `\x1b[1m${text}\x1b[0m`;
  },
};

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderUsage(stats: UsageStats) {
  return {
    label: "Codex",
    stats,
  };
}

function createRecordingTheme() {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    recordingTheme: {
      ...theme,
      fg(color: string, text: string) {
        calls.push([color, text]);
        return theme.fg(color, text);
      },
    },
  };
}

test("renderFooterLine renders statusline segments in priority order", () => {
  const line = renderFooterLine(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      usage: renderUsage({
        primary: { usedPercent: 45, resetAfterSeconds: 2 * 3600 },
        secondary: { usedPercent: 20, resetAfterSeconds: 3 * 24 * 3600 },
      }),
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
    } as any,
    200,
    theme,
  );

  assert.equal(
    stripAnsi(line),
    "~/Workspace/agent-config · Codex 45% (20%) 2h · ctx 42%/200k · gpt-5-codex · medium",
  );
  assert.match(line, /Workspace\/agent-config/);
  assert.match(line, /Codex 45% \(20%\) 2h/);
  assert.match(line, /ctx 42%\/200k/);
  assert.match(line, /gpt-5-codex/);
  assert.match(line, /medium/);
  assert.doesNotMatch(
    line,
    /\x1b\[2m(?:Codex|45%|20%|2h|ctx|42%|\/200k|gpt-5-codex|medium)/,
  );
});

test("renderFooterLine mutes status labels and supporting metadata", () => {
  const { calls, recordingTheme } = createRecordingTheme();

  renderFooterLine(
    {
      cwd: "/repo",
      usage: renderUsage({
        primary: { usedPercent: 45, resetAfterSeconds: 2 * 3600 },
        secondary: { usedPercent: 20, resetAfterSeconds: 3 * 24 * 3600 },
      }),
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
    },
    200,
    recordingTheme,
  );

  assert.deepEqual(
    calls.filter(([color]) => color === "muted"),
    [
      ["muted", "Codex"],
      ["muted", "2h"],
      ["muted", "ctx"],
      ["muted", "/200k"],
      ["muted", "gpt-5-codex"],
    ],
  );
});

test("renderFooterLine colors thinking levels with their theme tokens", () => {
  const expectedTokens = {
    off: "thinkingOff",
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXhigh",
  } as const;

  for (const [level, expectedToken] of Object.entries(expectedTokens)) {
    const calls: Array<[string, string]> = [];
    const recordingTheme = {
      ...theme,
      fg(color: string, text: string) {
        calls.push([color, text]);
        return theme.fg(color, text);
      },
    };

    renderFooterLine(
      {
        cwd: "/repo",
        thinking: level,
      },
      200,
      recordingTheme,
    );

    assert.ok(
      calls.some(([color, text]) => color === expectedToken && text === level),
      `${level} should use ${expectedToken}`,
    );
  }
});

test("renderFooterLine colors statusline percentages above warning and error thresholds", () => {
  const line = renderFooterLine(
    {
      cwd: "/repo",
      usage: renderUsage({
        primary: { usedPercent: 71, resetAfterSeconds: 2 * 3600 },
        secondary: { usedPercent: 91, resetAfterSeconds: 3 * 24 * 3600 },
      }),
      contextUsage: { percent: 92, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "high",
    } as any,
    200,
    theme,
  );

  assert.match(line, /\x1b\[33m71%\x1b\[0m/);
  assert.match(line, /\x1b\[31m91%\x1b\[0m/);
  assert.match(line, /Codex \x1b\[33m71%\x1b\[0m/);
  assert.match(line, /ctx \x1b\[31m92%\x1b\[0m\/200k/);
  assert.match(line, /2h/);
  assert.match(line, /gpt-5-codex/);
  assert.match(line, /high/);
  assert.doesNotMatch(line, /\x1b\[2m(?:Codex|2h|ctx|\/200k|gpt-5-codex|high)/);
});

test("renderFooterLine appends the git branch to the working directory in brackets", () => {
  const line = renderFooterLine(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      gitBranch: "feature/statusline-git",
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
    } as any,
    200,
    theme,
  );

  assert.equal(
    stripAnsi(line),
    "~/Workspace/agent-config [feature/statusline-git] · ctx 42%/200k · gpt-5-codex · medium",
  );
});

test("renderFooterLine styles git summary fields by meaning", () => {
  const { calls, recordingTheme } = createRecordingTheme();

  renderFooterLine(
    {
      cwd: "/repo",
      gitSummary: {
        ref: "feature/git-summary",
        ahead: 3,
        behind: 2,
        conflicts: 1,
        staged: 2,
        changed: 4,
        untracked: 1,
        stashes: 2,
      },
    },
    200,
    recordingTheme,
  );

  assert.deepEqual(
    calls.filter(([color]) => color !== "dim"),
    [
      ["accent", "feature/git-summary"],
      ["muted", "↓2↑3"],
      ["error", "✖1"],
      ["warning", "●2"],
      ["warning", "✚4"],
      ["warning", "…1"],
      ["muted", "⚑2"],
    ],
  );
});

test("renderFooterLine styles fallback git branches with the accent color", () => {
  const { calls, recordingTheme } = createRecordingTheme();

  renderFooterLine(
    {
      cwd: "/repo",
      gitBranch: "feature/statusline-git",
    },
    200,
    recordingTheme,
  );

  assert.ok(
    calls.some(
      ([color, text]) =>
        color === "accent" && text === "feature/statusline-git",
    ),
  );
});

test("renderFooterLine appends a clean checkmark for clean git summaries", () => {
  const line = renderFooterLine(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      gitSummary: { ref: "main" },
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
    } as any,
    200,
    theme,
  );

  assert.equal(
    stripAnsi(line),
    "~/Workspace/agent-config [main ✔] · ctx 42%/200k · gpt-5-codex · medium",
  );

  const { calls, recordingTheme } = createRecordingTheme();
  renderFooterLine(
    {
      cwd: "/repo",
      gitSummary: { ref: "main" },
    },
    200,
    recordingTheme,
  );
  assert.ok(calls.some(([color, text]) => color === "success" && text === "✔"));
});

test("renderFooterLine appends compact git summary symbols to the working directory", () => {
  const line = renderFooterLine(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      gitSummary: {
        ref: "feature/git-summary",
        ahead: 3,
        behind: 2,
        conflicts: 1,
        staged: 2,
        changed: 4,
        untracked: 1,
        stashes: 2,
      },
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
    } as any,
    200,
    theme,
  );

  assert.equal(
    stripAnsi(line),
    "~/Workspace/agent-config [feature/git-summary ↓2↑3 ✖1 ●2 ✚4 …1 ⚑2] · ctx 42%/200k · gpt-5-codex · medium",
  );
});

test("renderFooterLines right-aligns status segments after the repository segment", () => {
  const lines = renderFooterLines(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      usage: renderUsage({
        primary: { usedPercent: 45, resetAfterSeconds: 2 * 3600 },
        secondary: { usedPercent: 20, resetAfterSeconds: 3 * 24 * 3600 },
      }),
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
    } as any,
    100,
    theme,
  );

  assert.deepEqual(lines.map(stripAnsi), [
    "~/Workspace/agent-config                    Codex 45% (20%) 2h · ctx 42%/200k · gpt-5-codex · medium",
  ]);
});

test("renderFooterLines moves overflowing segments to subsequent lines without truncating", () => {
  const lines = renderFooterLines(
    {
      cwd: "/Users/example/Workspace/a-very-long-worktree-name-for-statusline",
      homeDir: "/Users/example",
      gitBranch: "feature/a-very-long-branch-name",
      usage: renderUsage({
        primary: { usedPercent: 45, resetAfterSeconds: 2 * 3600 },
        secondary: { usedPercent: 20, resetAfterSeconds: 3 * 24 * 3600 },
      }),
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
    } as any,
    80,
    theme,
  );

  assert.deepEqual(lines.map(stripAnsi), [
    "~/Workspace/a-very-long-worktree-name-for-statusline",
    "[feature/a-very-long-branch-name]",
    "Codex 45% (20%) 2h · ctx 42%/200k · gpt-5-codex · medium",
  ]);
});

test("renderFooterLines wraps a repository segment that exceeds the terminal width", () => {
  const width = 116;
  const lines = renderFooterLines(
    {
      cwd: "/Users/example/.local/share/wt/worktrees/setl/setl-avery-DS-3107-migrate-optional-env-vars",
      homeDir: "/Users/example",
      gitSummary: { ref: "avery/DS-3107-migrate-optional-env-vars" },
      usage: renderUsage({
        primary: { usedPercent: 28, resetAfterSeconds: 6 * 24 * 3600 },
      }),
      contextUsage: { percent: 0, contextWindow: 372_000 },
      modelId: "gpt-5.6-sol",
      thinking: "high",
    },
    width,
    theme,
  );

  assert.ok(
    lines.every((line) => visibleWidth(line) <= width),
    `footer lines must fit ${width} columns: ${lines.map(visibleWidth).join(", ")}`,
  );
});
