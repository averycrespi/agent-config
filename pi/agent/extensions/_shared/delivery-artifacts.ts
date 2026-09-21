import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const MAX_BYTES = 4 * 1024 * 1024;
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BYTES,
  }).trim();
}
function directory(path: string) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== path ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("Unsafe delivery artifact directory");
  chmodSync(path, 0o700);
}

/** Content-addressed immutable evidence, outside the tracked checkout. No cleanup/replay. */
export function retainDeliveryArtifact(
  cwd: string,
  kind: "review" | "background",
  value: unknown,
) {
  const bytes = JSON.stringify(value);
  if (bytes === undefined || Buffer.byteLength(bytes) > MAX_BYTES)
    throw new Error("Delivery artifact exceeds 4 MiB");
  const common = realpathSync(
    resolve(cwd, git(cwd, "rev-parse", "--git-common-dir")),
  );
  const root = join(common, "pi-delivery-artifacts");
  directory(root);
  const dir = join(root, kind);
  directory(dir);
  const sha256 = digest(bytes);
  const path = join(dir, `${sha256}.json`);
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (process.getuid && stat.uid !== process.getuid()) ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size !== Buffer.byteLength(bytes) ||
      readFileSync(path, "utf8") !== bytes
    )
      throw new Error("Conflicting delivery artifact");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A unique staging name prevents interrupted writes from looking complete.
    const staging = join(dir, `${randomUUID()}.tmp`);
    writeFileSync(staging, bytes, { flag: "wx", mode: 0o600 });
    renameSync(staging, path);
  }
  return { path, sha256, bytes: Buffer.byteLength(bytes) };
}

/** HEAD plus exact tracked delta. Untracked files must be staged for retained review. */
export function deliveryRevision(cwd: string) {
  if (git(cwd, "ls-files", "--others", "--exclude-standard"))
    throw new Error(
      "Stage intended untracked files before revision-bound review retention",
    );
  const head = git(cwd, "rev-parse", "HEAD");
  const delta = execFileSync(
    "git",
    ["-C", cwd, "diff", "--binary", "--no-ext-diff", "HEAD", "--"],
    { maxBuffer: MAX_BYTES, stdio: ["ignore", "pipe", "pipe"] },
  );
  return { head, deltaSha256: digest(delta) };
}
