import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFooterLine } from "./footer.ts";
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
  assert.match(line, /\x1b\[2mCodex\x1b\[0m \x1b\[2m45%\x1b\[0m/);
  assert.match(line, /\x1b\[2m20%\x1b\[0m/);
  assert.match(line, /\x1b\[2mctx\x1b\[0m \x1b\[2m42%\x1b\[0m/);
  assert.match(line, /\x1b\[2mmedium\x1b\[0m/);
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
  assert.match(line, /\x1b\[2mCodex\x1b\[0m \x1b\[33m71%\x1b\[0m/);
  assert.match(
    line,
    /\x1b\[2mctx\x1b\[0m \x1b\[31m92%\x1b\[0m\x1b\[2m\/200k\x1b\[0m/,
  );
  assert.match(line, /\x1b\[2m2h\x1b\[0m/);
  assert.match(line, /\x1b\[2mgpt-5-codex\x1b\[0m/);
  assert.match(line, /\x1b\[2mhigh\x1b\[0m/);
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

test("renderFooterLine drops lower-priority statusline segments first when width is tight", () => {
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
    52,
    theme,
  );

  assert.equal(
    stripAnsi(line),
    "~/Workspace/agent-config · Codex 45% (20%) 2h",
  );
});

test("renderFooterLine prefixes workflow mode and hides the normal-mode badge", () => {
  const workflowLine = renderFooterLine(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "high",
      workflowMode: "plan",
      workflowBaseThinking: "high",
    } as any,
    200,
    theme,
  );
  const normalLine = renderFooterLine(
    {
      cwd: "/Users/example/Workspace/agent-config",
      homeDir: "/Users/example",
      contextUsage: { percent: 42, contextWindow: 200_000 },
      modelId: "gpt-5-codex",
      thinking: "medium",
      workflowMode: "normal",
    } as any,
    200,
    theme,
  );

  assert.equal(
    stripAnsi(workflowLine),
    "plan mode · ~/Workspace/agent-config · ctx 42%/200k · gpt-5-codex · high",
  );
  assert.equal(
    stripAnsi(normalLine),
    "~/Workspace/agent-config · ctx 42%/200k · gpt-5-codex · medium",
  );
});

test("renderFooterLine shows workflow base thinking only when overridden", () => {
  const line = renderFooterLine(
    {
      cwd: "/repo",
      modelId: "gpt-5-codex",
      thinking: "low",
      workflowMode: "verify",
      workflowBaseThinking: "high",
    } as any,
    200,
    theme,
  );

  assert.equal(
    stripAnsi(line),
    "verify mode · /repo · gpt-5-codex · low (base: high)",
  );
  assert.match(line, /\x1b\[2mlow\x1b\[0m \x1b\[2m\(base: high\)\x1b\[0m/);
});
