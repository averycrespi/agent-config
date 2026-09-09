import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ticketState } from "./ticket-state.js";

const ticketId = "11111111-2222-3333-4444-555555555555";
const otherId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "ticket-checkpoint-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-q", "--initial-branch=main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  await writeFile(join(cwd, "code.txt"), "initial\n");
  git(cwd, "add", "code.txt");
  git(cwd, "commit", "-qm", "test: fixture");
  const request = { cwd, ticketId, owner: "session-one" };
  const call = (r) => ticketState({ ...request, ...r });
  const patch = {
    scope: "ABC-1: fix boundary; see canonical ticket",
    authorization: "User requests local implementation and commit",
    plan: "Reproduce; repair; verify",
    next: { actor: "agent", action: "Reproduce the boundary failure" },
  };
  return {
    cwd,
    request,
    call,
    patch,
    file: join(cwd, ".git", "pi-ticket-checkpoints", `${ticketId}.json`),
    init: (r = {}) => call({ action: "init", patch, ...r }),
    status: () => call({ action: "status" }),
  };
}

test("inspection is nonmutating; checkpoint persists across CLI processes outside tracked files", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.status(), { missing: true, legacy: null });
  await assert.rejects(lstat(join(f.cwd, ".git", "pi-ticket-checkpoints")), {
    code: "ENOENT",
  });
  const receipt = await f.init();
  assert.equal(receipt.saved, true);
  assert.equal(receipt.file, f.file);
  assert.ok(JSON.stringify(receipt).length < 700);
  assert.equal(receipt.scope, undefined);
  const run = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "ticket-state.js")],
    {
      input: JSON.stringify({ ...f.request, action: "status" }),
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stdout);
  assert.equal(JSON.parse(run.stdout).result.plan, f.patch.plan);
  assert.equal(git(f.cwd, "status", "--porcelain"), "");
  assert.equal((await lstat(f.file)).mode & 0o777, 0o600);
});

test("patches are atomic and preserve evidence through scope, commits and follow-ups", async (t) => {
  const f = await fixture(t);
  await f.init();
  await f.call({
    action: "checkpoint",
    patch: {
      evidenceRefs: ["base SHA: failed regression, /tmp/regression.log"],
      findingRefs: ["review incomplete: /tmp/review.json"],
      progress: "Local handoff",
      next: { actor: "user", action: "Approve publication" },
    },
  });
  await writeFile(join(f.cwd, "code.txt"), "fixed\n");
  git(f.cwd, "add", "code.txt");
  git(f.cwd, "commit", "-qm", "fix: boundary");
  await f.call({
    action: "checkpoint",
    patch: {
      scope: "Explicitly expanded scope",
      authorization: "User authorizes publication",
      next: { actor: "agent", action: "Assess newly applicable requirements" },
    },
  });
  const s = await f.status();
  assert.match(s.evidenceRefs[0], /failed/);
  assert.match(s.findingRefs[0], /incomplete/);
  const before = await readFile(f.file);
  for (const patch of [
    { repairs: {} },
    { plan: "", progress: "must not persist" },
    { next: { action: "missing actor" } },
    { evidenceRefs: [null] },
    { owner: "steal" },
  ]) {
    await assert.rejects(f.call({ action: "checkpoint", patch }));
    assert.deepEqual(await readFile(f.file), before);
  }
  await assert.rejects(f.init(), /exists/);
});

test("scoped overrides preserve adverse evidence, are idempotent, and allow progress without fake gates", async (t) => {
  const f = await fixture(t);
  await f.init();
  await f.call({
    action: "checkpoint",
    patch: {
      evidenceRefs: ["native check not-run at abc"],
      findingRefs: ["incomplete independent review at abc"],
    },
  });
  const override = {
    id: "publish-exception",
    requirement: "native-check",
    scope: "ABC-1 revision abc",
    action: "Publish draft despite missing native qualification",
    instruction: "User explicitly approves this publication exception",
    reference: "current user message",
  };
  await f.call({ action: "override", override });
  await f.call({ action: "override", override });
  const s = await f.status();
  assert.equal(s.overrides.length, 1);
  assert.equal(s.evidenceRefs[0], "native check not-run at abc");
  assert.match(s.findingRefs[0], /incomplete/);
  await f.call({
    action: "checkpoint",
    patch: {
      progress: "Published with disclosed user exception",
      next: { actor: "agent", action: "Monitor CI" },
    },
  });
  for (const bad of [
    { ...override, action: "different action" },
    { ...override, id: "new", scope: "" },
    { ...override, id: "new", bypassEverything: true },
  ])
    await assert.rejects(f.call({ action: "override", override: bad }));
  await assert.rejects(
    f.call({ action: "gate", operation: "publish" }),
    /legacy delivery gates are retired/,
  );
});

