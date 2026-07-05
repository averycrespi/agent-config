import { execFile as _nodeExecFile } from "node:child_process";
import { getManagedBlock } from "./cron.ts";

export const _execFile = { fn: _nodeExecFile };

export type CrontabStatus =
  | { status: "installed" }
  | { status: "installed_stale"; message: string }
  | { status: "not_installed" }
  | { status: "unavailable"; message: string };

function unavailableMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const code = "code" in error ? String(error.code) : undefined;
    const signal = "signal" in error ? String(error.signal) : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (code) return `crontab exited ${code}`;
    if (signal) return `crontab signaled ${signal}`;
    return message;
  }
  return String(error);
}

function isMissingUserCrontab(error: unknown, stderr: string): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  return code === "1" && /no crontab for/i.test(stderr);
}

export async function readCurrentCrontab(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    _execFile.fn("crontab", ["-l"], (error, stdout, stderr) => {
      if (error) {
        if (isMissingUserCrontab(error, String(stderr ?? ""))) resolve("");
        else reject(error);
        return;
      }
      resolve(String(stdout ?? ""));
    });
  });
}

export async function writeCrontab(content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = _execFile.fn("crontab", ["-"], (error) =>
      error ? reject(error) : resolve(),
    );
    child.stdin?.end(content);
  });
}

export async function getCrontabStatus(
  expectedBlock?: string,
): Promise<CrontabStatus> {
  try {
    const crontab = await readCurrentCrontab();
    const installed = getManagedBlock(crontab);
    if (!installed) return { status: "not_installed" };
    if (expectedBlock && installed !== expectedBlock) {
      const oldPiCommand =
        installed.includes("/scheduled-tasks-tick") ||
        installed.includes(" -p ");
      return {
        status: "installed_stale",
        message: oldPiCommand
          ? "managed block uses the old Pi slash-command scheduler; reinstall cron to use the deterministic CLI"
          : "managed block differs from the expected deterministic scheduler command; reinstall cron",
      };
    }
    return { status: "installed" };
  } catch (error) {
    return { status: "unavailable", message: unavailableMessage(error) };
  }
}

export function formatCrontabStatus(status: CrontabStatus): string {
  switch (status.status) {
    case "installed":
      return "cron: installed";
    case "installed_stale":
      return `cron: installed, needs update (${status.message})`;
    case "not_installed":
      return "cron: not installed";
    case "unavailable":
      return `cron: unavailable (${status.message})`;
  }
}
