import assert from "node:assert/strict";
import { gunzip as gunzipCallback } from "node:zlib";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  RETAINED_ARTIFACT_MAX_AGE_MS,
  createRetainedArtifact,
  persistRetainedJson,
} from "./retained-artifacts.ts";

const gunzip = promisify(gunzipCallback);

async function fixture(t: test.TestContext): Promise<string> {
  const dir = join(
    tmpdir(),
    `retained-artifacts-${process.pid}-${Date.now()}-${Math.random()}`,
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("streams owner-only gzip and publishes without exposing staging", async (t) => {
  const dir = await fixture(t);
  const artifact = await createRetainedArtifact({
    kind: "subagent-log",
    id: "../../hostile",
    dir,
  });
  artifact.write("first\n");
  artifact.write(Buffer.from("second\n"));
  const result = await artifact.finalize();

  assert.equal(result.retained, true);
  assert.ok(result.path?.startsWith(`${dir}/`));
  assert.match(result.path!, /\.log\.gz$/);
  assert.equal(
    (await gunzip(await readFile(result.path!))).toString("utf8"),
    "first\nsecond\n",
  );
  assert.equal((await lstat(dir)).mode & 0o777, 0o700);
  assert.equal((await lstat(result.path!)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.includes("stage")),
    [],
  );
});

test("persists compressed JSON and discard publishes no path", async (t) => {
  const dir = await fixture(t);
  const json = await persistRetainedJson(
    "workflow-recovery",
    "run/id",
    { schemaVersion: 1, value: null },
    { dir },
  );
  assert.equal(json.retained, true);
  assert.match(json.path!, /\.json\.gz$/);
  assert.deepEqual(
    JSON.parse((await gunzip(await readFile(json.path!))).toString("utf8")),
    { schemaVersion: 1, value: null },
  );

  const discarded = await createRetainedArtifact({
    kind: "subagent-log",
    id: "discard",
    dir,
  });
  discarded.write("secret");
  await discarded.discard();
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.includes("discard")),
    [],
  );
});

test("lazy retention removes old recognized files and preserves unsafe entries", async (t) => {
  const dir = await fixture(t);
  await mkdir(dir, { mode: 0o700 });
  const old = join(dir, "subagent-old-a.log.gz");
  const recent = join(dir, "workflow-recent-b.json.gz");
  const unrelated = join(dir, "unrelated.log.gz");
  const target = join(dir, "target");
  const link = join(dir, "subagent-link-c.log.gz");
  const childDir = join(dir, "workflow-directory-d.json.gz");
  await writeFile(old, "old", { mode: 0o600 });
  await writeFile(recent, "recent", { mode: 0o600 });
  await writeFile(unrelated, "unrelated");
  await writeFile(target, "target");
  await symlink(target, link);
  await mkdir(childDir);
  const now = Date.now();
  await utimes(
    old,
    new Date(now - RETAINED_ARTIFACT_MAX_AGE_MS - 1_000),
    new Date(now - RETAINED_ARTIFACT_MAX_AGE_MS - 1_000),
  );

  const artifact = await createRetainedArtifact({
    kind: "subagent-log",
    id: "new",
    dir,
    now,
  });
  artifact.write("new");
  const result = await artifact.finalize();
  assert.equal(result.retained, true);
  await assert.rejects(() => lstat(old), /ENOENT/);
  for (const path of [recent, unrelated, target, link, childDir]) {
    assert.ok(await lstat(path));
  }
});

test("quota evicts oldest finalized artifact and rejects an oversized artifact", async (t) => {
  const dir = await fixture(t);
  const first = await persistRetainedJson(
    "workflow-recovery",
    "first",
    { value: "first" },
    { dir, quotaBytes: 160 },
  );
  assert.equal(first.retained, true);
  await utimes(first.path!, new Date(1_000), new Date(1_000));

  const second = await persistRetainedJson(
    "workflow-recovery",
    "second",
    { value: "second" },
    { dir, quotaBytes: 160 },
  );
  assert.equal(second.retained, true);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".gz"));
  const total = await Promise.all(
    files.map(async (name) => (await lstat(join(dir, name))).size),
  );
  assert.ok(total.reduce((sum, size) => sum + size, 0) <= 160);

  const oversized = await createRetainedArtifact({
    kind: "subagent-log",
    id: "oversized",
    dir,
    quotaBytes: 1,
  });
  oversized.write("cannot fit");
  const rejected = await oversized.finalize();
  assert.equal(rejected.retained, false);
  assert.match(rejected.warning ?? "", /quota/i);
  assert.equal(rejected.path, undefined);
});

test("unsafe symlink root is rejected before staging creation", async (t) => {
  const parent = await fixture(t);
  const target = join(parent, "target");
  const link = join(parent, "link");
  await mkdir(target, { recursive: true });
  await symlink(target, link);
  await assert.rejects(
    () =>
      createRetainedArtifact({
        kind: "subagent-log",
        id: "x",
        dir: link,
      }),
    /owner-controlled directory/,
  );
  assert.deepEqual(await readdir(target), []);
});