test("review and CI repairs retain independent allowances, resume identities and explicit additions", async (t) => {
  const f = await fixture(t);
  await f.init();
  for (const id of ["first", "second"]) {
    const r = {
      action: "repair",
      operation: "begin",
      kind: "review",
      id,
      plan: `Fix ${id} findings`,
    };
    await f.call(r);
    await f.call(r);
    assert.equal((await f.status()).repairs.review.active, id);
    await f.call({ action: "repair", operation: "finish", kind: "review", id });
    await f.call(r);
    assert.equal((await f.status()).repairs.review.active, null);
  }
  await assert.rejects(
    f.call({
      action: "repair",
      operation: "begin",
      kind: "review",
      id: "third",
      plan: "Fix",
    }),
    /allowance exhausted/,
  );
  await f.call({
    action: "repair",
    operation: "begin",
    kind: "ci",
    id: "ci-one",
    plan: "Repair failed integration test",
  });
  const override = {
    id: "more-repair",
    requirement: "review-budget",
    scope: "same ticket",
    action: "One further repair",
    instruction: "User authorizes one more repair",
    reference: "current user message",
    budget: "review",
    additional: 1,
  };
  await f.call({ action: "override", override });
  await f.call({ action: "override", override });
  await f.call({
    action: "repair",
    operation: "begin",
    kind: "review",
    id: "third",
    plan: "Fix",
  });
  const s = await f.status();
  assert.equal(s.repairs.review.limit, 3);
  assert.equal(s.repairs.review.batches.length, 3);
  assert.equal(s.repairs.ci.batches.length, 1);
  await assert.rejects(
    f.call({
      action: "repair",
      operation: "begin",
      kind: "ci",
      id: "ci-two",
      plan: "Competing repair",
    }),
    /active repair/,
  );
});

test("ownership protects checkout across tickets; explicit claim preserves all state", async (t) => {
  const f = await fixture(t);
  await f.init();
  await assert.rejects(
    f.call({
      action: "checkpoint",
      owner: "other",
      patch: { progress: "steal" },
    }),
    /another owner/,
  );
  await assert.rejects(f.init({ ticketId: otherId }), /another ticket owner/);
  await assert.rejects(
    f.call({
      action: "claim",
      owner: "other",
      previousOwner: "wrong",
      instruction: "Transfer",
      evidence: "Prior owner released",
    }),
    /previous owner/,
  );
  await f.call({
    action: "claim",
    owner: "other",
    previousOwner: "session-one",
    instruction: "User transfers ownership",
    evidence: "Prior session absent, checkout inspected",
  });
  assert.equal((await f.status()).owner, "other");
  assert.equal((await f.status()).plan, f.patch.plan);
  await f.call({ action: "release", owner: "other" });
  await f.init({ ticketId: otherId });
  await assert.rejects(
    f.call({
      action: "claim",
      owner: "other",
      previousOwner: "other",
      instruction: "Resume",
      evidence: "Old owner released",
    }),
    /another ticket owner/,
  );
});

test("pending effects survive release; confirmation works from surviving repository without repeating effects", async (t) => {
  const f = await fixture(t);
  await f.init();
  const effect = {
    action: "external",
    operation: "begin",
    id: "remove-checkout",
    target: "exact linked checkout",
    intent: "Authorized non-force removal; preserve branches and evidence",
  };
  await f.call(effect);
  await f.call(effect);
  await assert.rejects(
    f.call({ ...effect, id: "another-effect" }),
    /pending effect/,
  );
  await f.call({ action: "release" });
  // Simulate a removed assigned checkout while the common Git repository survives.
  const s = await f.status();
  s.checkout = join(f.cwd, "removed-checkout");
  await writeFile(f.file, JSON.stringify(s));
  await f.call({
    action: "external",
    operation: "confirm",
    id: "remove-checkout",
    reference: "Fresh inventory and path absence confirmed",
  });
  await f.call({
    action: "external",
    operation: "confirm",
    id: "remove-checkout",
    reference: "Reread confirmed removal",
  });
  assert.equal((await f.status()).pendingEffect, null);
  assert.equal((await f.status()).lastEffect.id, "remove-checkout");
});

