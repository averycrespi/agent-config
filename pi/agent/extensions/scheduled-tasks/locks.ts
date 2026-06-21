import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { lockPath } from "./paths.ts";

export interface LockMetadata {
  name: string;
  taskId?: string;
  runId?: string;
  pid: number;
  hostname: string;
  startedAt: string;
}

export interface HeldLock {
  path: string;
  metadata: LockMetadata;
  release: () => Promise<void>;
}

export interface StaleLockPolicy {
  staleAfterMs: number;
  sameHostDeadPidAfterMs?: number;
  now?: Date;
  isPidAlive?: (pid: number) => boolean;
  onRecover?: (metadata: LockMetadata, reason: string) => Promise<void>;
}

function metadataMatches(
  current: LockMetadata | undefined,
  expected: LockMetadata,
): boolean {
  return (
    !!current &&
    current.name === expected.name &&
    current.pid === expected.pid &&
    current.hostname === expected.hostname &&
    current.startedAt === expected.startedAt &&
    current.taskId === expected.taskId &&
    current.runId === expected.runId
  );
}

async function writeLockAtomic(
  rootDir: string,
  name: string,
  metadata: LockMetadata,
): Promise<void> {
  const path = lockPath(rootDir, name);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(tmp, path);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    return code === "EPERM";
  }
}

export async function getLockRecoverReason(
  metadata: LockMetadata | undefined,
  policy: StaleLockPolicy,
): Promise<string | undefined> {
  if (!metadata) return undefined;
  const startedMs = new Date(metadata.startedAt).getTime();
  if (Number.isNaN(startedMs)) return "invalid lock timestamp";
  const ageMs = (policy.now ?? new Date()).getTime() - startedMs;
  if (ageMs >= policy.staleAfterMs) return "lock exceeded stale timeout";
  if (
    metadata.hostname === hostname() &&
    ageMs >= (policy.sameHostDeadPidAfterMs ?? Number.POSITIVE_INFINITY)
  ) {
    const alive = (policy.isPidAlive ?? isProcessAlive)(metadata.pid);
    if (!alive) return "same-host lock pid is not alive";
  }
  return undefined;
}

function heldLock(
  rootDir: string,
  name: string,
  metadata: LockMetadata,
): HeldLock {
  const path = lockPath(rootDir, name);
  return {
    path,
    metadata,
    release: async () => {
      const current = await readLock(rootDir, name);
      if (!metadataMatches(current, metadata)) return;
      try {
        await rm(path);
      } catch {
        // Already removed; conservative no-op.
      }
    },
  };
}

export function lockFromMetadata(
  rootDir: string,
  name: string,
  metadata: LockMetadata,
): HeldLock {
  return heldLock(rootDir, name, metadata);
}

export async function releaseLockIfMatches(
  rootDir: string,
  name: string,
  expected: LockMetadata,
): Promise<boolean> {
  const current = await readLock(rootDir, name);
  if (!metadataMatches(current, expected)) return false;
  await rm(lockPath(rootDir, name)).catch(() => undefined);
  return true;
}

export async function adoptLock(
  rootDir: string,
  name: string,
  expected: LockMetadata,
): Promise<HeldLock | undefined> {
  const current = await readLock(rootDir, name);
  if (!metadataMatches(current, expected)) return undefined;
  const metadata: LockMetadata = {
    ...expected,
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  };
  await writeLockAtomic(rootDir, name, metadata);
  const adopted = await readLock(rootDir, name);
  if (!metadataMatches(adopted, metadata)) return undefined;
  return heldLock(rootDir, name, metadata);
}

export async function recoverLockIfStale(
  rootDir: string,
  name: string,
  stalePolicy: StaleLockPolicy,
): Promise<boolean> {
  const existing = await readLock(rootDir, name);
  const recoverReason = await getLockRecoverReason(existing, stalePolicy);
  if (!existing || !recoverReason) return false;
  await stalePolicy.onRecover?.(existing, recoverReason);
  return releaseLockIfMatches(rootDir, name, existing);
}

export async function acquireLock(
  rootDir: string,
  name: string,
  extra: Partial<LockMetadata> = {},
  stalePolicy?: StaleLockPolicy,
): Promise<HeldLock | undefined> {
  const path = lockPath(rootDir, name);
  const metadata: LockMetadata = {
    name,
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    ...extra,
  };
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();
    return heldLock(rootDir, name, metadata);
  } catch {
    if (!stalePolicy) return undefined;
    const recovered = await recoverLockIfStale(rootDir, name, stalePolicy);
    if (!recovered) return undefined;
    return acquireLock(rootDir, name, extra);
  }
}

export async function readLock(
  rootDir: string,
  name: string,
): Promise<LockMetadata | undefined> {
  try {
    const raw = JSON.parse(await readFile(lockPath(rootDir, name), "utf8"));
    return raw && typeof raw === "object" ? (raw as LockMetadata) : undefined;
  } catch {
    return undefined;
  }
}
