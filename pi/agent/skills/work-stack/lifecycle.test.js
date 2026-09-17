import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  copyFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ticketState } from "../work-ticket/scripts/ticket-state.js";

const ids = [
  "11111111-2222-4333-8444-555555555555",
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
];
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// These ordinary disposable repositories use separate Git directories, not real
// linked worktrees. Remote surfaces and Herdr removal are explicit fixture I/O.
test("serial cleanup retains verified archives, merge evidence and pending effects across interruptions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stack-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const retained = [];
  for (const [index, ticketId] of ids.entries()) {
    const cwd = join(root, `child-${index}`),
      common = join(root, `git-${index}`),
      survivor = join(root, `survivor-${index}`);
    await mkdir(cwd);
    git(
      cwd,
      "init",
      "-q",
      `--separate-git-dir=${common}`,
      "--initial-branch=avery/fixture",
    );
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Fixture");
    await writeFile(join(cwd, "code.txt"), "delivered\n");
    git(cwd, "add", "code.txt");
    git(cwd, "commit", "-qm", "test: delivered fixture");
    const head = git(cwd, "rev-parse", "HEAD");
    await mkdir(survivor);
    await copyFile(join(cwd, ".git"), join(survivor, ".git"));
    const owner = `session-${index}`;
    const call = (r, location = cwd) =>
      ticketState({ cwd: location, ticketId, owner, ...r });
    const status = (location = cwd) => call({ action: "status" }, location);
    await call({
      action: "init",
      patch: {
        scope: `Fixture ticket ${ticketId} delivered at ${head}`,
        authorization:
          "Synthetic explicit settlement and non-force removal authority; no branch deletion",
        plan: "Archive; confirm merge and settlement; removal intent; release; remove; confirm",
        next: {
          actor: "fixture",
          action: "Verify archive before settlement/removal",
        },
      },
    });
    const checkpoint = join(
      common,
      "pi-ticket-checkpoints",
      `${ticketId}.json`,
    );
    const archives = join(
      common,
      "pi-ticket-artifacts",
      ticketId,
      owner,
      "archives",
    );
    let archive = join(archives, "first");
    const effects = { transitions: 0, comments: [], removals: [] };
    const sourceFiles = [
      ".handoffs/brief.md",
      ".pi/tickets/legacy.json",
      "evidence/review.json",
    ];
    for (const path of sourceFiles) {
      await mkdir(join(cwd, path, ".."), { recursive: true });
      await writeFile(join(cwd, path), `original ${index} ${path} ${head}\n`);
    }
    const copyArchive = async () => {
      await mkdir(archives, { recursive: true });
      await mkdir(archive); // Existing archives cannot be overwritten.
      const manifest = [];
      for (const path of sourceFiles) {
        const bytes = await readFile(join(cwd, path));
        manifest.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
        await mkdir(join(archive, path, ".."), { recursive: true });
        await copyFile(join(cwd, path), join(archive, path));
      }
      await writeFile(
        join(archive, "manifest.json"),
        JSON.stringify({ head, files: manifest }),
      );
    };
    const verifyArchive = async (compareSource = true) => {
      const saved = JSON.parse(await readFile(join(archive, "manifest.json")));
      assert.equal(saved.head, head);
      assert.deepEqual(
        saved.files.map((entry) => entry.path),
        sourceFiles,
      );
      for (const entry of saved.files) {
        const bytes = await readFile(join(archive, entry.path));
        assert.equal(bytes.length, entry.bytes);
        assert.equal(sha256(bytes), entry.sha256);
        if (compareSource) {
          const source = await readFile(join(cwd, entry.path));
          assert.equal(source.length, entry.bytes);
          assert.equal(sha256(source), entry.sha256);
          assert.deepEqual(bytes, source);
        }
      }
    };
    await copyArchive();
    // Interrupt before verification: mismatched copied bytes stop, with source intact.
    const damaged = join(archive, sourceFiles[0]);
    const original = await readFile(damaged);
    const corrupt = Buffer.alloc(original.length, 120);
    await writeFile(damaged, corrupt);
    await assert.rejects(verifyArchive());
    assert.deepEqual(await readFile(join(cwd, sourceFiles[0])), original);
    assert.deepEqual(effects, { transitions: 0, comments: [], removals: [] });
    assert.equal((await status()).pendingEffect, null);
    assert.equal((await stat(cwd)).isDirectory(), true);
    // A later continuation uses a new archive, leaving failure evidence untouched.
    archive = join(archives, "second");
    await copyArchive();
    const staleManifest = await readFile(join(archive, "manifest.json"));
    await writeFile(
      join(cwd, sourceFiles[0]),
      Buffer.alloc(original.length, 121),
    );
    await assert.rejects(
      verifyArchive(),
      "same-size source change invalidates the copy",
    );
    assert.deepEqual(effects, { transitions: 0, comments: [], removals: [] });
    assert.deepEqual(await readFile(damaged), corrupt);
    archive = join(archives, "third");
    await copyArchive();
    await verifyArchive();
    assert.deepEqual(
      await readFile(join(archives, "second", "manifest.json")),
      staleManifest,
    );
    assert.deepEqual(await readFile(damaged), corrupt);
    const remote = {
      ticketId,
      pr: `https://github.com/example/project/pull/${index + 1}`,
      head,
      merged: false,
      scopeVerified: true,
      state: "Review",
    };
    const assertMerge = () => {
      assert.equal(remote.ticketId, ticketId);
      assert.equal(remote.head, head);
      assert.equal(remote.merged, true);
      assert.equal(remote.scopeVerified, true);
    };
    assert.throws(assertMerge);
    assert.equal(effects.transitions, 0);
    remote.merged = true;
    assertMerge();
    await call({
      action: "external",
      operation: "begin",
      id: "settle",
      target: ticketId,
      intent: `Set Done from verified merged ${remote.pr} ${head}`,
    });
    remote.state = "Done";
    effects.transitions++;
    // Lost transition response: reread external fixture and confirm, never resend.
    assert.equal((await status()).pendingEffect.id, "settle");
    assertMerge();
    assert.equal(remote.state, "Done");
    await call({
      action: "external",
      operation: "confirm",
      id: "settle",
      reference: `Reread Done and merged ${remote.pr} ${head}`,
    });
    await call({
      action: "checkpoint",
      patch: {
        evidenceRefs: [
          `Merge/settlement ${remote.pr} ${head}; ${archive}/manifest.json`,
        ],
      },
    });
    const comment = {
      id: `comment-${index}`,
      marker: `${ticketId}/${owner}/${head}`,
      body: "Settled; archive verified; retain branches",
    };
    await call({
      action: "external",
      operation: "begin",
      id: "final-comment",
      target: `${ticketId} comments`,
      intent: JSON.stringify(comment),
    });
    effects.comments.push(comment);
    // Interrupted final bookkeeping: a different writer/effect cannot take over.
    const before = await readFile(checkpoint);
    await assert.rejects(
      call({
        action: "checkpoint",
        owner: "competitor",
        patch: { progress: "steal" },
      }),
      /another owner/,
    );
    await assert.rejects(
      call({
        action: "external",
        operation: "begin",
        id: "remove",
        target: cwd,
        intent: "premature",
      }),
      /pending effect/,
    );
    assert.deepEqual(await readFile(checkpoint), before);
    const matches = effects.comments.filter((c) => c.marker === comment.marker);
    assert.deepEqual(matches, [comment]);
    await call({
      action: "external",
      operation: "confirm",
      id: "final-comment",
      reference: `Reread ${comment.id} exact marker/content`,
    });
    await call({
      action: "checkpoint",
      patch: {
        progress: `Merged ${head}; archive verified; observer none; settlement and comment confirmed`,
        evidenceRefs: [`Comment ${comment.id} ${comment.marker}; ${archive}`],
        next: {
          actor: "fixture",
          action: `Remove only ${cwd}; confirm inventory and path absence from survivor`,
        },
      },
    });
    await call({
      action: "external",
      operation: "begin",
      id: "remove",
      target: cwd,
      intent: `Explicit non-force fixture removal; verified archive ${archive}; branch retained`,
    });
    await call({ action: "release" });
    assert.equal((await status()).pendingEffect.id, "remove");
    assert.equal((await status()).released, true);
    // Interruption after release: normal writes reject; pending confirmation survives.
    await assert.rejects(
      call({ action: "checkpoint", patch: { progress: "late write" } }),
      /released/,
    );
    const inventory = new Set([cwd]);
    const argv = ["herdr", "worktree", "remove", cwd];
    assert.ok(!argv.some((arg) => arg.includes("force")));
    assert.equal((await status()).pendingEffect.target, cwd);
    await verifyArchive();
    effects.removals.push(argv);
    await rm(cwd, { recursive: true });
    inventory.delete(cwd);
    // Lost removal response: confirm absence from survivor, not a second removal.
    assert.equal(inventory.has(cwd), false);
    await assert.rejects(stat(cwd), { code: "ENOENT" });
    assert.equal((await status(survivor)).pendingEffect.id, "remove");
    await call(
      {
        action: "external",
        operation: "confirm",
        id: "remove",
        reference:
          "Fixture inventory and path both absent; archived bytes verified",
      },
      survivor,
    );
    await call(
      {
        action: "external",
        operation: "confirm",
        id: "remove",
        reference: "Repeated confirmation, no removal replay",
      },
      survivor,
    );
    assert.equal((await status(survivor)).pendingEffect, null);
    assert.equal(git(survivor, "rev-parse", "refs/heads/avery/fixture"), head);
    await verifyArchive(false); // Source is now absent; verify retained manifest/bytes.
    assert.deepEqual(await readFile(damaged), corrupt);
    assert.deepEqual(
      await readFile(join(archives, "second", "manifest.json")),
      staleManifest,
    );
    assert.equal(effects.transitions, 1);
    assert.equal(effects.comments.length, 1);
    assert.equal(effects.removals.length, 1);
    retained.push({ checkpoint, archive, head, survivor });
    // Serial admission: previous child's confirmations and retained evidence exist.
    for (const prior of retained) {
      assert.equal(
        JSON.parse(await readFile(prior.checkpoint)).lastEffect.id,
        "remove",
      );
      assert.ok((await readdir(prior.archive)).includes("manifest.json"));
      assert.equal(git(prior.survivor, "rev-parse", "HEAD"), prior.head);
    }
  }
});
