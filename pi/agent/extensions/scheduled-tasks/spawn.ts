import { spawn as _nodeSpawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { ScheduledTasksConfig } from "./config.ts";
import type { TaskDefinition } from "./task-file.ts";
import { effectiveTools } from "./validate.ts";

export const _spawn = { fn: _nodeSpawn };
export const _timers = { setTimeout, clearTimeout };

export interface SpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface SpawnOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  sessionFile?: string;
}

export function buildSpawnPlan(options: {
  config: ScheduledTasksConfig;
  task: TaskDefinition;
  runId: string;
  runDir: string;
  promptPath: string;
}): SpawnPlan {
  const tools = effectiveTools(options.task, options.config);
  const args = [
    "--mode",
    "json",
    "--session-dir",
    `${options.config.rootDir}/sessions/${options.task.id}`,
    "--name",
    `scheduled: ${options.task.id} ${options.runId}`,
  ];
  if (options.task.model) args.push("--model", options.task.model);
  if (options.task.thinking) args.push("--thinking", options.task.thinking);
  if (tools.length > 0) args.push("--tools", tools.join(","));
  else args.push("--no-tools");
  args.push("-p", `@${options.promptPath}`);
  const timeoutMinutes =
    options.task.timeoutMinutes ?? options.config.defaultTimeoutMinutes;
  return {
    command: options.config.piCommand,
    args,
    cwd: options.task.cwd ?? process.cwd(),
    env: {
      ...Object.fromEntries(
        Object.entries(options.task.env ?? {}).map(([key, value]) => [
          key,
          value,
        ]),
      ),
      SCHEDULED_TASKS_ROOT_DIR: options.config.rootDir,
      PI_SCHEDULED_TASK_RUN: "1",
      PI_SCHEDULED_TASK_ID: options.task.id,
      PI_SCHEDULED_TASK_RUN_ID: options.runId,
      PI_SCHEDULED_TASK_RUN_DIR: options.runDir,
    },
    timeoutMs: timeoutMinutes * 60_000,
  };
}

function extractSessionFile(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        sessionFile?: unknown;
        session_file?: unknown;
      };
      const value = event.sessionFile ?? event.session_file;
      if (typeof value === "string") return value;
    } catch {
      // ignore non-json output
    }
  }
  return undefined;
}

export async function spawnPi(
  plan: SpawnPlan,
  logPath: string,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const child = _spawn.fn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = async (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      _timers.clearTimeout(timer);
      await writeFile(
        logPath,
        [
          `$ ${plan.command} ${plan.args.join(" ")}`,
          "",
          "## stdout",
          stdout,
          "",
          "## stderr",
          stderr,
        ].join("\n"),
        { mode: 0o600 },
      );
      resolve({
        ...outcome,
        stdout,
        stderr,
        timedOut,
        sessionFile: extractSessionFile(stdout),
      });
    };
    const timer = _timers.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      _timers.setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, plan.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on(
      "error",
      (error) =>
        void finish({
          exitCode: null,
          signal: null,
          timedOut,
          stdout,
          stderr,
          error: error.message,
        }),
    );
    child.on(
      "close",
      (code, signal) =>
        void finish({ exitCode: code, signal, timedOut, stdout, stderr }),
    );
  });
}
