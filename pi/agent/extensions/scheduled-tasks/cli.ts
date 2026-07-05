import { fileURLToPath } from "node:url";
import { isSafeRunId, isSafeTaskId } from "./paths.ts";
import { loadScheduledTasksConfig } from "./config.ts";
import {
  runClaimedTask,
  schedulerTick,
  type RunSummary,
  type TickSummary,
} from "./scheduler.ts";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function usage(message: string): CliResult {
  return { exitCode: 2, stdout: "", stderr: `${message}\n` };
}

function formatWarnings(warnings: string[]): string {
  return warnings.length ? `${warnings.join("\n")}\n` : "";
}

export async function runTickCli(
  argv: string[],
  options: { cwd?: string; now?: Date } = {},
): Promise<CliResult> {
  const dryRun = argv.includes("--dry-run");
  const unknown = argv.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) return usage("Usage: tick-cli.ts [--dry-run]");
  const warnings: string[] = [];
  try {
    const config = await loadScheduledTasksConfig(
      options.cwd ?? process.cwd(),
      warnings,
    );
    const summary: TickSummary = await schedulerTick(config, {
      dryRun,
      ...(options.now ? { now: options.now } : {}),
    });
    return {
      exitCode: 0,
      stdout: jsonLine(summary),
      stderr: formatWarnings(warnings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${formatWarnings(warnings)}${message}\n`,
    };
  }
}

export async function runClaimedCli(
  argv: string[],
  options: { cwd?: string } = {},
): Promise<CliResult> {
  const [taskId, runId, ...extra] = argv;
  if (!taskId || !runId || extra.length > 0)
    return usage("Usage: run-claimed-cli.ts <task-id> <run-id>");
  if (!isSafeTaskId(taskId))
    return usage(
      "Invalid task ID. Use letters, numbers, underscores, or hyphens; no slashes or dots.",
    );
  if (!isSafeRunId(runId))
    return usage(
      "Invalid run ID. Start with a letter or number; use letters, numbers, T, underscores, dots, colons, or hyphens; no slashes.",
    );
  const warnings: string[] = [];
  try {
    const config = await loadScheduledTasksConfig(
      options.cwd ?? process.cwd(),
      warnings,
    );
    const summary: RunSummary = await runClaimedTask(config, taskId, runId);
    return {
      exitCode: 0,
      stdout: jsonLine(summary),
      stderr: formatWarnings(warnings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${formatWarnings(warnings)}${message}\n`,
    };
  }
}

export async function emitCliResult(result: Promise<CliResult>): Promise<void> {
  const resolved = await result;
  if (resolved.stdout) process.stdout.write(resolved.stdout);
  if (resolved.stderr) process.stderr.write(resolved.stderr);
  process.exitCode = resolved.exitCode;
}

export function isMain(importMetaUrl: string): boolean {
  return process.argv[1] === fileURLToPath(importMetaUrl);
}
