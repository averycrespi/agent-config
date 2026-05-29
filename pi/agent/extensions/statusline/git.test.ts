import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { _execFileSync, getGitBranch } from "./git.ts";

test("getGitBranch returns the current branch name", () => {
  const execStub = mock.method(
    _execFileSync,
    "fn",
    () => "feature/statusline-git\n",
  );

  try {
    assert.equal(getGitBranch("/repo"), "feature/statusline-git");
  } finally {
    execStub.mock.restore();
  }
});

test("getGitBranch returns undefined outside a git repository", () => {
  const execStub = mock.method(_execFileSync, "fn", () => {
    throw new Error("not a git repo");
  });

  try {
    assert.equal(getGitBranch("/repo"), undefined);
  } finally {
    execStub.mock.restore();
  }
});

test("getGitBranch identifies detached HEAD by short hash", () => {
  const execStub = mock.method(
    _execFileSync,
    "fn",
    (_file: string, args: string[]) => {
      return args.includes("--abbrev-ref") ? "HEAD\n" : "abc1234\n";
    },
  );

  try {
    assert.equal(getGitBranch("/repo"), "detached: abc1234");
  } finally {
    execStub.mock.restore();
  }
});
