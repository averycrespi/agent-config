import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrokerTool } from "./client.ts";
import {
  findBrokerCommand,
  findToolCandidates,
  getHintMessage,
  getHintReason,
  splitCommand,
  stripQuoted,
} from "./guard.ts";

test("splitCommand splits on && || ; | and newlines, trimming segments", () => {
  assert.deepEqual(
    splitCommand("echo a && echo b || echo c ; echo d | cat\necho e"),
    ["echo a", "echo b", "echo c", "echo d", "cat", "echo e"],
  );
});

test("splitCommand ignores empty segments", () => {
  assert.deepEqual(splitCommand(" ; ; echo ok ;"), ["echo ok"]);
});

test("stripQuoted removes single- and double-quoted substrings", () => {
  assert.equal(
    stripQuoted(`git commit -m "fix gh issue" && echo 'git push'`),
    "git commit -m  && echo ",
  );
});

test("findBrokerCommand flags a bare gh invocation", () => {
  assert.deepEqual(findBrokerCommand("gh pr list"), {
    kind: "github-cli",
    segment: "gh pr list",
  });
});

test("findBrokerCommand flags gh behind env-style assignment prefixes", () => {
  assert.deepEqual(findBrokerCommand("GH_TOKEN=abc gh pr list"), {
    kind: "github-cli",
    segment: "GH_TOKEN=abc gh pr list",
  });
});

test("findBrokerCommand flags gh behind 'env ASSIGN=v gh ...'", () => {
  assert.deepEqual(findBrokerCommand("env FOO=1 gh pr list"), {
    kind: "github-cli",
    segment: "env FOO=1 gh pr list",
  });
});

test("findBrokerCommand flags gh behind 'command'/'builtin' prefixes", () => {
  assert.deepEqual(findBrokerCommand("command gh pr list"), {
    kind: "github-cli",
    segment: "command gh pr list",
  });
  assert.deepEqual(findBrokerCommand("builtin gh pr list"), {
    kind: "github-cli",
    segment: "builtin gh pr list",
  });
});

test("findBrokerCommand flags gh invoked by absolute path", () => {
  assert.deepEqual(findBrokerCommand("/usr/local/bin/gh auth status"), {
    kind: "github-cli",
    segment: "/usr/local/bin/gh auth status",
  });
});

test("findBrokerCommand flags each git remote-oriented subcommand", () => {
  for (const sub of ["push", "pull", "fetch", "ls-remote", "remote"]) {
    const cmd = `git ${sub}${sub === "remote" ? " -v" : " origin main"}`;
    const match = findBrokerCommand(cmd);
    assert.ok(match, `expected match for: ${cmd}`);
    assert.equal(match.kind, "git-remote");
  }
});

test("findBrokerCommand flags `git -C <path> <remote-subcommand>`", () => {
  const match = findBrokerCommand("git -C /tmp/repo pull");
  assert.ok(match);
  assert.equal(match.kind, "git-remote");
  assert.equal(match.segment, "git -C /tmp/repo pull");
});

test("findBrokerCommand flags multiple stacked git global flags", () => {
  const match = findBrokerCommand(
    "git -C /tmp/repo -c user.name=foo --no-pager push origin main",
  );
  assert.ok(match);
  assert.equal(match.kind, "git-remote");
});

test("findBrokerCommand flags `git --git-dir=/path pull`", () => {
  const match = findBrokerCommand("git --git-dir=/path pull");
  assert.ok(match);
  assert.equal(match.kind, "git-remote");
});

test("findBrokerCommand still ignores `git -C <path> status` (local subcommand)", () => {
  assert.equal(findBrokerCommand("git -C /tmp/repo status"), undefined);
  assert.equal(findBrokerCommand("git --no-pager log --oneline"), undefined);
});

test("findBrokerCommand ignores local-only git commands", () => {
  assert.equal(findBrokerCommand("git status"), undefined);
  assert.equal(findBrokerCommand("git log --oneline"), undefined);
  assert.equal(findBrokerCommand("git diff HEAD"), undefined);
  assert.equal(findBrokerCommand("git commit -m 'x'"), undefined);
});

