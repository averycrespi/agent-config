import { execFile as _nodeExecFile } from "node:child_process";
import { hasManagedBlock } from "./cron.ts";

export const _execFile = { fn: _nodeExecFile };

export type CrontabStatus =
  | { status: "installed" }
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

export async function getCrontabStatus(): Promise<CrontabStatus> {
  try {
    const crontab = await readCurrentCrontab();
    return hasManagedBlock(crontab)
      ? { status: "installed" }
      : { status: "not_installed" };
  } catch (error) {
    return { status: "unavailable", message: unavailableMessage(error) };
  }
}

export function formatCrontabStatus(status: CrontabStatus): string {
  switch (status.status) {
    case "installed":
      return "cron: installed";
    case "not_installed":
      return "cron: not installed";
    case "unavailable":
      return `cron: unavailable (${status.message})`;
  }
}
