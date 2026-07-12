import { constants, type Dirent } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { parseWorkflowScript } from "./parser.ts";
import type { ParsedWorkflow } from "./types.ts";

export const SAVED_WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_WORKFLOW_FILE_BYTES = 256 * 1024;
export const MAX_INVENTORY_ENTRIES = 200;
export const MAX_INVENTORY_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_INVENTORY_TEXT_BYTES = 32 * 1024;
const MAX_DESCRIPTION_CHARS = 240;
const MAX_DIAGNOSTIC_CHARS = 320;

export const _storeHooks: {
  beforeReadCandidate: (root: string, filename: string) => void | Promise<void>;
} = {
  beforeReadCandidate: () => {},
};

export interface WorkflowInventoryEntry {
  filename: string;
  name?: string;
  description?: string;
  valid: boolean;
  diagnostic?: string;
  sourcePath: string;
}

export interface WorkflowInventory {
  storeDir: string;
  entries: WorkflowInventoryEntry[];
  truncated?: string;
}

export interface SavedWorkflow {
  parsed: ParsedWorkflow;
  sourcePath: string;
}

function cleanLine(value: string, maxChars: number): string {
  const clean = stripVTControlCharacters(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
}

function errorMessage(error: unknown): string {
  return cleanLine(
    error instanceof Error ? error.message : String(error),
    MAX_DIAGNOSTIC_CHARS,
  );
}

function nameDiagnostic(name: string): string | undefined {
  if (SAVED_WORKFLOW_NAME_PATTERN.test(name)) return undefined;
  return "Saved workflow names must be lowercase kebab-case matching ^[a-z0-9][a-z0-9-]{0,63}$.";
}

async function resolveRoot(
  configuredDir: string,
): Promise<{ configured: string; resolved?: string }> {
  const configured = resolve(configuredDir);
  try {
    const resolved = await realpath(configured);
    const info = await lstat(resolved);
    if (!info.isDirectory())
      throw new Error(`Saved workflow store is not a directory: ${configured}`);
    return { configured, resolved };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { configured };
    throw error;
  }
}

function contained(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part === "" ||
    (!part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part))
  );
}

async function openedPath(fd: number): Promise<string> {
  let lastError: unknown;
  for (const path of [`/proc/self/fd/${fd}`, `/dev/fd/${fd}`]) {
    try {
      return await realpath(path);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Unable to verify opened workflow path.");
}

async function readCandidate(
  root: string,
  filename: string,
): Promise<{ source?: string; diagnostic?: string; bytes?: number }> {
  const path = join(root, filename);
  if (!contained(root, path) || basename(path) !== filename)
    return { diagnostic: "Workflow path escapes the configured store." };
  try {
    await _storeHooks.beforeReadCandidate(root, filename);
    const handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const actualPath = await openedPath(handle.fd);
      if (!contained(root, actualPath))
        return { diagnostic: "Workflow path escapes the configured store." };
      const info = await handle.stat();
      if (!info.isFile())
        return { diagnostic: "Saved workflow entry is not a regular file." };
      if (info.size > MAX_WORKFLOW_FILE_BYTES)
        return {
          diagnostic: `Saved workflow exceeds the 256 KiB file limit.`,
          bytes: info.size,
        };
      const buffer = Buffer.allocUnsafe(MAX_WORKFLOW_FILE_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const read = await handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          null,
        );
        if (read.bytesRead === 0) break;
        bytesRead += read.bytesRead;
      }
      if (bytesRead > MAX_WORKFLOW_FILE_BYTES)
        return {
          diagnostic: `Saved workflow exceeds the 256 KiB file limit.`,
          bytes: bytesRead,
        };
      return {
        source: buffer.subarray(0, bytesRead).toString("utf8"),
        bytes: bytesRead,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      diagnostic:
        code === "ELOOP"
          ? "Saved workflow entries may not be symbolic links."
          : `Unable to read saved workflow: ${errorMessage(error)}`,
    };
  }
}

function validateSource(
  filename: string,
  sourcePath: string,
  source: string,
): WorkflowInventoryEntry & { parsed?: ParsedWorkflow } {
  const stem = filename.slice(0, -3);
  const invalidName = nameDiagnostic(stem);
  if (invalidName)
    return {
      filename,
      name: stem,
      valid: false,
      diagnostic: invalidName,
      sourcePath,
    };
  try {
    const parsed = parseWorkflowScript(source);
    if (
      parsed.literalMeta.name !== parsed.meta.name ||
      nameDiagnostic(parsed.literalMeta.name)
    ) {
      return {
        filename,
        name: stem,
        valid: false,
        diagnostic:
          "The literal meta.name must match the saved-workflow naming rule without surrounding whitespace.",
        sourcePath,
      };
    }
    if (parsed.meta.name !== stem) {
      return {
        filename,
        name: stem,
        valid: false,
        diagnostic: `Filename stem ${JSON.stringify(stem)} does not match meta.name ${JSON.stringify(parsed.meta.name)}.`,
        sourcePath,
      };
    }
    return {
      filename,
      name: stem,
      description: cleanLine(parsed.meta.description, MAX_DESCRIPTION_CHARS),
      valid: true,
      sourcePath,
      parsed,
    };
  } catch (error) {
    return {
      filename,
      name: stem,
      valid: false,
      diagnostic: errorMessage(error),
      sourcePath,
    };
  }
}

function retainSortedCandidate(dirents: Dirent[], candidate: Dirent): void {
  let low = 0;
  let high = dirents.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dirents[middle]!.name.localeCompare(candidate.name) < 0)
      low = middle + 1;
    else high = middle;
  }
  if (low >= MAX_INVENTORY_ENTRIES) return;
  dirents.splice(low, 0, candidate);
  if (dirents.length > MAX_INVENTORY_ENTRIES) dirents.pop();
}