test("findBrokerCommand returns undefined for unrelated commands", () => {
  assert.equal(findBrokerCommand("ls -la"), undefined);
  assert.equal(findBrokerCommand("echo 'gh is a tool'"), undefined);
});

test("findBrokerCommand ignores commands like gh-pages-cli that merely start with 'gh'", () => {
  assert.equal(findBrokerCommand("gh-pages-cli build"), undefined);
  assert.equal(findBrokerCommand("ghostscript --version"), undefined);
});

test("findBrokerCommand ignores 'gh' inside a quoted commit message", () => {
  assert.equal(
    findBrokerCommand(`git commit -m "fix issue with gh PR list"`),
    undefined,
  );
});

test("findBrokerCommand ignores 'git push' inside a quoted message", () => {
  assert.equal(
    findBrokerCommand(`echo "remember to git push later"`),
    undefined,
  );
});

test("findBrokerCommand catches the matched segment inside a pipeline", () => {
  const match = findBrokerCommand("echo starting && git push origin main");
  assert.ok(match);
  assert.equal(match.kind, "git-remote");
  assert.equal(match.segment, "git push origin main");
});

test("findBrokerCommand catches gh after a single-pipe (|)", () => {
  const match = findBrokerCommand("echo x | gh pr list");
  assert.ok(match);
  assert.equal(match.kind, "github-cli");
  assert.equal(match.segment, "gh pr list");
});

test("findBrokerCommand returns the first match when multiple are present", () => {
  const match = findBrokerCommand("gh pr list || git push");
  assert.ok(match);
  assert.equal(match.kind, "github-cli");
});

test("getHintReason returns distinct strings per kind", () => {
  const gh = getHintReason("github-cli");
  const git = getHintReason("git-remote");
  assert.match(gh, /GitHub CLI/);
  assert.match(git, /[Rr]emote git/);
  assert.notEqual(gh, git);
});

const SAMPLE_TOOLS: BrokerTool[] = [
  { name: "github.list_pull_requests", description: "List pull requests" },
  {
    name: "github.pull_request_read",
    description: "Get information on a pull request",
  },
  {
    name: "github.create_pull_request",
    description: "Create a new pull request",
  },
  { name: "github.list_issues", description: "List issues in a repo" },
  { name: "git.git_push", description: "Push to a remote" },
  { name: "git.git_pull", description: "Pull from a remote" },
  { name: "git.git_fetch", description: "Fetch from a remote" },
];

test("findToolCandidates returns top github matches for `gh pr list`", () => {
  const matches = findToolCandidates("gh pr list", "github", SAMPLE_TOOLS);
  assert.ok(matches.length > 0);
  assert.equal(matches[0].name, "github.list_pull_requests");
  // Should not include git.* tools
  for (const m of matches) assert.ok(m.name.startsWith("github."));
});

test("findToolCandidates returns the push tool for `git push origin main`", () => {
  const matches = findToolCandidates(
    "git push origin main",
    "git",
    SAMPLE_TOOLS,
  );
  assert.ok(matches.length > 0);
  assert.equal(matches[0].name, "git.git_push");
});

test("findToolCandidates respects the limit", () => {
  const matches = findToolCandidates("pr", "github", SAMPLE_TOOLS, 2);
  assert.ok(matches.length <= 2);
});

test("findToolCandidates returns [] when nothing scores", () => {
  const matches = findToolCandidates("gh", "github", SAMPLE_TOOLS);
  // After stripping the `gh` stopword, no informative tokens remain.
  assert.deepEqual(matches, []);
});

test("getHintMessage includes segment, namespace, and tool candidates", () => {
  const msg = getHintMessage({ kind: "github-cli", segment: "gh pr list" }, [
    SAMPLE_TOOLS[0],
    SAMPLE_TOOLS[1],
  ]);
  assert.match(msg, /\[mcp-broker hint\]/);
  assert.match(msg, /gh pr list/);
  assert.match(msg, /mcp_call/);
  assert.match(msg, /github\.list_pull_requests/);
  assert.match(msg, /github\.pull_request_read/);
});

test("getHintMessage falls back to mcp_search guidance when no candidates", () => {
  const msg = getHintMessage({ kind: "git-remote", segment: "git push" }, []);
  assert.match(msg, /mcp_search/);
  assert.match(msg, /query="git"/);
});
