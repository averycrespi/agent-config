import {
  createWriteStream,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const _loggingFs = {
  createWriteStream,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  tmpdir,
  unlinkSync,
  now: Date.now,
};

export interface ManagedLoggerOptions {
  extensionName: string;
  id?: string;
}

const LOG_ROOT = "pi-extension-logs";
const DEFAULT_ID = "session";
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const cleanedDirs = new Set<string>();

function sanitizeLogPart(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_:-]/g, "_");
  return sanitized || "log";
}

function createUniqueStream(
  dir: string,
  id: string,
): { path: string; stream: WriteStream } {
  const candidates = [
    `${id}.log`,
    `${id}-${_loggingFs.now()}.log`,
    `${id}-${_loggingFs.now()}-${process.pid}.log`,
  ];

  for (const name of candidates) {
    const path = join(dir, name);
    try {
      const fd = _loggingFs.openSync(path, "wx", 0o600);
      return {
        path,
        stream: _loggingFs.createWriteStream(path, { fd }),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") throw error;
    }
  }

  for (let i = 1; i <= 100; i += 1) {
    const path = join(dir, `${id}-${_loggingFs.now()}-${process.pid}-${i}.log`);
    try {
      const fd = _loggingFs.openSync(path, "wx", 0o600);
      return {
        path,
        stream: _loggingFs.createWriteStream(path, { fd }),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") throw error;
    }
  }

  throw new Error(`Could not create unique log file for ${id}`);
}

export class ManagedLogger {
  readonly path: string;
  private readonly stream: WriteStream;
  private closePromise: Promise<void> | undefined;

  constructor(path: string, stream: WriteStream) {
    this.path = path;
    this.stream = stream;
  }

  write(text: string | Buffer): void {
    this.stream.write(text);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = new Promise((resolve) => {
      this.stream.end(resolve);
    });
    return this.closePromise;
  }

  delete(): void {
    try {
      _loggingFs.unlinkSync(this.path);
    } catch {
      // best-effort
    }
  }
}

export function cleanupOldLogFiles(
  dir: string,
  maxAgeMs: number = DEFAULT_RETENTION_MS,
): void {
  let entries: string[];
  try {
    entries = _loggingFs.readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".log")) continue;
    const path = join(dir, entry);
    try {
      const info = _loggingFs.statSync(path);
      if (info.isFile() && _loggingFs.now() - info.mtimeMs > maxAgeMs) {
        _loggingFs.unlinkSync(path);
      }
    } catch {
      // best-effort cleanup
    }
  }
}

export function createManagedLogger(
  options: ManagedLoggerOptions,
): ManagedLogger {
  const extensionName = sanitizeLogPart(options.extensionName);
  const id = sanitizeLogPart(options.id ?? DEFAULT_ID);
  const dir = join(_loggingFs.tmpdir(), LOG_ROOT, extensionName);
  _loggingFs.mkdirSync(dir, { recursive: true });
  if (!cleanedDirs.has(dir)) {
    cleanedDirs.add(dir);
    cleanupOldLogFiles(dir);
  }
  const { path, stream } = createUniqueStream(dir, id);
  return new ManagedLogger(path, stream);
}
