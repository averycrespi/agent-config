#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const sections = [
  "Owner and authority",
  "Decisions",
  "Assignments",
  "Mailbox",
  "Unresolved control",
  "Observation",
  "Next",
];
export const digest = (text) => createHash("sha256").update(text).digest("hex");
export function renderIndex(id, values) {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
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
    parts.push(`## ${name}\n\n${body}`);
  }
  return parts.join("\n\n") + "\n";
}

// Parse complete section boundaries, never multiline `$` as an end-of-document test.
// Reject noncanonical structure rather than normalizing away unrecognized facts.
export function parseIndex(text, expectedId) {
  if (typeof text !== "string") throw new Error("invalid index text");
  const title = /^# Coordination ([a-zA-Z0-9_-]+)\n\n/.exec(text);
  if (!title || (expectedId !== undefined && title[1] !== expectedId))
    throw new Error("invalid index identity");
  const id = title[1];
  const headings = [...text.matchAll(/^## (.*)\n/gm)];
  const values = {};
  let previous = -1;
  if (headings[0]?.index !== title[0].length)
    throw new Error("invalid index structure");
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const name = heading[1];
    const position = sections.indexOf(name);
    if (position <= previous)
      throw new Error("unknown, duplicate or unordered section");
    previous = position;
    const start = heading.index + heading[0].length;
    const end = headings[i + 1]?.index ?? text.length;
    const suffix = i + 1 < headings.length ? "\n\n" : "\n";
    const body = text.slice(start, end);
    if (!body.startsWith("\n") || !body.endsWith(suffix))
      throw new Error("invalid section delimiters");
    values[name] = body.slice(1, -suffix.length);
  }
  if (renderIndex(id, values) !== text)
    throw new Error("invalid index structure");
  return { id, values };
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
  const values = text === null ? null : parseIndex(text, id).values;
  return {
    id,
    path,
    text,
    values,
    digest: text === null ? null : digest(text),
  };
}
export async function replaceIndex({ cwd, id, expected, values, attemptId }) {
  const text = renderIndex(id, values); // validate everything before mutation
  const path = await location(cwd, id, true);
  const current = await read(path);
  if ((current === null ? null : digest(current)) !== expected)
    throw new Error("index changed; reconcile owner/state");
  if (current !== null) parseIndex(current, id);
  if (current === text)
    return {
      id,
      expected,
      attemptId,
      path,
      digest: digest(text),
      written: false,
    };
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
    const dir = await open(resolve(path, ".."), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  return { id, expected, attemptId, path, digest: digest(text), written: true };
}

function validateAttempt({ attemptId, expected }) {
  if (
    typeof attemptId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId) ||
    !(
      expected === null ||
      (typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected))
    )
  )
    throw new Error("current persistence attempt identity/base required");
}

// Bind independently retained caller intent/attempt provenance, not a token
// copied from the response. This is correlation, not authenticated one-use fencing.
export async function confirmIndex(
  { cwd, id, expected, values, attemptId },
  receipt,
) {
  validateAttempt({ attemptId, expected });
  const text = renderIndex(id, values);
  const path = await location(cwd, id, false);
  if (
    !receipt ||
    receipt.id !== id ||
    receipt.attemptId !== attemptId ||
    receipt.expected !== expected ||
    receipt.path !== path ||
    receipt.digest !== digest(text) ||
    typeof receipt.written !== "boolean"
  )
    throw new Error("invalid persistence receipt");
  const saved = await readIndex(cwd, id);
  if (saved.text !== text || saved.digest !== receipt.digest)
    throw new Error("persistence readback mismatch; reconcile without replay");
  return { ...receipt, confirmed: true };
}

export async function confirmIndexResponse(request, stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error("missing or malformed persistence response");
  }
  if (!envelope || Object.keys(envelope).length !== 1 || !envelope.result)
    throw new Error("invalid persistence response");
  return confirmIndex(request, envelope.result);
}

export async function persistIndex(request) {
  validateAttempt(request);
  const receipt = await replaceIndex(request);
  return confirmIndex(request, receipt);
}

// Patch named sections only; omission preserves every other section. Explicit
// null deletes optional sections. A stale base never becomes an implicit retry.
export async function updateIndex({ cwd, id, expected, changes, attemptId }) {
  validateAttempt({ attemptId, expected });
  if (
    !changes ||
    typeof changes !== "object" ||
    Array.isArray(changes) ||
    Object.keys(changes).some((name) => !sections.includes(name))
  )
    throw new Error("invalid section changes");
  const current = await readIndex(cwd, id);
  if (current.digest !== expected || current.values === null)
    throw new Error("index changed or missing; reconcile owner/state");
  const values = { ...current.values };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete values[name];
    else if (typeof value !== "string" || !value.trim())
      throw new Error("use explicit null to remove a section");
    else values[name] = value;
  }
  return persistIndex({ cwd, id, expected, values, attemptId });
}

// A sole cooperative writer is required: compare-and-replace is not fencing or a lock.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input);
    const result =
      request.action === "status"
        ? await readIndex(request.cwd, request.id)
        : request.action === "replace"
          ? await persistIndex(request)
          : request.action === "update"
            ? await updateIndex(request)
            : request.action === "confirm"
              ? await confirmIndexResponse(request, request.response)
              : (() => {
                  throw new Error("unknown action");
                })();
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
    process.exitCode = 1;
  }
}
