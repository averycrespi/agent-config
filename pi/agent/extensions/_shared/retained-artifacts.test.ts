import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { gunzip as gunzipCallback } from "node:zlib";
import {
  link as fsLink,
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
import test, { mock } from "node:test";
import {
  RETAINED_ARTIFACT_MAX_AGE_MS,
  _retainedArtifacts,
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

test("failed quota eviction discards the new artifact and preserves the old pool", async (t) => {
  const dir = await fixture(t);
  const first = await persistRetainedJson(
    "workflow-recovery",
    "first",
    { value: "first" },
    { dir },
  );
  const firstSize = (await lstat(first.path!)).size;
  const evictStub = mock.method(_retainedArtifacts, "evict", async () => {
    const error = new Error("denied") as NodeJS.ErrnoException;
    error.code = "EPERM";
    throw error;
  });
  t.after(() => evictStub.mock.restore());

  const second = await persistRetainedJson(
    "workflow-recovery",
    "second",
    { value: "second" },
    { dir, quotaBytes: firstSize },
  );
  assert.equal(second.retained, false);
  assert.match(second.warning ?? "", /quota/i);
  assert.ok(await lstat(first.path!));
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".gz")),
    [first.path!.split("/").at(-1)],
  );
});

test("publication retries collisions without overwriting", async (t) => {
  const dir = await fixture(t);
  let attempts = 0;
  const publishStub = mock.method(
    _retainedArtifacts,
    "publish",
    async (source: string, destination: string) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
      await fsLink(source, destination);
    },
  );
  t.after(() => publishStub.mock.restore());
  const result = await persistRetainedJson(
    "workflow-recovery",
    "collision",
    { ok: true },
    { dir },
  );
  assert.equal(result.retained, true);
  assert.equal(attempts, 2);
  assert.deepEqual(
    JSON.parse((await gunzip(await readFile(result.path!))).toString("utf8")),
    { ok: true },
  );
});

test("dead old staging and lock files are reclaimed without touching active staging", async (t) => {
  const dir = await fixture(t);
  await mkdir(dir, { mode: 0o700 });
  const now = Date.now();
  const deadStage = join(dir, ".stage-999999-aabb.tmp");
  const liveStage = join(dir, `.stage-${process.pid}-ccdd.tmp`);
  await writeFile(deadStage, "dead", { mode: 0o600 });
  await writeFile(liveStage, "live", { mode: 0o600 });
  const old = new Date(now - RETAINED_ARTIFACT_MAX_AGE_MS - 1_000);
  await utimes(deadStage, old, old);
  await utimes(liveStage, old, old);
  await writeFile(
    join(dir, ".retention.lock"),
    JSON.stringify({ pid: 999999 }),
    {
      mode: 0o600,
    },
  );
  const aliveStub = mock.method(
    _retainedArtifacts,
    "processAlive",
    (pid: number) => pid === process.pid,
  );
  t.after(() => aliveStub.mock.restore());

  const result = await persistRetainedJson(
    "workflow-recovery",
    "new",
    { ok: true },
    { dir, now },
  );
  assert.equal(result.retained, true);
  await assert.rejects(() => lstat(deadStage), /ENOENT/);
  assert.ok(await lstat(liveStage));
});

test("live lock contention discards the new artifact without publishing", async (t) => {
  const dir = await fixture(t);
  await mkdir(dir, { mode: 0o700 });
  await writeFile(
    join(dir, ".retention.lock"),
    JSON.stringify({ pid: process.pid }),
    { mode: 0o600 },
  );
  const artifact = await createRetainedArtifact({
    kind: "subagent-log",
    id: "busy",
    dir,
  });
  artifact.write("data");
  const result = await artifact.finalize();
  assert.equal(result.retained, false);
  assert.match(result.warning ?? "", /lock is busy/i);
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".gz")),
    [],
  );
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.includes("stage")),
    [],
  );
});

test("JSON serialization failures discard staging files", async (t) => {
  const dir = await fixture(t);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => persistRetainedJson("workflow-recovery", "cycle", cyclic, { dir }),
    /circular/i,
  );
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.includes("stage")),
    [],
  );
});

test("new operations lazily remove only old recognized legacy subagent logs", async (t) => {
  const parent = await fixture(t);
  const dir = join(parent, "current");
  const legacy = join(parent, "legacy");
  await mkdir(legacy, { recursive: true });
  const oldLog = join(legacy, "old-run.log");
  const recentLog = join(legacy, "recent.log");
  const unrelated = join(legacy, "keep.txt");
  await writeFile(oldLog, "old");
  await writeFile(recentLog, "recent");
  await writeFile(unrelated, "keep");
  const now = Date.now();
  const old = new Date(now - RETAINED_ARTIFACT_MAX_AGE_MS - 1_000);
  await utimes(oldLog, old, old);
  const legacyStub = mock.method(
    _retainedArtifacts,
    "legacyRoot",
    () => legacy,
  );
  t.after(() => legacyStub.mock.restore());

  const result = await persistRetainedJson(
    "workflow-recovery",
    "new",
    { ok: true },
    { dir, now },
  );
  assert.equal(result.retained, true);
  await assert.rejects(() => lstat(oldLog), /ENOENT/);
  assert.ok(await lstat(recentLog));
  assert.ok(await lstat(unrelated));
});

test("concurrent process finalizers cannot exceed the compressed quota", async (t) => {
  const dir = await fixture(t);
  const moduleUrl = new URL("./retained-artifacts.ts", import.meta.url).href;
  const childSource = `
    import { randomBytes } from "node:crypto";
    import { persistRetainedJson } from ${JSON.stringify(moduleUrl)};
    const result = await persistRetainedJson(
      "workflow-recovery",
      process.argv[1],
      { payload: randomBytes(512).toString("hex") },
      { dir: process.argv[2], quotaBytes: 800 },
    );
    process.stdout.write(JSON.stringify(result));
  `;
  const runChild = (id: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", childSource, id, dir],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`child ${id} failed (${code}): ${stderr}`)),
      );
    });

  await Promise.all([runChild("one"), runChild("two")]);
  const finals = (await readdir(dir)).filter((name) => name.endsWith(".gz"));
  const sizes = await Promise.all(
    finals.map(async (name) => (await lstat(join(dir, name))).size),
  );
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 800);
  assert.ok(finals.length <= 1);
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
