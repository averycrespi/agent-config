import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { _execFile, getGitBranch } from "./git.ts";

test("getGitBranch returns the current branch name", async () => {
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, _args: string[], _options: unknown, cb: Function) => {
      cb(null, "feature/statusline-git\n");
    },
  );

  try {
    assert.equal(await getGitBranch("/repo"), "feature/statusline-git");
  } finally {
    execStub.mock.restore();
  }
});

test("getGitBranch returns undefined outside a git repository", async () => {
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, _args: string[], _options: unknown, cb: Function) => {
      cb(new Error("not a git repo"), "");
    },
  );

  try {
    assert.equal(await getGitBranch("/repo"), undefined);
  } finally {
    execStub.mock.restore();
  }
});

test("getGitBranch identifies detached HEAD by short hash", async () => {
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, args: string[], _options: unknown, cb: Function) => {
      cb(null, args.includes("--abbrev-ref") ? "HEAD\n" : "abc1234\n");
    },
  );

  try {
    assert.equal(await getGitBranch("/repo"), "detached: abc1234");
  } finally {
    execStub.mock.restore();
  }
});

test("getGitBranch passes a timeout to git calls", async () => {
  const calls: Array<{ timeout?: number }> = [];
  const execStub = mock.method(
    _execFile,
    "fn",
    (
      _file: string,
      _args: string[],
      options: { timeout?: number },
      cb: Function,
    ) => {
      calls.push({ timeout: options.timeout });
      cb(null, "main\n");
    },
  );

  try {
    await getGitBranch("/repo");
    assert.deepEqual(calls, [{ timeout: 500 }]);
  } finally {
    execStub.mock.restore();
  }
});
