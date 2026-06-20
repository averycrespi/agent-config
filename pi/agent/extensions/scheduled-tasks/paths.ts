import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const ROOT_SUBDIRS = [
  "tasks",
  "handoffs",
  "state",
  "sessions",
  "runs",
  "locks",
] as const;

export type RootSubdir = (typeof ROOT_SUBDIRS)[number];

export interface RootPaths {
  root: string;
  tasks: string;
  handoffs: string;
  state: string;
  sessions: string;
  runs: string;
  locks: string;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function resolveRoot(rootDir: string): string {
  return resolve(expandHome(rootDir));
}

export function getRootPaths(rootDir: string): RootPaths {
  const root = resolveRoot(rootDir);
  return {
    root,
    tasks: join(root, "tasks"),
    handoffs: join(root, "handoffs"),
    state: join(root, "state"),
    sessions: join(root, "sessions"),
    runs: join(root, "runs"),
    locks: join(root, "locks"),
  };
}

export async function ensureRootLayout(rootDir: string): Promise<RootPaths> {
  const paths = getRootPaths(rootDir);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  for (const subdir of ROOT_SUBDIRS) {
    await mkdir(paths[subdir], { recursive: true, mode: 0o700 });
  }
  return paths;
}

export function isSafeTaskId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

export function assertSafeTaskId(taskId: string): void {
  if (!isSafeTaskId(taskId)) {
    throw new Error(
      `Invalid task ID ${JSON.stringify(taskId)}. Use letters, numbers, underscores, or hyphens; no slashes or dots.`,
    );
  }
}

export function taskPath(rootDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return join(getRootPaths(rootDir).tasks, `${taskId}.md`);
}

export function handoffPath(rootDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return join(getRootPaths(rootDir).handoffs, `${taskId}.md`);
}

export function statePath(rootDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return join(getRootPaths(rootDir).state, `${taskId}.json`);
}

export function tickLogPath(rootDir: string): string {
  return join(getRootPaths(rootDir).state, "ticks.jsonl");
}

export function taskSessionDir(rootDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return join(getRootPaths(rootDir).sessions, taskId);
}

export function taskRunsDir(rootDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return join(getRootPaths(rootDir).runs, taskId);
}

export function runDir(rootDir: string, taskId: string, runId: string): string {
  assertSafeTaskId(taskId);
  if (!/^[a-zA-Z0-9T_.:-]+$/.test(runId)) throw new Error("Invalid run ID.");
  return join(taskRunsDir(rootDir, taskId), runId);
}

export function lockPath(rootDir: string, name: string): string {
  if (name !== "scheduler" && !isSafeTaskId(name))
    throw new Error("Invalid lock name.");
  return join(getRootPaths(rootDir).locks, `${name}.lock`);
}

export function isInside(parent: string, child: string): boolean {
  const parentResolved = resolve(parent);
  const childResolved = resolve(child);
  return (
    childResolved === parentResolved ||
    childResolved.startsWith(`${parentResolved}/`)
  );
}

export function validateAbsoluteExistingDirInput(
  path: unknown,
): string | undefined {
  return typeof path === "string" && isAbsolute(path) ? path : undefined;
}
