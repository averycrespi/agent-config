import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { statePath } from "./paths.ts";

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
  status: "success" | "failed" | "timeout" | "skipped";
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  sessionFile?: string;
  handoffUpdated: boolean;
  error?: string;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readTaskState(
  rootDir: string,
  taskId: string,
): Promise<TaskState | undefined> {
  try {
    const raw = JSON.parse(await readFile(statePath(rootDir, taskId), "utf8"));
    if (!raw || typeof raw !== "object" || raw.taskId !== taskId)
      return undefined;
    return raw as TaskState;
  } catch {
    return undefined;
  }
}

export async function writeTaskState(
  rootDir: string,
  state: TaskState,
): Promise<void> {
  await writeJsonAtomic(statePath(rootDir, state.taskId), state);
}

export async function recordRunState(
  rootDir: string,
  result: RunResult,
): Promise<void> {
  const prior = (await readTaskState(rootDir, result.taskId)) ?? {
    taskId: result.taskId,
  };
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
