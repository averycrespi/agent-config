import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { SpawnOptions } from "node:child_process";
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
import { buildSpawnPlan, spawnPi, _spawn } from "./spawn.ts";
import {
  acquireLock,
  lockFromMetadata,
  readLock,
  type HeldLock,
  type LockMetadata,
} from "./locks.ts";
import {
  makeRunId,
  readRunLifecycleStrict,
  readTaskState,
  readTaskStateStrict,
  recordRunState,
  type RunLifecycle,
  type RunResult,
  writeRunLifecycle,
  writeRunResult,
  writeTaskState,
} from "./state.ts";
import {
  parseTaskMarkdown,
  readAllTasks,
  readTaskFile,
  type TaskDefinition,
} from "./task-file.ts";
import { validateTask } from "./validate.ts";

export interface RunOptions {
  now?: Date;
  heldLock?: HeldLock;
  lifecycle?: RunLifecycle;
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
): "success" | "failed" | "timeout" {
  if (outcome.timedOut) return "timeout";
  if (outcome.error) return "failed";
  return outcome.exitCode === 0 ? "success" : "failed";
}

function terminalResultFromLifecycle(lifecycle: RunLifecycle): RunResult {
  const status =
    lifecycle.status === "timeout" ||
    lifecycle.status === "success" ||
    lifecycle.status === "launch_failed" ||
    lifecycle.status === "orphaned" ||
    lifecycle.status === "stale_recovered"
      ? lifecycle.status
      : "failed";
  return {
    taskId: lifecycle.taskId,
    runId: lifecycle.runId,
    status,
    startedAt: lifecycle.startedAt ?? lifecycle.claimedAt,
    endedAt: lifecycle.endedAt ?? new Date().toISOString(),
    exitCode: lifecycle.exitCode ?? null,
    signal: lifecycle.signal ?? null,
    timedOut: lifecycle.timedOut ?? false,
    ...(lifecycle.sessionFile ? { sessionFile: lifecycle.sessionFile } : {}),
    handoffUpdated: lifecycle.handoffUpdated ?? false,
    ...(lifecycle.error ? { error: lifecycle.error } : {}),
  };
}

