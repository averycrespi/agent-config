import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, type Gzip } from "node:zlib";

export const RETAINED_ARTIFACTS_DIR = join(tmpdir(), "pi-retained-diagnostics");
export const LEGACY_SUBAGENT_LOG_DIR = join(
  tmpdir(),
  "pi-extension-logs",
  "subagents",
);
export const RETAINED_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RETAINED_ARTIFACT_QUOTA_BYTES = 1024 * 1024 * 1024;
const LOCK_NAME = ".retention.lock";
const RECLAIM_NAME = ".retention-reclaim";
const MAX_COLLISION_ATTEMPTS = 100;
const MAX_LOCK_ATTEMPTS = 20;

export type RetainedArtifactKind = "subagent-log" | "workflow-recovery";

export interface RetainedArtifactResult {
  retained: boolean;
  path?: string;
  warning?: string;
}

export interface RetainedArtifactOptions {
  kind: RetainedArtifactKind;
  id: string;
  dir?: string;
  now?: number;
  quotaBytes?: number;
}

export interface RetainedArtifactWriter {
  write(chunk: string | Buffer): boolean;
  onDrain(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
  finalize(): Promise<RetainedArtifactResult>;
  discard(): Promise<void>;
}

interface InternalOptions {
  dir: string;
  now: number;
  quotaBytes: number;
}

interface FinalizedFile {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export const _retainedArtifacts = {
  root: () => RETAINED_ARTIFACTS_DIR,
  legacyRoot: () => LEGACY_SUBAGENT_LOG_DIR,
  nonce: () => randomBytes(10).toString("hex"),
  evict: unlink,
  publish: link,
  processAlive: (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
};

function safePart(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return safe || "artifact";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistenceWarning(message: string): string {
  return `Diagnostic persistence failed: ${message}`.slice(0, 500);
}

function quotaWarning(): string {
  return "Diagnostics exceeded retention quota; the new artifact was discarded.";
}

async function ensureOwnerDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  const uid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (uid !== undefined && info.uid !== uid)
  ) {
    throw new Error(
      "retained diagnostics root is not an owner-controlled directory",
    );
  }
  await chmod(dir, 0o700);
}

async function cleanupLegacySubagentLogs(now: number): Promise<void> {
  const dir = _retainedArtifacts.legacyRoot();
  try {
    const root = await lstat(dir);
    const uid =
      typeof process.getuid === "function" ? process.getuid() : undefined;
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      (uid !== undefined && root.uid !== uid)
    ) {
      return;
    }
    const entries = await opendir(dir);
    for await (const entry of entries) {
      if (
        !/^[a-zA-Z0-9_.:+-]+\.log$/.test(entry.name) ||
        entry.isSymbolicLink()
      ) {
        continue;
      }
      const path = join(dir, entry.name);
      try {
        const info = await lstat(path);
        if (
          info.isFile() &&
          !info.isSymbolicLink() &&
          now - info.mtimeMs > RETAINED_ARTIFACT_MAX_AGE_MS
        ) {
          await unlink(path);
        }
      } catch {
        // Legacy migration cleanup is best-effort and outside the new quota.
      }
    }
  } catch {
    // Missing or unsafe legacy storage must not affect current diagnostics.
  }
}

function finalName(
  kind: RetainedArtifactKind,
  id: string,
  nonce: string,
): string {
  return kind === "subagent-log"
    ? `subagent-${safePart(id)}-${nonce}.log.gz`
    : `workflow-${safePart(id)}-${nonce}.json.gz`;
}

function isFinalizedName(name: string): boolean {
  return (
    /^subagent-[a-z0-9_-]+-[a-f0-9]+\.log\.gz$/.test(name) ||
    /^workflow-[a-z0-9_-]+-[a-f0-9]+\.json\.gz$/.test(name)
  );
}

async function listFinalized(dir: string): Promise<FinalizedFile[]> {
  const files: FinalizedFile[] = [];
  const entries = await opendir(dir);
  for await (const entry of entries) {
    if (!isFinalizedName(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      files.push({
        name: entry.name,
        path,
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}

async function cleanupStaleStaging(dir: string, now: number): Promise<void> {
  const entries = await opendir(dir);
  for await (const entry of entries) {
    const match = /^\.(?:stage|lock-owner)-(\d+)-[a-f0-9]+\.tmp$/.exec(
      entry.name,
    );
    if (!match || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    try {
      const info = await lstat(path);
      const uid =
        typeof process.getuid === "function" ? process.getuid() : undefined;
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (uid !== undefined && info.uid !== uid) ||
        now - info.mtimeMs <= RETAINED_ARTIFACT_MAX_AGE_MS
      ) {
        continue;
      }
      const pid = Number(match[1]);
      if (!_retainedArtifacts.processAlive(pid)) await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function readLock(
  lockPath: string,
): Promise<{ pid: number; token?: string } | undefined> {
  let info;
  try {
    info = await lstat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const uid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (uid !== undefined && info.uid !== uid)
  ) {
    throw new Error("retention lock is not an owner-controlled regular file");
  }
  const value = JSON.parse(await readFile(lockPath, "utf8")) as {
    pid?: unknown;
    token?: unknown;
  };
  return Number.isInteger(value.pid) && Number(value.pid) > 0
    ? {
        pid: Number(value.pid),
        ...(typeof value.token === "string" ? { token: value.token } : {}),
      }
    : undefined;
}

async function lockExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function releaseOwnedLock(
  lockPath: string,
  token: string,
): Promise<void> {
  const current = await readLock(lockPath);
  if (current?.token !== token) return;
  await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function reclaimDeadLock(
  lockPath: string,
  reclaimPath: string,
): Promise<boolean> {
  try {
    await link(lockPath, reclaimPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") return false;
    throw error;
  }
  try {
    const captured = await readLock(reclaimPath);
    if (!captured || _retainedArtifacts.processAlive(captured.pid))
      return false;
    const [currentInfo, capturedInfo] = await Promise.all([
      lstat(lockPath).catch(() => undefined),
      lstat(reclaimPath),
    ]);
    if (
      currentInfo &&
      currentInfo.dev === capturedInfo.dev &&
      currentInfo.ino === capturedInfo.ino
    ) {
      await unlink(lockPath);
      return true;
    }
    return false;
  } finally {
    await unlink(reclaimPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function acquireLock(dir: string): Promise<() => Promise<void>> {
  const lockPath = join(dir, LOCK_NAME);
  const reclaimPath = join(dir, RECLAIM_NAME);
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
    if (await lockExists(reclaimPath)) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      continue;
    }
    const token = _retainedArtifacts.nonce();
    const ownerPath = join(dir, `.lock-owner-${process.pid}-${token}.tmp`);
    let handle;
    try {
      handle = await open(
        ownerPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.close();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(ownerPath).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }

    try {
      await link(ownerPath, lockPath);
    } catch (error) {
      await unlink(ownerPath).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (await reclaimDeadLock(lockPath, reclaimPath)) continue;
      } catch {
        throw new Error("retention lock ownership is ambiguous");
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      continue;
    }
    await unlink(ownerPath);
    if (await lockExists(reclaimPath)) {
      await releaseOwnedLock(lockPath, token);
      await new Promise<void>((resolve) => setImmediate(resolve));
      continue;
    }
    return () => releaseOwnedLock(lockPath, token);
  }
  throw new Error("retention lock is busy");
}

async function enforceAndPublish(
  stagingPath: string,
  kind: RetainedArtifactKind,
  id: string,
  options: InternalOptions,
): Promise<RetainedArtifactResult> {
  const staged = await lstat(stagingPath);
  const uid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !staged.isFile() ||
    staged.isSymbolicLink() ||
    (uid !== undefined && staged.uid !== uid)
  ) {
    throw new Error("staging artifact is not an owner-controlled regular file");
  }
  if (staged.size > options.quotaBytes) {
    await rm(stagingPath, { force: true });
    return { retained: false, warning: quotaWarning() };
  }

  const release = await acquireLock(options.dir);
  try {
    await cleanupStaleStaging(options.dir, options.now);
    let files = await listFinalized(options.dir);
    for (const file of files) {
      if (options.now - file.mtimeMs <= RETAINED_ARTIFACT_MAX_AGE_MS) {
        continue;
      }
      try {
        await unlink(file.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error(`unable to remove expired artifact ${file.name}`);
        }
      }
    }

    files = (await listFinalized(options.dir)).sort(
      (a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name),
    );
    let finalizedBytes = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (finalizedBytes + staged.size <= options.quotaBytes) break;
      try {
        await _retainedArtifacts.evict(file.path);
        finalizedBytes -= file.size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          finalizedBytes -= file.size;
          continue;
        }
        await rm(stagingPath, { force: true });
        return { retained: false, warning: quotaWarning() };
      }
    }
    if (finalizedBytes + staged.size > options.quotaBytes) {
      await rm(stagingPath, { force: true });
      return { retained: false, warning: quotaWarning() };
    }

    for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
      const path = join(
        options.dir,
        finalName(kind, id, _retainedArtifacts.nonce()),
      );
      try {
        await _retainedArtifacts.publish(stagingPath, path);
        await chmod(path, 0o600);
        await unlink(stagingPath);
        return { retained: true, path };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error("unable to publish an exclusive retained artifact");
  } finally {
    await release();
  }
}

class ArtifactWriter implements RetainedArtifactWriter {
  private readonly gzip: Gzip;
  private readonly pipelinePromise: Promise<void>;
  private readonly errorListeners = new Set<(error: Error) => void>();
  private streamError: Error | undefined;
  private settled = false;

  constructor(
    private readonly stagingPath: string,
    private readonly kind: RetainedArtifactKind,
    private readonly id: string,
    private readonly options: InternalOptions,
    output: ReturnType<Awaited<ReturnType<typeof open>>["createWriteStream"]>,
  ) {
    this.gzip = createGzip();
    this.gzip.on("error", (error) => this.recordStreamError(error));
    output.on("error", (error) => this.recordStreamError(error));
    this.pipelinePromise = pipeline(this.gzip, output).catch((error) => {
      this.recordStreamError(error as Error);
    });
  }

  private recordStreamError(error: Error): void {
    if (this.streamError) return;
    this.streamError = error;
    for (const listener of this.errorListeners) listener(error);
    this.errorListeners.clear();
  }

  write(chunk: string | Buffer): boolean {
    if (this.settled || this.streamError) return true;
    return this.gzip.write(chunk);
  }

  onDrain(listener: () => void): void {
    this.gzip.once("drain", listener);
  }

  onError(listener: (error: Error) => void): void {
    if (this.streamError) {
      queueMicrotask(() => listener(this.streamError!));
      return;
    }
    this.errorListeners.add(listener);
  }

  async finalize(): Promise<RetainedArtifactResult> {
    if (this.settled) {
      return {
        retained: false,
        warning: persistenceWarning("artifact is already settled"),
      };
    }
    this.settled = true;
    this.gzip.end();
    try {
      await this.pipelinePromise;
      if (this.streamError) throw this.streamError;
      return await enforceAndPublish(
        this.stagingPath,
        this.kind,
        this.id,
        this.options,
      );
    } catch (error) {
      await rm(this.stagingPath, { force: true }).catch(() => undefined);
      return {
        retained: false,
        warning: persistenceWarning(errorText(error)),
      };
    }
  }

  async discard(): Promise<void> {
    if (!this.settled) {
      this.settled = true;
      if (this.streamError) this.gzip.destroy();
      else this.gzip.end();
    }
    await this.pipelinePromise.catch(() => undefined);
    await rm(this.stagingPath, { force: true });
  }
}

export async function createRetainedArtifact(
  options: RetainedArtifactOptions,
): Promise<RetainedArtifactWriter> {
  const dir = options.dir ?? _retainedArtifacts.root();
  await ensureOwnerDirectory(dir);
  await cleanupLegacySubagentLogs(options.now ?? Date.now());
  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const stagingPath = join(
      dir,
      `.stage-${process.pid}-${_retainedArtifacts.nonce()}.tmp`,
    );
    try {
      const handle = await open(
        stagingPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await chmod(stagingPath, 0o600);
      const output = handle.createWriteStream({ autoClose: true });
      return new ArtifactWriter(
        stagingPath,
        options.kind,
        options.id,
        {
          dir,
          now: options.now ?? Date.now(),
          quotaBytes: options.quotaBytes ?? RETAINED_ARTIFACT_QUOTA_BYTES,
        },
        output,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("unable to create an exclusive staging artifact");
}

export async function persistRetainedJson(
  kind: "workflow-recovery",
  id: string,
  value: unknown,
  options: Omit<RetainedArtifactOptions, "kind" | "id"> = {},
): Promise<RetainedArtifactResult> {
  const artifact = await createRetainedArtifact({ kind, id, ...options });
  try {
    artifact.write(JSON.stringify(value));
    return await artifact.finalize();
  } catch (error) {
    await artifact.discard();
    throw error;
  }
}
