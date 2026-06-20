import { open, readFile, rm } from "node:fs/promises";
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

export async function acquireLock(
  rootDir: string,
  name: string,
  extra: Partial<LockMetadata> = {},
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
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`);
    await handle.close();
  } catch {
    return undefined;
  }
  return {
    path,
    metadata,
    release: async () => {
      try {
        await rm(path);
      } catch {
        // Already removed; conservative no-op.
      }
    },
  };
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
