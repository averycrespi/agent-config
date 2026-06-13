import {
  execFile as nodeExecFile,
  type ExecFileException,
} from "node:child_process";

export const _execFile = { fn: nodeExecFile };

export interface GitSummary {
  ref: string;
  ahead?: number;
  behind?: number;
  conflicts?: number;
  staged?: number;
  changed?: number;
  untracked?: number;
  stashes?: number;
}

function runGit(
  cwd: string,
  args: string[],
  timeout = 500,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    _execFile.fn(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout,
        windowsHide: true,
      },
      (error: ExecFileException | null, stdout: string) => {
        if (error) {
          resolve(undefined);
          return;
        }
        resolve(String(stdout).trim() || undefined);
      },
    );
  });
}

export async function getGitBranch(cwd: string): Promise<string | undefined> {
  const branch = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return undefined;
  if (branch !== "HEAD") return branch;

  const shortHash = await runGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return shortHash ? `detached: ${shortHash}` : undefined;
}

function countOrUndefined(value: number): number | undefined {
  return value > 0 ? value : undefined;
}

function parseTracking(output: string | undefined): {
  ahead?: number;
  behind?: number;
} {
  if (!output) return {};
  const [behindText, aheadText] = output.split(/\s+/, 2);
  const behind = Number(behindText);
  const ahead = Number(aheadText);
  return {
    behind: Number.isFinite(behind) ? countOrUndefined(behind) : undefined,
    ahead: Number.isFinite(ahead) ? countOrUndefined(ahead) : undefined,
  };
}

function parseStatus(
  output: string | undefined,
): Pick<GitSummary, "conflicts" | "staged" | "changed" | "untracked"> {
  let conflicts = 0;
  let staged = 0;
  let changed = 0;
  let untracked = 0;

  for (const line of output?.split("\n") ?? []) {
    if (!line) continue;
    const index = line[0];
    const worktree = line[1];

    if (index === "?" && worktree === "?") {
      untracked += 1;
      continue;
    }

    if (
      index === "U" ||
      worktree === "U" ||
      (index === "A" && worktree === "A") ||
      (index === "D" && worktree === "D")
    ) {
      conflicts += 1;
      continue;
    }

    if (index && index !== " " && index !== "!") staged += 1;
    if (worktree && worktree !== " " && worktree !== "!") changed += 1;
  }

  return {
    conflicts: countOrUndefined(conflicts),
    staged: countOrUndefined(staged),
    changed: countOrUndefined(changed),
    untracked: countOrUndefined(untracked),
  };
}

function parseStashes(output: string | undefined): number | undefined {
  const count = output?.split("\n").filter((line) => line.trim()).length ?? 0;
  return countOrUndefined(count);
}

export async function getGitSummary(
  cwd: string,
): Promise<GitSummary | undefined> {
  const ref = await getGitBranch(cwd);
  if (!ref) return undefined;

  const [tracking, status, stashes] = await Promise.all([
    runGit(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
    runGit(cwd, ["status", "--porcelain"]),
    runGit(cwd, ["stash", "list"]),
  ]);

  const summary: GitSummary = {
    ref,
    ...parseTracking(tracking),
    ...parseStatus(status),
    stashes: parseStashes(stashes),
  };

  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => value !== undefined),
  ) as GitSummary;
}
