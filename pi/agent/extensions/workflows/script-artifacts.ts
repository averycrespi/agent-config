import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const WORKFLOW_SCRIPTS_DIR = join(tmpdir(), "pi-workflow-scripts");
export const WORKFLOW_SCRIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const _artifactNonce = {
  fn: () => randomBytes(8).toString("hex"),
};

function safePart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || "workflow").slice(0, 32);
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
      "workflow scripts directory is not an owner-controlled directory",
    );
  }
  await chmod(dir, 0o700);
}

export async function cleanupOldWorkflowScripts(
  dir: string = WORKFLOW_SCRIPTS_DIR,
  maxAgeMs: number = WORKFLOW_SCRIPT_RETENTION_MS,
  now: number = Date.now(),
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.name.endsWith(".js") && !entry.isSymbolicLink())
      .map(async (entry) => {
        const path = join(dir, entry.name);
        try {
          const info = await lstat(path);
          if (info.isFile() && now - info.mtimeMs > maxAgeMs) await rm(path);
        } catch {
          // Best-effort retention cleanup must not block a new artifact.
        }
      }),
  );
}

export async function persistWorkflowScript(
  source: string,
  toolCallId: string,
  workflowName: string,
  dir: string = WORKFLOW_SCRIPTS_DIR,
): Promise<string> {
  await ensureOwnerDirectory(dir);
  await cleanupOldWorkflowScripts(dir);
  const prefix = `${safePart(workflowName)}-${safePart(toolCallId)}`;
  for (let attempt = 0; attempt < 101; attempt += 1) {
    const nonce = _artifactNonce.fn();
    const path = join(dir, `${prefix}-${nonce}.js`);
    try {
      await writeFile(path, source, { flag: "wx", mode: 0o600 });
      await chmod(path, 0o600);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("unable to create an exclusive workflow script artifact");
}