test("legacy records are never rewritten or silently adopted; consumption cannot be refunded", async (t) => {
  const f = await fixture(t);
  const dir = join(f.cwd, ".pi", "tickets", ticketId);
  await mkdir(dir, { recursive: true });
  const legacy = join(dir, "state.json");
  const bytes = JSON.stringify({
    schemaVersion: 1,
    ticketId,
    repairCount: 2,
    status: "blocked",
    review: { complete: false },
  });
  await writeFile(legacy, bytes);
  assert.deepEqual(await f.status(), { missing: true, legacy });
  await assert.rejects(f.init(), /explicit recovery/);
  const recovery = {
    reference: legacy,
    instruction: "Resume with retained evidence and no pending effects",
    reviewUsed: 1,
    ciUsed: 0,
    waitingMs: 1800000,
    effectsReconciled: true,
  };
  await assert.rejects(f.init({ recovery }), /refund/);
  await f.init({ recovery: { ...recovery, reviewUsed: 2 } });
  assert.equal((await f.status()).repairs.review.batches.length, 2);
  assert.equal((await f.status()).recoveredWaitingMs, 1800000);
  assert.equal(await readFile(legacy, "utf8"), bytes);
});

test("legacy recovery retains active repair identities without recharging resume", async (t) => {
  const f = await fixture(t);
  const recovery = {
    reference: "Retained legacy state and original attempt evidence",
    instruction: "Resume the interrupted attempts",
    reviewUsed: 2,
    ciUsed: 2,
    waitingMs: 0,
    effectsReconciled: true,
    repairs: {
      review: {
        batches: [
          { id: "first", plan: "Completed repair" },
          { id: "second", plan: "Interrupted review repair" },
        ],
        active: "second",
      },
      ci: {
        batches: [
          { id: "ci-first", plan: "Completed CI repair" },
          { id: "ci-second", plan: "Interrupted CI repair" },
        ],
        active: "ci-second",
      },
    },
  };
  const invalid = structuredClone(recovery);
  invalid.repairs.review.batches.pop();
  await assert.rejects(f.init({ recovery: invalid }), /retained repair count/);
  invalid.repairs.review.batches = recovery.repairs.review.batches;
  invalid.repairs.review.active = "unknown";
  await assert.rejects(f.init({ recovery: invalid }), /repair identity/);
  assert.equal((await f.status()).missing, true);
  await f.init({ recovery });
  for (const kind of ["review", "ci"]) {
    const retained = recovery.repairs[kind];
    const batch = retained.batches[1];
    await f.call({ action: "repair", operation: "begin", kind, ...batch });
    assert.deepEqual((await f.status()).repairs[kind], {
      ...retained,
      limit: 2,
    });
    await f.call({ action: "repair", operation: "finish", kind, id: batch.id });
    assert.equal((await f.status()).repairs[kind].batches.length, 2);
    await assert.rejects(
      f.call({
        action: "repair",
        operation: "begin",
        kind,
        id: "new",
        plan: "Another repair",
      }),
      /exhausted/,
    );
  }
});

test("path, identity, malformed state and lock conflicts cannot be overridden", async (t) => {
  const f = await fixture(t);
  for (const bad of ["../escape", "ABC-1"])
    await assert.rejects(f.init({ ticketId: bad }), /UUID/);
  await f.init();
  const bytes = await readFile(f.file);
  const store = join(f.cwd, ".git", "pi-ticket-checkpoints");
  const lock = join(store, ".writer.lock");
  await mkdir(lock);
  await writeFile(join(lock, "owner.json"), "live owner");
  await assert.rejects(
    f.call({ action: "checkpoint", patch: { progress: "blocked" } }),
    /writer lock/,
  );
  assert.equal(await readFile(join(lock, "owner.json"), "utf8"), "live owner");
  await rm(lock, { recursive: true });
  await rm(f.file);
  await symlink(join(f.cwd, "code.txt"), f.file);
  await assert.rejects(f.status(), /regular file/);
  await assert.rejects(
    f.call({ action: "checkpoint", patch: { progress: "blocked" } }),
    /regular file/,
  );
  await rm(f.file);
  await writeFile(f.file, bytes);
  const s = JSON.parse(bytes);
  s.ticketId = otherId;
  await writeFile(f.file, JSON.stringify(s));
  await assert.rejects(f.status(), /identity mismatch/);
  await writeFile(f.file, "invalid JSON");
  await assert.rejects(f.status());
  await rm(store, { recursive: true });
  await mkdir(join(f.cwd, "outside"));
  await symlink(join(f.cwd, "outside"), store);
  await assert.rejects(f.init(), /symlink/);
  assert.deepEqual(await readdir(join(f.cwd, "outside")), []);
});

