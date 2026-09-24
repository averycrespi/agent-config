import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import {
  parseDefinition,
  SAVED_NAME,
  MAX_DEFINITION_BYTES,
} from "./definition.ts";

const MAX_ENTRIES = 200;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 24000;
export const _storeHooks = { beforeOpen: async (_path: string) => {} };
const contained = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
};
async function rootPath(directory: string) {
  try {
    const root = await realpath(resolve(directory));
    if (!(await lstat(root)).isDirectory())
      throw new Error("invalid_script_store");
    return root;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("invalid_script_store");
  }
}
async function readDefinition(root: string, filename: string) {
  const path = join(root, filename);
  await _storeHooks.beforeOpen(path);
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let actual: string | undefined;
    for (const prefix of ["/proc/self/fd", "/dev/fd"]) {
      try {
        actual = await realpath(join(prefix, String(handle.fd)));
        break;
      } catch {
        /* Try the platform's other descriptor path. */
      }
    }
    if (!actual || !contained(root, actual))
      throw new Error("unsafe_script_path");
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("nonregular_definition");
    if (stat.size > MAX_DEFINITION_BYTES)
      throw new Error("definition_too_large");
    const buffer = Buffer.alloc(MAX_DEFINITION_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > MAX_DEFINITION_BYTES) throw new Error("definition_too_large");
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, size),
      );
    } catch {
      throw new Error("invalid_definition_encoding");
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code)
      throw new Error(
        code === "ELOOP" ? "symlink_definition" : "unreadable_definition",
      );
    throw error;
  } finally {
    await handle?.close();
  }
}
function parseNamed(source: string, name: string) {
  if (!SAVED_NAME.test(name)) throw new Error("invalid_saved_name");
  const definition = parseDefinition(source);
  if (definition.meta.name !== name)
    throw new Error("definition_name_mismatch");
  return definition;
}
export async function loadDefinition(directory: string, name: string) {
  if (typeof name !== "string" || !SAVED_NAME.test(name))
    throw new Error("invalid_saved_name");
  const root = await rootPath(directory);
  if (!root) throw new Error("unknown_saved_script");
  return parseNamed(await readDefinition(root, `${name}.js`), name);
}
export async function inventoryScripts(directory: string) {
  const entries: Array<Record<string, unknown>> = [];
  const root = await rootPath(directory);
  if (!root) return { entries, truncated: false };
  const candidates: string[] = [];
  let truncated = false;
  for await (const entry of await opendir(root)) {
    if (!entry.name.endsWith(".js")) continue;
    candidates.push(entry.name);
    candidates.sort();
    if (candidates.length > MAX_ENTRIES) {
      candidates.pop();
      truncated = true;
    }
  }
  let sourceBytes = 0;
  let textBytes = 64;
  for (const filename of candidates) {
    let entry: Record<string, unknown>;
    try {
      const source = await readDefinition(root, filename);
      sourceBytes += Buffer.byteLength(source);
      if (sourceBytes > MAX_SOURCE_BYTES) {
        truncated = true;
        break;
      }
      const definition = parseNamed(source, filename.slice(0, -3));
      entry = {
        filename,
        valid: true,
        ...definition.meta,
        digest: definition.digest,
      };
    } catch (error) {
      entry = {
        filename,
        valid: false,
        diagnostic:
          error instanceof Error ? error.message : "invalid_definition",
      };
    }
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (textBytes + size > MAX_TEXT_BYTES) {
      truncated = true;
      break;
    }
    textBytes += size;
    entries.push(entry);
  }
  return { entries, truncated };
}
