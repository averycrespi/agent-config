import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { _execFile, getGitBranch, getGitSummary } from "./git.ts";

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

test("getGitSummary collects branch tracking and working tree counts", async () => {
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, args: string[], _options: unknown, cb: Function) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref HEAD") {
        cb(null, "feature/git-summary\n");
      } else if (
        command === "rev-list --left-right --count @{upstream}...HEAD"
      ) {
        cb(null, "2\t3\n");
      } else if (command === "status --porcelain") {
        cb(
          null,
          [
            "UU conflicted.ts",
            "A  staged.ts",
            " M changed.ts",
            "?? new.ts",
          ].join("\n"),
        );
      } else if (command === "stash list") {
        cb(null, "stash@{0}: WIP\nstash@{1}: WIP\n");
      } else {
        cb(new Error(`unexpected git command: ${command}`), "");
      }
    },
  );

  try {
    assert.deepEqual(await getGitSummary("/repo"), {
      ref: "feature/git-summary",
      ahead: 3,
      behind: 2,
      conflicts: 1,
      staged: 1,
      changed: 1,
      untracked: 1,
      stashes: 2,
    });
  } finally {
    execStub.mock.restore();
  }
});

test("getGitSummary omits zero-valued counts and tolerates missing upstream", async () => {
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, args: string[], _options: unknown, cb: Function) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref HEAD") cb(null, "main\n");
      else if (command === "rev-list --left-right --count @{upstream}...HEAD") {
        cb(new Error("no upstream"), "");
      } else if (command === "status --porcelain") cb(null, "");
      else if (command === "stash list") cb(null, "");
      else cb(new Error(`unexpected git command: ${command}`), "");
    },
  );

  try {
    assert.deepEqual(await getGitSummary("/repo"), { ref: "main" });
  } finally {
    execStub.mock.restore();
  }
});
