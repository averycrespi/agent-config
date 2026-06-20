import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScheduledTasksConfig } from "./config.ts";
import { ensureRootLayout, handoffPath, runDir, taskPath } from "./paths.ts";
import { renderPrompt } from "./prompt.ts";
import { decideDue } from "./schedule.ts";
import { buildSpawnPlan, spawnPi } from "./spawn.ts";
import { acquireLock } from "./locks.ts";
import {
  makeRunId,
  readTaskState,
  recordRunState,
  type RunResult,
  writeRunResult,
  writeTaskState,
} from "./state.ts";
import {
  readAllTasks,
  readTaskFile,
  type TaskDefinition,
} from "./task-file.ts";
import { validateTask } from "./validate.ts";

export interface RunOptions {
  manual?: boolean;
  now?: Date;
}

export interface RunSummary {
  taskId: string;
  runId?: string;
  status: string;
  message: string;
  runDir?: string;
}

function statusFromOutcome(
  outcome: Awaited<ReturnType<typeof spawnPi>>,
): RunResult["status"] {
  if (outcome.timedOut) return "timeout";
  return outcome.exitCode === 0 ? "success" : "failed";
}

export async function runTask(
  config: ScheduledTasksConfig,
  task: TaskDefinition,
  options: RunOptions = {},
): Promise<RunSummary> {
  await ensureRootLayout(config.rootDir);
  const validation = await validateTask(task, config);
  if (!validation.ok)
    return {
      taskId: task.id,
      status: "validation_failed",
      message: validation.errors.join("\n"),
    };
  if (!task.cwd) {
    return {
      taskId: task.id,
      status: "validation_failed",
      message: "cwd is required to run a scheduled task.",
    };
  }
  const runId = makeRunId(options.now);
  const dir = runDir(config.rootDir, task.id, runId);
  const lock = await acquireLock(config.rootDir, task.id, {
    taskId: task.id,
    runId,
  });
  if (!lock)
    return {
      taskId: task.id,
      status: "locked",
      message: "Task is already running.",
    };
  const startedAt = new Date().toISOString();
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const prompt = await renderPrompt({ rootDir: config.rootDir, task, runId });
    const promptPath = join(dir, "prompt.md");
    await writeFile(promptPath, prompt.prompt, { mode: 0o600 });
    const plan = buildSpawnPlan({
      config,
      task,
      runId,
      runDir: dir,
      promptPath,
    });
    const outcome = await spawnPi(plan, join(dir, "pi.log"));
    await writeFile(
      join(dir, "output.md"),
      outcome.stdout || outcome.stderr || "",
      { mode: 0o600 },
    );
    let handoffUpdated = false;
    try {
      const marker = await readFile(join(dir, "handoff-updated"), "utf8");
      handoffUpdated = marker.trim() === "1";
    } catch {
      handoffUpdated = false;
    }
    const result: RunResult = {
      taskId: task.id,
      runId,
      status: statusFromOutcome(outcome),
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      ...(outcome.sessionFile ? { sessionFile: outcome.sessionFile } : {}),
      handoffUpdated,
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    await writeRunResult(join(dir, "result.json"), result);
    await recordRunState(config.rootDir, result);
    return {
      taskId: task.id,
      runId,
      status: result.status,
      message: `Run ${runId} ${result.status}.`,
      runDir: dir,
    };
  } finally {
    await lock.release();
  }
}

export async function manualRunTask(
  config: ScheduledTasksConfig,
  taskId: string,
): Promise<RunSummary> {
  const parsed = await readTaskFile(taskPath(config.rootDir, taskId));
  if (!parsed.task)
    return {
      taskId,
      status: "not_found",
      message: parsed.errors.join("\n") || "Task not found.",
    };
  return runTask(config, parsed.task, { manual: true });
}

export interface TickSummary {
  claimed: RunSummary[];
  skipped: RunSummary[];
  dryRun: boolean;
}

export async function schedulerTick(
  config: ScheduledTasksConfig,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<TickSummary> {
  await ensureRootLayout(config.rootDir);
  const schedulerLock = await acquireLock(config.rootDir, "scheduler");
  if (!schedulerLock)
    return {
      claimed: [],
      skipped: [
        {
          taskId: "scheduler",
          status: "locked",
          message: "Scheduler lock is already held.",
        },
      ],
      dryRun: !!options.dryRun,
    };
  const now = options.now ?? new Date();
  const claimed: RunSummary[] = [];
  const skipped: RunSummary[] = [];
  const toRun: TaskDefinition[] = [];
  try {
    const parsedTasks = await readAllTasks(config.rootDir);
    for (const parsed of parsedTasks) {
      const task = parsed.task;
      if (!task) continue;
      const validation = await validateTask(task, config, parsed.errors);
      if (!validation.ok) {
        if (task.enabled)
          skipped.push({
            taskId: task.id,
            status: "validation_failed",
            message: validation.errors.join("; "),
          });
        continue;
      }
      if (!task.enabled || !task.schedule) continue;
      const state = await readTaskState(config.rootDir, task.id);
      const decision = decideDue({
        schedule: task.schedule,
        nextRunAt: state?.nextRunAt,
        now,
      });
      if (decision.action === "initialize") {
        await writeTaskState(config.rootDir, {
          ...(state ?? { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: null,
        });
        skipped.push({
          taskId: task.id,
          status: "initialized",
          message: `Initialized nextRunAt ${decision.nextRunAt.toISOString()}.`,
        });
      } else if (decision.action === "missed") {
        await writeTaskState(config.rootDir, {
          ...(state ?? { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: "missed_schedule",
        });
        skipped.push({
          taskId: task.id,
          status: "missed",
          message: "Missed schedule outside due window; not catching up.",
        });
      } else if (decision.action === "run") {
        await writeTaskState(config.rootDir, {
          ...(state ?? { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: null,
        });
        toRun.push(task);
      }
    }
  } finally {
    await schedulerLock.release();
  }
  if (options.dryRun) {
    return {
      claimed: toRun.map((task) => ({
        taskId: task.id,
        status: "due",
        message: "Dry run: would run task.",
      })),
      skipped,
      dryRun: true,
    };
  }
  for (const task of toRun) claimed.push(await runTask(config, task, { now }));
  return { claimed, skipped, dryRun: false };
}

export async function readLatestLogs(
  config: ScheduledTasksConfig,
  taskId: string,
): Promise<string> {
  const state = await readTaskState(config.rootDir, taskId);
  if (!state?.lastRunId) return `No runs recorded for ${taskId}.`;
  const dir = runDir(config.rootDir, taskId, state.lastRunId);
  const parts = [
    `Latest run: ${state.lastRunId}`,
    `Status: ${state.lastStatus ?? "unknown"}`,
    `Artifacts: ${dir}`,
  ];
  for (const file of ["result.json", "output.md", "pi.log"]) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      parts.push(`\n## ${file}\n${raw.slice(-4000)}`);
    } catch {
      parts.push(`\n## ${file}\n(unavailable)`);
    }
  }
  return parts.join("\n");
}

export async function readHandoff(
  config: ScheduledTasksConfig,
  taskId: string,
): Promise<string> {
  try {
    return await readFile(handoffPath(config.rootDir, taskId), "utf8");
  } catch {
    return "";
  }
}