test("concurrent helpers do not interleave writes and failed CLI requests report recoverable errors", async (t) => {
  const f = await fixture(t);
  await f.init();
  const results = await Promise.allSettled([
    f.call({ action: "checkpoint", patch: { progress: "first" } }),
    f.call({ action: "checkpoint", patch: { progress: "second" } }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(["first", "second"].includes((await f.status()).progress));
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "ticket-state.js")],
    {
      input: JSON.stringify({
        ...f.request,
        action: "checkpoint",
        patch: { plan: "" },
      }),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /invalid plan/);
});

test("Monitor registration and terminal accounting persist atomically through the checkpoint interface", async (t) => {
  const f = await fixture(t);
  await f.init();
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const pr = "https://github.com/example/project/pull/1",
    head = "a".repeat(40);
  await f.call({
    action: "ci",
    operation: "watch",
    pr,
    head,
    required: ["Tests"],
  });
  const observation = {
    head,
    requirementsKnown: true,
    checks: [{ name: "Tests", state: "pending" }],
    reference: "gateway batch",
  };
  await f.call({ action: "ci", operation: "observe", observation });
  now = 1000;
  const prepared = await f.call({ action: "ci", operation: "prepare" });
  assert.equal(prepared.ci.watcher.timeoutMs, 1799000);
  now = 2000;
  const receipt = {
    id: otherId,
    createdAt: now,
    deadline: now + prepared.ci.watcher.timeoutMs,
  };
  await f.call({ action: "ci", operation: "attach", pr, head, receipt });
  assert.equal((await f.status()).monitor.watcher.id, otherId);
  const bytes = await readFile(f.file);
  for (const request of [
    { action: "ci", operation: "pause" },
    {
      action: "ci",
      operation: "reconcile",
      pr,
      head,
      receipt: { ...receipt, id: ticketId, state: "condition", endedAt: now },
      reference: "wrong watcher",
    },
  ]) {
    await assert.rejects(f.call(request), /Monitor/);
    assert.deepEqual(await readFile(f.file), bytes);
  }
  now = 90000;
  const terminal = { ...receipt, state: "condition", endedAt: 12000 };
  const done = await f.call({
    action: "ci",
    operation: "reconcile",
    pr,
    head,
    receipt: terminal,
    reference: "Monitor get host receipt",
  });
  assert.equal(done.ci.waitUsedMs, 11000);
  assert.equal(done.ci.waitRemainingMs, 1789000);
  assert.equal(done.ci.lastWatcher.id, otherId);
  assert.equal(done.ci.disposition, "paused");
  await f.call({
    action: "ci",
    operation: "observe",
    observation: {
      ...observation,
      checks: [{ name: "Tests", state: "passed" }],
    },
  });
  assert.equal((await f.status()).monitor.disposition, "passed");
});

test("CI state persists and requires an explicit, idempotent user allowance addition", async (t) => {
  const f = await fixture(t);
  await f.init();
  const watch = {
    action: "ci",
    operation: "watch",
    pr: "https://github.com/example/project/pull/1",
    head: "a".repeat(40),
    required: ["Required"],
  };
  await f.call(watch);
  await f.call({
    action: "ci",
    operation: "observe",
    observation: {
      head: watch.head,
      requirementsKnown: true,
      checks: [{ name: "Required", state: "passed" }],
      reference: "gateway check result",
    },
  });
  assert.equal((await f.status()).monitor.disposition, "passed");
  await assert.rejects(
    f.call({ action: "ci", operation: "extend", additionalMs: 60000 }),
    /scoped user override/,
  );
  const override = {
    id: "wait-more",
    requirement: "monitoring-budget",
    scope: "PR 1",
    action: "Wait another minute",
    instruction: "User authorizes another minute",
    reference: "user message",
    budget: "wait",
    additional: 60000,
  };
  await f.call({ action: "override", override });
  await f.call({ action: "override", override });
  assert.equal((await f.status()).monitor.waitLimitMs, 1860000);
});
