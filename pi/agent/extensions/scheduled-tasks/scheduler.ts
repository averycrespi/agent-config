import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ScheduledTasksConfig } from "./config.ts";
import {
  ensureRootLayout,
  handoffPath,
  runDir,
  taskPath,
  tickLogPath,
} from "./paths.ts";
import { loadTaskEnvFiles } from "./env-files.ts";
import { renderPrompt } from "./prompt.ts";
import { decideDue } from "./schedule.ts";
import { buildSpawnPlan, spawnPi } from "./spawn.ts";
import { acquireLock, type HeldLock } from "./locks.ts";
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
  now?: Date;
  heldLock?: HeldLock;
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
  if (!validation.ok) {
    await options.heldLock?.release();
    return {
      taskId: task.id,
      status: "validation_failed",
      message: validation.errors.join("\n"),
    };
  }
  if (!task.cwd) {
    await options.heldLock?.release();
    return {
      taskId: task.id,
      status: "validation_failed",
      message: "cwd is required to run a scheduled task.",
    };
  }
  const runId = options.heldLock?.metadata.runId ?? makeRunId(options.now);
  const dir = runDir(config.rootDir, task.id, runId);
  const lock =
    options.heldLock ??
    (await acquireLock(config.rootDir, task.id, {
      taskId: task.id,
      runId,
    }));
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
    const envFileResult = await loadTaskEnvFiles(task);
    if (envFileResult.issues.length > 0)
      return {
        taskId: task.id,
        status: "validation_failed",
        message: envFileResult.issues
          .map((issue) => `envFiles ${issue.path}: ${issue.message}`)
          .join("\n"),
      };
    const plan = buildSpawnPlan({
      config,
      task,
      runId,
      runDir: dir,
      promptPath,
      envFileValues: envFileResult.values,
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
  return runTask(config, parsed.task);
}

export interface TaskSkipSummary {
  taskId: string;
  status: string;
  message: string;
}

export interface TickSummary {
  timestamp: string;
  status: "ok" | "locked";
  message?: string;
  claimed: RunSummary[];
  skipped: TaskSkipSummary[];
  dryRun: boolean;
}

const TICK_LOG_RETAIN = 1000;

async function trimTickLog(path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= TICK_LOG_RETAIN) return;
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${lines.slice(-TICK_LOG_RETAIN).join("\n")}\n`, {
    mode: 0o600,
  });
  await rename(tmp, path);
}

async function recordTickLog(
  rootDir: string,
  summary: TickSummary,
): Promise<void> {
  const path = tickLogPath(rootDir);
  await appendFile(path, `${JSON.stringify(summary)}\n`, { mode: 0o600 });
  await trimTickLog(path);
}

async function tryRecordTickLog(
  rootDir: string,
  summary: TickSummary,
): Promise<void> {
  try {
    await recordTickLog(rootDir, summary);
  } catch {
    // Tick logging must not make scheduler execution fail.
  }
}

function tickSummary(options: {
  timestamp: string;
  status?: TickSummary["status"];
  message?: string;
  claimed?: RunSummary[];
  skipped?: TaskSkipSummary[];
  dryRun: boolean;
}): TickSummary {
  return {
    timestamp: options.timestamp,
    status: options.status ?? "ok",
    ...(options.message ? { message: options.message } : {}),
    claimed: options.claimed ?? [],
    skipped: options.skipped ?? [],
    dryRun: options.dryRun,
  };
}

export async function schedulerTick(
  config: ScheduledTasksConfig,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<TickSummary> {
  await ensureRootLayout(config.rootDir);
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const schedulerLock = await acquireLock(config.rootDir, "scheduler");
  if (!schedulerLock) {
    const summary = tickSummary({
      timestamp,
      status: "locked",
      message: "Scheduler lock is already held.",
      dryRun: !!options.dryRun,
    });
    await tryRecordTickLog(config.rootDir, summary);
    return summary;
  }
  const claimed: RunSummary[] = [];
  const skipped: TaskSkipSummary[] = [];
  const toRun: Array<{
    task: TaskDefinition;
    lock?: HeldLock;
    catchup?: boolean;
  }> = [];
  const maxCatchupRuns = Math.max(
    0,
    Math.floor(config.maxCatchupRunsPerTick ?? 1),
  );
  let catchupRuns = 0;
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
        if (!options.dryRun)
          await writeTaskState(config.rootDir, {
            ...(state ?? { taskId: task.id }),
            nextRunAt: decision.nextRunAt.toISOString(),
            lastSkipReason: null,
          });
        skipped.push({
          taskId: task.id,
          status: options.dryRun ? "would_initialize" : "initialized",
          message: `${options.dryRun ? "Dry run: would initialize" : "Initialized"} nextRunAt ${decision.nextRunAt.toISOString()}.`,
        });
      } else if (decision.action === "missed") {
        if (!task.catchup) {
          if (!options.dryRun)
            await writeTaskState(config.rootDir, {
              ...(state ?? { taskId: task.id }),
              nextRunAt: decision.nextRunAt.toISOString(),
              lastSkipReason: "missed_schedule",
            });
          skipped.push({
            taskId: task.id,
            status: options.dryRun ? "would_miss" : "missed",
            message:
              "Missed schedule outside due window; catchup is not enabled.",
          });
          continue;
        }
        if (catchupRuns >= maxCatchupRuns) {
          skipped.push({
            taskId: task.id,
            status: "catchup_deferred",
            message:
              "Catchup deferred because maxCatchupRunsPerTick was reached.",
          });
          continue;
        }
        if (options.dryRun) {
          catchupRuns += 1;
          toRun.push({ task, catchup: true });
          continue;
        }
        const runId = makeRunId(now);
        const lock = await acquireLock(config.rootDir, task.id, {
          taskId: task.id,
          runId,
        });
        if (!lock) {
          skipped.push({
            taskId: task.id,
            status: "locked",
            message: "Task is already running; nextRunAt was not advanced.",
          });
          continue;
        }
        catchupRuns += 1;
        await writeTaskState(config.rootDir, {
          ...(state ?? { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: null,
        });
        toRun.push({ task, lock, catchup: true });
      } else if (decision.action === "run") {
        if (options.dryRun) {
          toRun.push({ task });
          continue;
        }
        const runId = makeRunId(now);
        const lock = await acquireLock(config.rootDir, task.id, {
          taskId: task.id,
          runId,
        });
        if (!lock) {
          skipped.push({
            taskId: task.id,
            status: "locked",
            message: "Task is already running; nextRunAt was not advanced.",
          });
          continue;
        }
        await writeTaskState(config.rootDir, {
          ...(state ?? { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: null,
        });
        toRun.push({ task, lock });
      }
    }
  } finally {
    await schedulerLock.release();
  }
  if (options.dryRun) {
    const summary = tickSummary({
      timestamp,
      claimed: toRun.map(({ task, catchup }) => ({
        taskId: task.id,
        status: catchup ? "would_catchup" : "would_run",
        message: catchup
          ? "Dry run: would run one catchup for missed schedule."
          : "Dry run: would run task.",
      })),
      skipped,
      dryRun: true,
    });
    await tryRecordTickLog(config.rootDir, summary);
    return summary;
  }
  for (const { task, lock, catchup } of toRun) {
    if (!lock) continue;
    const summary = await runTask(config, task, { now, heldLock: lock });
    claimed.push(
      catchup && summary.status === "success"
        ? { ...summary, message: `Catchup run ${summary.runId} success.` }
        : summary,
    );
  }
  const summary = tickSummary({ timestamp, claimed, skipped, dryRun: false });
  await tryRecordTickLog(config.rootDir, summary);
  return summary;
}

export async function readLatestTickLog(
  rootDir: string,
): Promise<TickSummary | undefined> {
  try {
    const raw = await readFile(tickLogPath(rootDir), "utf8");
    const latest = raw.split(/\r?\n/).filter(Boolean).at(-1);
    if (!latest) return undefined;
    const parsed = JSON.parse(latest) as TickSummary;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (parsed.status !== "ok" && parsed.status !== "locked") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function formatLatestTick(summary: TickSummary | undefined): string {
  if (!summary) return "last tick: none";
  const counts = `claimed=${summary.claimed.length} skipped=${summary.skipped.length}`;
  return `last tick: ${summary.timestamp} ${summary.status}, ${counts}${summary.dryRun ? " dry-run" : ""}${summary.message ? ` — ${summary.message}` : ""}`;
}

async function readFileTail(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
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
      const raw =
        file === "result.json"
          ? await readFile(join(dir, file), "utf8")
          : await readFileTail(join(dir, file), 4000);
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
