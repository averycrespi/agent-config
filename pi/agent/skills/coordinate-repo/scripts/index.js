#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const sections = [
  "Owner and authority",
  "Decisions",
  "Assignments",
  "Unresolved control",
  "Observation",
  "Next",
];
export const digest = (text) => createHash("sha256").update(text).digest("hex");
export function renderIndex(id, values) {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    !values ||
    Object.keys(values).some((k) => !sections.includes(k)) ||
    !["Owner and authority", "Next"].every(
      (k) => typeof values[k] === "string" && values[k].trim(),
    )
  )
    throw new Error("invalid index identity/sections");
  const parts = [`# Coordination ${id}`];
  for (const name of sections) {
    const body = values[name];
    if (body === undefined || (typeof body === "string" && !body.trim()))
      continue;
    if (
      typeof body !== "string" ||
      /^#{1,2} /m.test(body) ||
      /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)
    )
      throw new Error("invalid section body");
    parts.push(`## ${name}\n\n${body.trim()}`);
  }
  return parts.join("\n\n") + "\n";
}

async function location(cwd, id, create) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("invalid index ID");
  const common = await realpath(
    execFileSync(
      "git",
      [
        "-C",
        resolve(cwd),
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
      { encoding: "utf8" },
    ).trim(),
  );
  const dir = join(common, "pi-repo-coordination");
  if (create)
    await mkdir(dir, { mode: 0o700 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  try {
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("unsafe index directory");
  } catch (e) {
    if (e.code !== "ENOENT" || create) throw e;
  }
  return join(dir, `${id}.md`);
}
async function read(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("unsafe index file");
    return await readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function readIndex(cwd, id) {
  const path = await location(cwd, id, false);
  const text = await read(path);
  return { path, text, digest: text === null ? null : digest(text) };
}
export async function replaceIndex({ cwd, id, expected, values }) {
  const text = renderIndex(id, values); // validate everything before mutation
  const path = await location(cwd, id, true);
  const current = await read(path);
  if ((current === null ? null : digest(current)) !== expected)
    throw new Error("index changed; reconcile owner/state");
  if (current === text) return { path, digest: digest(text), written: false };
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  return { path, digest: digest(text), written: true };
}

// A sole cooperative writer is required: compare-and-replace is not fencing or a lock.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input);
    const result =
      request.action === "status"
        ? await readIndex(request.cwd, request.id)
        : request.action === "replace"
          ? await replaceIndex(request)
          : (() => {
              throw new Error("unknown action");
            })();
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
    process.exitCode = 1;
  }
}