export async function inventoryWorkflows(
  configuredDir: string,
): Promise<WorkflowInventory> {
  const root = await resolveRoot(configuredDir);
  if (!root.resolved) return { storeDir: root.configured, entries: [] };

  const dirents: Dirent[] = [];
  let candidateCount = 0;
  let truncated: string | undefined;
  const dir = await opendir(root.resolved);
  for await (const dirent of dir) {
    if (!dirent.name.endsWith(".js") || dirent.isDirectory()) continue;
    candidateCount += 1;
    retainSortedCandidate(dirents, dirent);
  }
  if (candidateCount > MAX_INVENTORY_ENTRIES)
    truncated = `Inventory truncated at the ${MAX_INVENTORY_ENTRIES}-entry limit.`;

  const entries: WorkflowInventoryEntry[] = [];
  let aggregateBytes = 0;
  for (const dirent of dirents) {
    const sourcePath = join(root.resolved, dirent.name);
    const read = await readCandidate(root.resolved, dirent.name);
    if (
      read.source !== undefined &&
      aggregateBytes + (read.bytes ?? 0) > MAX_INVENTORY_SOURCE_BYTES
    ) {
      truncated = `Inventory truncated at the 2 MiB aggregate source limit.`;
      break;
    }
    aggregateBytes += read.source === undefined ? 0 : (read.bytes ?? 0);
    if (read.source === undefined) {
      entries.push({
        filename: dirent.name,
        name: dirent.name.slice(0, -3),
        valid: false,
        diagnostic: read.diagnostic ?? "Unable to read saved workflow.",
        sourcePath,
      });
    } else {
      const { parsed: _parsed, ...entry } = validateSource(
        dirent.name,
        sourcePath,
        read.source,
      );
      entries.push(entry);
    }
  }
  return {
    storeDir: root.resolved,
    entries,
    ...(truncated ? { truncated } : {}),
  };
}

export async function resolveSavedWorkflow(
  configuredDir: string,
  name: string,
): Promise<SavedWorkflow> {
  const invalidName = nameDiagnostic(name);
  if (invalidName) throw new Error(invalidName);
  const root = await resolveRoot(configuredDir);
  if (!root.resolved)
    throw new Error(
      `Unknown saved workflow ${JSON.stringify(name)}. Available valid workflows: (none).`,
    );

  const filename = `${name}.js`;
  const sourcePath = join(root.resolved, filename);
  const read = await readCandidate(root.resolved, filename);
  if (read.source === undefined) {
    if ((read.diagnostic ?? "").includes("ENOENT")) {
      const inventory = await inventoryWorkflows(root.resolved);
      const available =
        inventory.entries
          .filter((entry) => entry.valid)
          .map((entry) => entry.name)
          .join(", ") || "(none)";
      throw new Error(
        `Unknown saved workflow ${JSON.stringify(name)}. Available valid workflows: ${available}.${inventory.truncated ? ` ${inventory.truncated}` : ""}`,
      );
    }
    throw new Error(
      `Saved workflow ${JSON.stringify(name)} is invalid: ${read.diagnostic}`,
    );
  }
  const validated = validateSource(filename, sourcePath, read.source);
  if (!validated.valid || !validated.parsed)
    throw new Error(
      `Saved workflow ${JSON.stringify(name)} is invalid: ${validated.diagnostic}`,
    );
  return { parsed: validated.parsed, sourcePath };
}

function utf8Prefix(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

export function formatWorkflowInventory(
  inventory: WorkflowInventory,
  maxBytes = MAX_INVENTORY_TEXT_BYTES,
): {
  text: string;
  truncated: boolean;
  details: WorkflowInventory;
} {
  const lines = [
    `Saved workflows: ${cleanLine(inventory.storeDir, MAX_INVENTORY_TEXT_BYTES)}`,
    ...inventory.entries.map((entry) => JSON.stringify(entry)),
    ...(inventory.truncated ? [`[truncated] ${inventory.truncated}`] : []),
  ];
  const full = lines.join("\n");
  if (Buffer.byteLength(full, "utf8") <= maxBytes) {
    return {
      text: full,
      truncated: Boolean(inventory.truncated),
      details: inventory,
    };
  }
  const marker = "\n[truncated] Formatted inventory reached the output limit.";
  return {
    text:
      utf8Prefix(
        full,
        Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8")),
      ) + marker,
    truncated: true,
    details: {
      ...inventory,
      truncated:
        inventory.truncated ?? "Formatted inventory reached the output limit.",
    },
  };
}
