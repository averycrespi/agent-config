import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { runDir, statePath } from "./paths.ts";

export interface TaskState {
  taskId: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastRunId?: string;
  lastSkipReason?: string | null;
}

export interface RunResult {
  taskId: string;
  runId: string;
  status:
    | "success"
    | "failed"
    | "timeout"
    | "skipped"
    | "launch_failed"
    | "orphaned"
    | "stale_recovered";
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  sessionFile?: string;
  handoffUpdated: boolean;
  error?: string;
}

export type RunLifecycleStatus =
  | "claimed"
  | "launched"
  | "running"
  | "success"
  | "failed"
  | "timeout"
  | "launch_failed"
  | "orphaned"
  | "stale_recovered";

export interface RunLifecycle {
  taskId: string;
  runId: string;
  status: RunLifecycleStatus;
  claimedAt: string;
  launchedAt?: string;
  startedAt?: string;
  endedAt?: string;
  runnerPid?: number;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  sessionFile?: string;
  handoffUpdated?: boolean;
  error?: string;
  recoveredAt?: string;
}

export type JsonReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: string };

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

function parseTaskState(raw: unknown, taskId: string): TaskState | undefined {
  if (!raw || typeof raw !== "object" || (raw as TaskState).taskId !== taskId)
    return undefined;
  return raw as TaskState;
}

export async function readTaskStateStrict(
  rootDir: string,
  taskId: string,
): Promise<JsonReadResult<TaskState>> {
  try {
    const parsed = JSON.parse(
      await readFile(statePath(rootDir, taskId), "utf8"),
    );
    const state = parseTaskState(parsed, taskId);
    return state
      ? { ok: true, value: state }
      : { ok: false, missing: false, error: "Task state metadata is invalid." };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") return { ok: false, missing: true };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, missing: false, error: message };
  }
}

export async function readTaskState(
  rootDir: string,
  taskId: string,
): Promise<TaskState | undefined> {
  const result = await readTaskStateStrict(rootDir, taskId);
  return result.ok ? result.value : undefined;
}

export async function writeTaskState(
  rootDir: string,
  state: TaskState,
): Promise<void> {
  await writeJsonAtomic(statePath(rootDir, state.taskId), state);
}

export function runLifecyclePath(
  rootDir: string,
  taskId: string,
  runId: string,
): string {
  return join(runDir(rootDir, taskId, runId), "run.json");
}

export async function readRunLifecycleStrict(
  rootDir: string,
  taskId: string,
  runId: string,
): Promise<JsonReadResult<RunLifecycle>> {
  try {
    const parsed = JSON.parse(
      await readFile(runLifecyclePath(rootDir, taskId, runId), "utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as RunLifecycle).taskId !== taskId ||
      (parsed as RunLifecycle).runId !== runId ||
      typeof (parsed as RunLifecycle).status !== "string"
    )
      return {
        ok: false,
        missing: false,
        error: "Run lifecycle metadata is invalid.",
      };
    return { ok: true, value: parsed as RunLifecycle };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") return { ok: false, missing: true };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, missing: false, error: message };
  }
}

export async function readRunLifecycle(
  rootDir: string,
  taskId: string,
  runId: string,
): Promise<RunLifecycle | undefined> {
  const result = await readRunLifecycleStrict(rootDir, taskId, runId);
  return result.ok ? result.value : undefined;
}

export async function writeRunLifecycle(
  rootDir: string,
  lifecycle: RunLifecycle,
): Promise<void> {
  await writeJsonAtomic(
    runLifecyclePath(rootDir, lifecycle.taskId, lifecycle.runId),
    lifecycle,
  );
}

export async function recordRunState(
  rootDir: string,
  result: RunResult,
): Promise<void> {
  const priorResult = await readTaskStateStrict(rootDir, result.taskId);
  if (!priorResult.ok && !priorResult.missing) return;
  const prior = priorResult.ok ? priorResult.value : { taskId: result.taskId };
  await writeTaskState(rootDir, {
    ...prior,
    lastRunAt: result.startedAt,
    lastStatus: result.status,
    lastRunId: result.runId,
    lastSkipReason:
      result.status === "skipped" ? (result.error ?? "skipped") : null,
  });
}

export function makeRunId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:]/g, "-");
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${suffix}`;
}

export async function writeRunResult(
  path: string,
  result: RunResult,
): Promise<void> {
  await writeJsonAtomic(path, result);
}