async function writeLifecycleAndResult(
  rootDir: string,
  lifecycle: RunLifecycle,
): Promise<void> {
  await writeRunLifecycle(rootDir, lifecycle);
  if (
    [
      "success",
      "failed",
      "timeout",
      "launch_failed",
      "orphaned",
      "stale_recovered",
    ].includes(lifecycle.status)
  ) {
    await writeRunResult(
      join(runDir(rootDir, lifecycle.taskId, lifecycle.runId), "result.json"),
      terminalResultFromLifecycle(lifecycle),
    );
  }
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
  let lifecycle: RunLifecycle = options.lifecycle ?? {
    taskId: task.id,
    runId,
    status: "running",
    claimedAt: startedAt,
  };
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    lifecycle = {
      ...lifecycle,
      status: "running",
      startedAt,
    };
    await writeRunLifecycle(config.rootDir, lifecycle);
    const prompt = await renderPrompt({ rootDir: config.rootDir, task, runId });
    const promptPath = join(dir, "prompt.md");
    await writeFile(promptPath, prompt.prompt, { mode: 0o600 });
    const envFileResult = await loadTaskEnvFiles(task);
    if (envFileResult.issues.length > 0) {
      const failed = {
        ...lifecycle,
        status: "failed" as const,
        endedAt: new Date().toISOString(),
        error: envFileResult.issues
          .map((issue) => `envFiles ${issue.path}: ${issue.message}`)
          .join("\n"),
      };
      await writeLifecycleAndResult(config.rootDir, failed);
      await recordRunState(config.rootDir, terminalResultFromLifecycle(failed));
      return {
        taskId: task.id,
        runId,
        status: "validation_failed",
        message: failed.error ?? "validation failed",
      };
    }
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
    await writeRunLifecycle(config.rootDir, {
      ...lifecycle,
      status: statusFromOutcome(outcome),
      endedAt: result.endedAt,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      ...(result.sessionFile ? { sessionFile: result.sessionFile } : {}),
      handoffUpdated,
      ...(result.error ? { error: result.error } : {}),
    });
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

export async function runClaimedTask(
  config: ScheduledTasksConfig,
  taskId: string,
  runId: string,
): Promise<RunSummary> {
  await ensureRootLayout(config.rootDir);
  const lifecycleResult = await readRunLifecycleStrict(
    config.rootDir,
    taskId,
    runId,
  );
  if (!lifecycleResult.ok)
    return {
      taskId,
      runId,
      status: lifecycleResult.missing ? "not_found" : "corrupt_run_metadata",
      message: lifecycleResult.missing
        ? "Claimed run metadata was not found."
        : lifecycleResult.error,
    };
  const lockMetadata = await readLock(config.rootDir, taskId);
  if (!lockMetadata || lockMetadata.runId !== runId)
    return {
      taskId,
      runId,
      status: "lock_mismatch",
      message: "Task lock does not match the claimed run.",
    };
  const snapshot = await readFile(
    join(runDir(config.rootDir, taskId, runId), "task.md"),
    "utf8",
  ).catch((error) => {
    throw new Error(
      `Unable to read claimed task snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const parsed = parseTaskMarkdown(taskPath(config.rootDir, taskId), snapshot);
  if (!parsed.task || parsed.errors.length > 0)
    return {
      taskId,
      runId,
      status: "validation_failed",
      message: parsed.errors.join("\n") || "Invalid task snapshot.",
    };
  const heldLock = lockFromMetadata(config.rootDir, taskId, lockMetadata);
  return runTask(config, parsed.task, {
    heldLock,
    lifecycle: lifecycleResult.value,
  });
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
const SCHEDULER_LOCK_STALE_MS = 5 * 60_000;
const TASK_LOCK_CUSHION_MS = 5 * 60_000;
const SAME_HOST_DEAD_PID_FLOOR_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 1_000;
const ACTIVE_STATUSES = new Set(["claimed", "launched", "running"]);

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

function taskStaleMs(
  task: TaskDefinition,
  config: ScheduledTasksConfig,
): number {
  return (
    (task.timeoutMinutes ?? config.defaultTimeoutMinutes) * 60_000 +
    TASK_LOCK_CUSHION_MS
  );
}

async function markRecoveredRun(
  config: ScheduledTasksConfig,
  metadata: LockMetadata,
  status: "orphaned" | "stale_recovered",
  reason: string,
): Promise<void> {
  if (!metadata.taskId || !metadata.runId) return;
  const existing = await readRunLifecycleStrict(
    config.rootDir,
    metadata.taskId,
    metadata.runId,
  );
  if (!existing.ok) return;
  if (!ACTIVE_STATUSES.has(existing.value.status)) return;
  await writeLifecycleAndResult(config.rootDir, {
    ...existing.value,
    status,
    endedAt: new Date().toISOString(),
    recoveredAt: new Date().toISOString(),
    error: reason,
  });
}

async function countActiveScheduledRuns(rootDir: string): Promise<number> {
  let count = 0;
  let taskDirs: string[] = [];
  try {
    taskDirs = await readdir(join(rootDir, "runs"));
  } catch {
    return 0;
  }
  for (const taskId of taskDirs) {
    let runIds: string[] = [];
    try {
      runIds = await readdir(join(rootDir, "runs", taskId));
    } catch {
      continue;
    }
    for (const runId of runIds) {
      const lifecycle = await readRunLifecycleStrict(rootDir, taskId, runId);
      if (lifecycle.ok && ACTIVE_STATUSES.has(lifecycle.value.status))
        count += 1;
    }
  }
  return count;
}

async function launchClaimedRunner(options: {
  config: ScheduledTasksConfig;
  taskId: string;
  runId: string;
}): Promise<{ ok: true; pid?: number } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: { ok: true; pid?: number } | { ok: false; error: string },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({ ok: false, error: "Timed out waiting for runner launch." }),
      LAUNCH_TIMEOUT_MS,
    );
    let child: ReturnType<typeof _spawn.fn>;
    try {
      child = _spawn.fn(
        options.config.piCommand,
        [
          "--mode",
          "json",
          "--no-session",
          "-p",
          `/scheduled-tasks-run-claimed ${options.taskId} ${options.runId}`,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SCHEDULED_TASKS_ROOT_DIR: options.config.rootDir,
          },
          detached: true,
          stdio: "ignore",
        } as SpawnOptions,
      );
    } catch (error) {
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    child.once("error", (error) =>
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    child.once("spawn", () => {
      child.unref?.();
      finish({ ok: true, pid: child.pid });
    });
    process.nextTick(() => {
      if (!settled) {
        child.unref?.();
        finish({ ok: true, pid: child.pid });
      }
    });
  });
}

async function claimAndLaunch(options: {
  config: ScheduledTasksConfig;
  task: TaskDefinition;
  rawTask: string;
  state: Awaited<ReturnType<typeof readTaskState>>;
  nextRunAt: string;
  now: Date;
}): Promise<RunSummary> {
  const { config, task, rawTask, state, nextRunAt, now } = options;
  const runId = makeRunId(now);
  const lock = await acquireLock(
    config.rootDir,
    task.id,
    { taskId: task.id, runId },
    {
      staleAfterMs: taskStaleMs(task, config),
      sameHostDeadPidAfterMs: SAME_HOST_DEAD_PID_FLOOR_MS,
      onRecover: (metadata, reason) =>
        markRecoveredRun(config, metadata, "stale_recovered", reason),
    },
  );
  if (!lock)
    return {
      taskId: task.id,
      status: "locked",
      message: "Task is already running; nextRunAt was not advanced.",
    };
  const dir = runDir(config.rootDir, task.id, runId);
  const claimedAt = new Date().toISOString();
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, "task.md"), rawTask, { mode: 0o600 });
    await writeRunLifecycle(config.rootDir, {
      taskId: task.id,
      runId,
      status: "claimed",
      claimedAt,
    });
    await writeTaskState(config.rootDir, {
      ...(state ?? { taskId: task.id }),
      nextRunAt,
      lastSkipReason: null,
    });
    const launch = await launchClaimedRunner({
      config,
      taskId: task.id,
      runId,
    });
    if (!launch.ok) {
      const lifecycle: RunLifecycle = {
        taskId: task.id,
        runId,
        status: "launch_failed",
        claimedAt,
        endedAt: new Date().toISOString(),
        error: launch.error,
      };
      await writeLifecycleAndResult(config.rootDir, lifecycle);
      await recordRunState(
        config.rootDir,
        terminalResultFromLifecycle(lifecycle),
      );
      await lock.release();
      return {
        taskId: task.id,
        runId,
        status: "launch_failed",
        message: launch.error,
        runDir: dir,
      };
    }
    await writeRunLifecycle(config.rootDir, {
      taskId: task.id,
      runId,
      status: "launched",
      claimedAt,
      launchedAt: new Date().toISOString(),
      ...(launch.pid ? { runnerPid: launch.pid } : {}),
    });
    return {
      taskId: task.id,
      runId,
      status: "launched",
      message: `Launched claimed run ${runId}.`,
      runDir: dir,
    };
  } catch (error) {
    await lock.release();
    throw error;
  }
}

export async function schedulerTick(
  config: ScheduledTasksConfig,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<TickSummary> {
  await ensureRootLayout(config.rootDir);
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const schedulerLock = await acquireLock(
    config.rootDir,
    "scheduler",
    {},
    {
      staleAfterMs: SCHEDULER_LOCK_STALE_MS,
      now,
    },
  );
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
  const maxCatchupRuns = Math.max(
    0,
    Math.floor(config.maxCatchupRunsPerTick ?? 1),
  );
  const maxConcurrent = Math.max(
    1,
    Math.floor(config.maxConcurrentScheduledRuns ?? 3),
  );
  let catchupRuns = 0;
  let activeRuns = options.dryRun
    ? 0
    : await countActiveScheduledRuns(config.rootDir);
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
      const stateResult = await readTaskStateStrict(config.rootDir, task.id);
      if (!stateResult.ok && !stateResult.missing) {
        skipped.push({
          taskId: task.id,
          status: "corrupt_state",
          message: stateResult.error,
        });
        continue;
      }
      const state = stateResult.ok ? stateResult.value : undefined;
      if (state?.lastRunId) {
        const lifecycle = await readRunLifecycleStrict(
          config.rootDir,
          task.id,
          state.lastRunId,
        );
        if (!lifecycle.ok && !lifecycle.missing) {
          skipped.push({
            taskId: task.id,
            status: "corrupt_run_metadata",
            message: lifecycle.error,
          });
          continue;
        }
      }
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
        continue;
      }
      if (decision.action === "wait") continue;
      if (decision.action === "missed") {
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
        catchupRuns += 1;
      }
      if (options.dryRun) {
        claimed.push({
          taskId: task.id,
          status: decision.action === "missed" ? "would_catchup" : "would_run",
          message:
            decision.action === "missed"
              ? "Dry run: would run one catchup for missed schedule."
              : "Dry run: would run task.",
        });
        continue;
      }
      if (activeRuns >= maxConcurrent) {
        skipped.push({
          taskId: task.id,
          status: "concurrency_deferred",
          message:
            "Deferred because maxConcurrentScheduledRuns was reached; nextRunAt was not advanced.",
        });
        continue;
      }
      const rawTask = await readFile(task.path, "utf8");
      const summary = await claimAndLaunch({
        config,
        task,
        rawTask,
        state,
        nextRunAt: decision.nextRunAt.toISOString(),
        now,
      });
      if (summary.status === "launched") activeRuns += 1;
      if (summary.status === "locked") skipped.push(summary);
      else
        claimed.push(
          decision.action === "missed" && summary.status === "launched"
            ? { ...summary, message: `Launched catchup run ${summary.runId}.` }
            : summary,
        );
    }
  } finally {
    await schedulerLock.release();
  }
  const summary = tickSummary({
    timestamp,
    claimed,
    skipped,
    dryRun: !!options.dryRun,
  });
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

export async function formatTaskRuntimeStatus(
  config: ScheduledTasksConfig,
  taskId: string,
): Promise<string> {
  const state = await readTaskState(config.rootDir, taskId);
  if (!state?.lastRunId) return `runtime ${taskId}: no runs recorded`;
  const lifecycle = await readRunLifecycleStrict(
    config.rootDir,
    taskId,
    state.lastRunId,
  );
  const status = lifecycle.ok
    ? lifecycle.value.status
    : lifecycle.missing
      ? (state.lastStatus ?? "unknown")
      : `run metadata error: ${lifecycle.error}`;
  return `runtime ${taskId}: lastRunId=${state.lastRunId} status=${status}`;
}

export async function readLatestLogs(
  config: ScheduledTasksConfig,
  taskId: string,
): Promise<string> {
  const state = await readTaskState(config.rootDir, taskId);
  if (!state?.lastRunId) return `No runs recorded for ${taskId}.`;
  const dir = runDir(config.rootDir, taskId, state.lastRunId);
  const lifecycle = await readRunLifecycleStrict(
    config.rootDir,
    taskId,
    state.lastRunId,
  );
  const status = lifecycle.ok
    ? lifecycle.value.status
    : lifecycle.missing
      ? (state.lastStatus ?? "unknown")
      : `run metadata error: ${lifecycle.error}`;
  const parts = [
    `Latest run: ${state.lastRunId}`,
    `Status: ${status}`,
    `Artifacts: ${dir}`,
  ];
  for (const file of ["run.json", "result.json", "output.md", "pi.log"]) {
    try {
      const raw =
        file === "result.json" || file === "run.json"
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
