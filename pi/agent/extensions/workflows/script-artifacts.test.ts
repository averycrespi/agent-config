import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  cleanupOldWorkflowScripts,
  persistWorkflowScript,
  WORKFLOW_SCRIPT_RETENTION_MS,
} from "./script-artifacts.ts";

async function fixture(t: test.TestContext): Promise<string> {
  const dir = join(
    tmpdir(),
    `workflow-artifacts-${process.pid}-${Date.now()}-${Math.random()}`,
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("persists exact source in owner-only directory and exclusive file", async (t) => {
  const dir = await fixture(t);
  const source = "exact\nsource\n";
  const first = await persistWorkflowScript(
    source,
    "../../hostile",
    "../name",
    dir,
  );
  const second = await persistWorkflowScript(
    source,
    "../../hostile",
    "../name",
    dir,
  );

  assert.equal(await readFile(first, "utf8"), source);
  assert.notEqual(first, second);
  assert.equal((await lstat(dir)).mode & 0o777, 0o700);
  assert.equal((await lstat(first)).mode & 0o777, 0o600);
  assert.equal(first.startsWith(`${dir}/`), true);
  assert.doesNotMatch(first.slice(dir.length + 1), /\.\.|\//);
});

test("rejects a symlinked artifact directory", async (t) => {
  const parent = await fixture(t);
  const target = join(parent, "target");
  const link = join(parent, "link");
  await mkdir(target, { recursive: true });
  await symlink(target, link);
  await assert.rejects(
    () => persistWorkflowScript("source", "id", "name", link),
    /owner-controlled directory/,
  );
});

test("cleanup removes only old regular js files", async (t) => {
  const dir = await fixture(t);
  await mkdir(dir);
  const oldJs = join(dir, "old.js");
  const boundaryJs = join(dir, "boundary.js");
  const recentJs = join(dir, "recent.js");
  const unrelated = join(dir, "keep.txt");
  const target = join(dir, "target.js");
  const link = join(dir, "link.js");
  for (const path of [oldJs, boundaryJs, recentJs, unrelated, target])
    await writeFile(path, "x");
  await symlink(target, link);
  const now = Date.now();
  await utimes(
    oldJs,
    new Date(now - WORKFLOW_SCRIPT_RETENTION_MS - 1_000),
    new Date(now - WORKFLOW_SCRIPT_RETENTION_MS - 1_000),
  );
  await utimes(
    boundaryJs,
    new Date(now - WORKFLOW_SCRIPT_RETENTION_MS + 1_000),
    new Date(now - WORKFLOW_SCRIPT_RETENTION_MS + 1_000),
  );

  await cleanupOldWorkflowScripts(dir, WORKFLOW_SCRIPT_RETENTION_MS, now);
  await assert.rejects(() => lstat(oldJs), /ENOENT/);
  for (const path of [boundaryJs, recentJs, unrelated, target, link])
    assert.ok(await lstat(path));
});
