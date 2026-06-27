import { writeFile } from "node:fs/promises";
import type { ScheduledTasksConfig } from "./config.ts";
import { scriptPath } from "./paths.ts";
import { _spawn, _timers, OUTPUT_TAIL_BYTES } from "./spawn.ts";
import type { TaskDefinition, TaskPrecheck } from "./task-file.ts";

const KILL_ESCALATION_MS = 3_000;

export interface PrecheckPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  skipExitCodes: number[];
}

export interface PrecheckOutcome {
  status: "passed" | "skipped" | "failed";
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  startedAt: string;
  endedAt: string;
  stdout: string;
  stderr: string;
  error?: string;
}

function appendTail(current: string, chunk: string): string {
  let combined = current + chunk;
  while (Buffer.byteLength(combined) > OUTPUT_TAIL_BYTES) {
    combined = combined.slice(Math.max(1, combined.length >> 1));
  }
  return combined;
}

function precheckStatus(
  exitCode: number | null,
  timedOut: boolean,
  error: string | undefined,
  skipExitCodes: number[],
): PrecheckOutcome["status"] {
  if (exitCode === 0 && !timedOut && !error) return "passed";
  if (exitCode !== null && skipExitCodes.includes(exitCode)) return "skipped";
  return "failed";
}

function precheckEnv(options: {
  config: ScheduledTasksConfig;
  task: TaskDefinition;
  runId: string;
  runDir: string;
  envFileValues?: Record<string, string>;
}): Record<string, string> {
  return {
    ...(options.envFileValues ?? {}),
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
  };
}

export function buildPrecheckPlan(options: {
  config: ScheduledTasksConfig;
  task: TaskDefinition & { precheck: TaskPrecheck };
  runId: string;
  runDir: string;
  envFileValues?: Record<string, string>;
}): PrecheckPlan {
  const precheck = options.task.precheck;
  return {
    command: precheck.interpreter,
    args: [
      scriptPath(options.config.rootDir, precheck.script),
      ...precheck.args,
    ],
    cwd: options.task.cwd ?? process.cwd(),
    env: precheckEnv(options),
    timeoutMs: precheck.timeoutSeconds * 1000,
    skipExitCodes: precheck.skipExitCodes,
  };
}

export async function runPrecheck(
  plan: PrecheckPlan,
  logPath: string,
): Promise<PrecheckOutcome> {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: {
      exitCode: number | null;
      signal: string | null;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      if (timer) _timers.clearTimeout(timer);
      if (killTimer) _timers.clearTimeout(killTimer);
      const endedAt = new Date().toISOString();
      const status = precheckStatus(
        outcome.exitCode,
        timedOut,
        outcome.error,
        plan.skipExitCodes,
      );
      void (async () => {
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
        ).catch(() => undefined);
        resolve({
          status,
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          timedOut,
          startedAt,
          endedAt,
          stdout,
          stderr,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
      })();
    };
    let child: ReturnType<typeof _spawn.fn>;
    try {
      child = _spawn.fn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: { ...process.env, ...plan.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({
        exitCode: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    timer = _timers.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = _timers.setTimeout(
        () => child.kill("SIGKILL"),
        KILL_ESCALATION_MS,
      );
    }, plan.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = appendTail(stdout, String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendTail(stderr, String(chunk));
    });
    child.on("error", (error) =>
      finish({ exitCode: null, signal: null, error: error.message }),
    );
    child.on("close", (code, signal) => finish({ exitCode: code, signal }));
  });
}
