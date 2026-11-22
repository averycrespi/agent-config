import { realpath, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/** True when `path` is `root` or lies beneath it. Both must be absolute. */
export function containedPath(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part === "" ||
    (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  );
}

/** Test seam: descriptor-path prefixes tried in order. */
export const _openedFileHooks = {
  descriptorPrefixes: ["/proc/self/fd", "/dev/fd"],
};

/**
 * Verifies that an already-open file lies within `root`, an absolute
 * real path. Returns false rather than throwing when containment cannot be
 * established, so callers fail closed.
 *
 * Linux resolves `/proc/self/fd/N` to the opened file's path, which proves
 * containment directly. macOS has no such mapping (its `/dev/fd/N` resolves
 * to a path inside `/dev/fd`); there, resolve the requested `path` instead
 * and require it to name the same file (device and inode) as the open
 * handle, so a swap between open and check is still detected.
 */
export async function openedFileWithin(
  root: string,
  path: string,
  handle: FileHandle,
): Promise<boolean> {
  const prefixes = _openedFileHooks.descriptorPrefixes;
  for (const prefix of prefixes) {
    const descriptor = join(prefix, String(handle.fd));
    let actual: string;
    try {
      actual = await realpath(descriptor);
    } catch {
      continue;
    }
    // macOS's realpath(3) maps `/dev/fd/N` to `/dev/fd/<basename>`, which is
    // not the file's location. Only a result outside the descriptor
    // directory identifies the opened file.
    if (!containedPath(prefix, actual)) return containedPath(root, actual);
  }
  try {
    const resolved = await realpath(path);
    if (!containedPath(root, resolved)) return false;
    const [opened, current] = await Promise.all([
      handle.stat(),
      stat(resolved),
    ]);
    return opened.dev === current.dev && opened.ino === current.ino;
  } catch {
    return false;
  }
}
