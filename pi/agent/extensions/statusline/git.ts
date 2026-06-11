import {
  execFile as nodeExecFile,
  type ExecFileException,
} from "node:child_process";

export const _execFile = { fn: nodeExecFile };

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
