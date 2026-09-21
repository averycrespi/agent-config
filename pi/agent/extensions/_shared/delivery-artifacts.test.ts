import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  lstat,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deliveryRevision,
  retainDeliveryArtifact,
} from "./delivery-artifacts.ts";
async function repo(t: import("node:test").TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "delivery-artifact-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Example");
  git("config", "user.email", "test@example.com");
  await writeFile(join(cwd, "code"), "original\n");
  git("add", "code");
  git("commit", "-qm", "test: fixture");
  return { cwd, git };
}
test("original report bytes and scope are retained once outside tracked files", async (t) => {
  const { cwd, git } = await repo(t);
  const report = "# Original\r\n\nUnicode: café 🦊\n  trailing spaces  \n";
  const revision = deliveryRevision(cwd);
  const value = {
    revision,
    scope: { boundary: "pre-publication", criteria: ["Exact retention"] },
    result: { report, complete: false },
  };
  const artifact = retainDeliveryArtifact(cwd, "review", value);
  assert.deepEqual(retainDeliveryArtifact(cwd, "review", value), artifact);
  const retained = JSON.parse(await readFile(artifact.path, "utf8"));
  assert.deepEqual(Buffer.from(retained.result.report), Buffer.from(report));
  assert.deepEqual(retained.revision, revision);
  assert.equal((await lstat(artifact.path)).mode & 0o777, 0o600);
  assert.equal(git("status", "--porcelain").toString(), "");
  await writeFile(join(cwd, "code"), "changed\n");
  assert.notEqual(deliveryRevision(cwd).deltaSha256, revision.deltaSha256);
  assert.equal(deliveryRevision(cwd).head, revision.head);
});
test("unsafe artifact stores and unstaged untracked review scope reject", async (t) => {
  const { cwd } = await repo(t);
  await symlink(tmpdir(), join(cwd, ".git", "pi-delivery-artifacts"));
  assert.throws(
    () => retainDeliveryArtifact(cwd, "background", { receipt: {} }),
    /Unsafe/,
  );
  await writeFile(join(cwd, "untracked"), "not in reviewed delta");
  assert.throws(() => deliveryRevision(cwd), /Stage intended untracked/);
});
