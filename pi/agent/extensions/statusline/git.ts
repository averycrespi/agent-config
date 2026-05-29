import { execFileSync as nodeExecFileSync } from "node:child_process";

export const _execFileSync = { fn: nodeExecFileSync };

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    return _execFileSync
      .fn("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
  } catch {
    return undefined;
  }
}

export function getGitBranch(cwd: string): string | undefined {
  const branch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return undefined;
  if (branch !== "HEAD") return branch;

  const shortHash = runGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return shortHash ? `detached: ${shortHash}` : undefined;
}
