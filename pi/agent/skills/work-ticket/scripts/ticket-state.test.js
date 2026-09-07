import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ticketState } from "./ticket-state.js";

const ticketId = "11111111-2222-3333-4444-555555555555";
const metadataHash = `sha256:${createHash("sha256").update("Fixture PR title and body").digest("hex")}`;
const contract =
  "AC-1: preserve valid boundary input. Verify node tests. Repository example/project, base main.";
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}
async function fixture(t, pr = false) {
  const cwd = await mkdtemp(join(tmpdir(), "ticket-state-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-q", "--initial-branch=main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  await writeFile(join(cwd, "code.js"), "export const value = 1;\n");
  git(cwd, "add", "code.js");
  git(cwd, "commit", "-qm", "test: initialize fixture");
  const baseCommit = git(cwd, "rev-parse", "HEAD");
  if (pr) git(cwd, "switch", "-qc", "avery/abc-1");
  const input = {
    cwd,
    ticketId,
    identifier: "ABC-1",
    runId: "run-1",
    owner: "owner-1",
    contract,
    repository: "example/project",
    targetBranch: "main",
    baseCommit,
    authorization: {
      operations: pr ? ["implement", "commit", "publish"] : ["implement"],
      boundary: pr ? "pr" : "local",
      evidence: pr
        ? "User authorizes implementation, commits and PR delivery"
        : "User authorizes local implementation and checks",
    },
    plan: [
      {
        step: "Fix boundary behavior",
        verification: "Regression test accepts exact boundary",
        status: "in_progress",
      },
    ],
  };
  return {
    cwd,
    input,
    file: join(cwd, ".pi", "tickets", ticketId, "state.json"),
  };
}
async function init(f) {
  return ticketState({ ...f.input, action: "init" });
}
async function read(f) {
  return ticketState({
    cwd: f.cwd,
    ticketId: f.input.ticketId,
    action: "status",
  });
}
async function mutate(f, request) {
  const s = await read(f);
  return ticketState({
    cwd: f.cwd,
    ticketId: f.input.ticketId,
    runId: s.runId,
    owner: s.owner,
    expectedRevision: s.revision,
    contract: s.contract,
    ...request,
  });
}
async function snap(f) {
  return ticketState({
    cwd: f.cwd,
    ticketId: f.input.ticketId,
    action: "snapshot",
  });
}
async function checks(f) {
  return mutate(f, {
    action: "evidence",
    kind: "verification",
    fingerprint: (await snap(f)).fingerprint,
    passed: true,
    summary: "Fixture required tests passed",
  });
}
async function review(f, findings = [], resolutions = [], complete = true) {
  return mutate(f, {
    action: "review",
    fingerprint: (await snap(f)).fingerprint,
    independent: true,
    complete,
    summary: "Independent fixture review against supplied patch and AC",
    findings,
    resolutions,
  });
}
function blocker(id = "boundary") {
  return {
    id,
    blocking: true,
    category: "correctness",
    evidence:
      "code.js:1 rejects the valid boundary; focused reproduction fails",
  };
}
async function safety(f) {
  return mutate(f, {
    action: "evidence",
    kind: "safety",
    fingerprint: (await snap(f)).fingerprint,
    passed: true,
    summary:
      "Fixture observations: complete outgoing-history and PR metadata scans passed",
    historyScanned: true,
    metadataScanned: true,
    publicContentChecked: true,
    metadataHash,
  });
}
async function pr(f, draft = true) {
  const s = await snap(f);
  return {
    url: "https://github.com/example/project/pull/1",
    head: s.head,
    branch: s.branch,
    base: "main",
    draft,
    open: true,
  };
}

test("hash-bound mutation receipts support consecutive CAS writes without rereading", async (t) => {
  const f = await fixture(t);
  let s = await init(f);
  const request = {
    cwd: f.cwd,
    ticketId,
    runId: s.runId,
    owner: s.owner,
    expectedRevision: s.revision,
    contractHash: s.contractHash,
    action: "checkpoint",
    progress: "Implementation progressing",
    nextAction: "Verify",
  };
  s = await ticketState(request);
  assert.equal(s.revision, 1);
  await assert.rejects(ticketState(request), /revision conflict/);
  await assert.rejects(
    ticketState({
      ...request,
      expectedRevision: s.revision,
      contractHash: `sha256:${"0".repeat(64)}`,
    }),
    /scope drift/,
  );
  const next = await ticketState({
    ...request,
    expectedRevision: s.revision,
    action: "authorize",
    newContract: "Explicit new scope",
    authorization: {
      ...s.authorization,
      evidence: "User authorizes new scope",
    },
  });
  assert.notEqual(next.contractHash, s.contractHash);
  assert.equal(next.contract, "Explicit new scope");
  assert.deepEqual(next, await read(f));
});

test("opted-in evidence survives a content-equivalent commit, but not content, hooks, or scope changes", async (t) => {
  for (const variant of [
    "equivalent",
    "changed",
    "executable",
    "untracked",
    "scope",
    "no-opt-in",
  ]) {
    const f = await fixture(t);
    f.input.authorization.operations.push("commit");
    await init(f);
    await writeFile(join(f.cwd, "code.js"), "export const value = 2;\n");
    const verified = await mutate(f, {
      action: "evidence",
      kind: "verification",
      fingerprint: (await snap(f)).fingerprint,
      passed: true,
      summary: "Regression suite passed",
      contentIndependent: variant !== "no-opt-in",
    });
    await mutate(f, {
      action: "review",
      fingerprint: verified.snapshot.fingerprint,
      independent: true,
      complete: true,
      summary: "Independent full patch review",
      findings: [],
      resolutions: [],
      contentIndependent: true,
    });
    if (variant === "changed")
      await writeFile(join(f.cwd, "code.js"), "export const value = 3;\n");
    if (variant === "untracked")
      await writeFile(join(f.cwd, "extra.js"), "extra\n");
    if (variant === "executable") await chmod(join(f.cwd, "code.js"), 0o755);
    git(f.cwd, "add", "code.js");
    if (variant === "untracked") git(f.cwd, "add", "extra.js");
    git(f.cwd, "commit", "-qm", "test: commit verified slice");
    if (variant === "scope")
      await mutate(f, {
        action: "authorize",
        contract: "Expanded acceptance criteria",
        authorization: f.input.authorization,
      });
    const request = {
      action: "checkpoint",
      progress: "Committed verified slice",
      nextAction: "Handoff",
      reuseEvidence: {
        verification: true,
        review: true,
        justification:
          "Same check inputs, environment and patch coverage; inspected hook result",
      },
    };
    if (variant === "equivalent") {
      const s = await mutate(f, request);
      assert.equal(s.evidence.verification.fingerprint, s.snapshot.fingerprint);
      assert.equal(s.review.stale, false);
      assert.notEqual(s.snapshot.fingerprint, verified.snapshot.fingerprint);
      assert.equal(
        s.evidence.verification.reuse.fromFingerprint,
        verified.snapshot.fingerprint,
      );
      assert.equal(
        (await localHandoffWithoutChecks(f)).status,
        "local_complete",
      );
    } else {
      const bytes = await readFile(f.file, "utf8");
      await assert.rejects(mutate(f, request), /reuse requires/);
      assert.equal(await readFile(f.file, "utf8"), bytes);
      await assert.rejects(
        localHandoffWithoutChecks(f),
        /passing required checks/,
      );
    }
  }
});

test("terminal owner reconciliation preserves delivery evidence before an authorized follow-up", async (t) => {
  const f = await fixture(t);
  await init(f);
  const completed = await localHandoff(f);
  await assert.rejects(
    mutate(f, {
      action: "reconcile",
      owner: "owner-2",
      observations: "New session",
    }),
    /previous owner/,
  );
  const reconciled = await mutate(f, {
    action: "reconcile",
    owner: "owner-2",
    previousOwnerReleased: true,
    observations:
      "Prior session released; ticket, files, Git and no PR reconciled",
  });
  assert.equal(reconciled.status, "local_complete");
  assert.deepEqual(reconciled.evidence, completed.evidence);
  assert.deepEqual(reconciled.snapshot, completed.snapshot);
  assert.equal(reconciled.ownershipTransfers[0].previousOwner, "owner-1");
  await assert.rejects(
    mutate(f, {
      action: "checkpoint",
      progress: "Unsolicited edits",
      nextAction: "Continue",
    }),
    /sticky/,
  );
  const reopened = await followup(f);
  assert.equal(reopened.owner, "owner-2");
  assert.equal(reopened.status, "active");
  assert.deepEqual(reopened.localFollowups[0].evidence, completed.evidence);
});

test("new follow-up scope can add explicitly authorized repairs without resetting consumed cycles", async (t) => {
  const f = await fixture(t);
  await init(f);
  for (const name of ["first", "second"]) {
    await review(f, [blocker(name)], [], false);
    await mutate(f, {
      action: "begin_repair",
      repairPlan: "Fix actionable blocker from incomplete review",
    });
    await review(
      f,
      [],
      [
        {
          id: name,
          disposition: "fixed",
          evidence: "Independent confirmation",
        },
      ],
    );
  }
  await localHandoff(f);
  const extension = {
    cycles: 1,
    evidence:
      "User explicitly grants one additional repair batch for new follow-up scope",
  };
  await assert.rejects(
    followup(f, { newContract: contract, additionalRepairCycles: extension }),
    /new follow-up scope/,
  );
  await assert.rejects(
    followup(f, { additionalRepairCycles: { cycles: 1, evidence: "" } }),
    /authorization/,
  );
  const s = await followup(f, { additionalRepairCycles: extension });
  assert.equal(s.repairCount, 2);
  assert.equal(s.repairExtensions[0].cycles, 1);
  await review(f, [blocker("third")], [], false);
  await mutate(f, {
    action: "begin_repair",
    repairPlan: "Explicit additional batch",
  });
  const resumed = await mutate(f, {
    action: "reconcile",
    observations: "Interrupted third batch; retained all consumption",
  });
  assert.equal(resumed.repairCount, 3);
  await review(f);
  await assert.rejects(
    mutate(f, { action: "begin_repair", repairPlan: "No fourth batch" }),
    /exhausted/,
  );
  await assert.rejects(localHandoffWithoutChecks(f), /passing required checks/);
});

test("initial plan survives a fresh CLI process; exclusion is local, idempotent and preserves entries", async (t) => {
  const f = await fixture(t);
  const exclude = join(f.cwd, ".git", "info", "exclude");
  await writeFile(exclude, "# custom\nprivate-file");
  const s = await init(f);
  assert.deepEqual(s.plan, f.input.plan);
  assert.equal(s.authorization.boundary, "local");
  assert.equal("phase" in s, false);
  assert.equal(git(f.cwd, "check-ignore", "--", f.file), f.file);
  assert.equal(git(f.cwd, "ls-files", "--", ".pi/tickets"), "");
  assert.equal(
    await readFile(exclude, "utf8"),
    "# custom\nprivate-file\n/.pi/tickets/\n",
  );
  assert.equal(git(f.cwd, "status", "--porcelain"), "");
  const bytes = await readFile(f.file, "utf8");
  await assert.rejects(init(f), /already exists/);
  assert.equal(await readFile(f.file, "utf8"), bytes);
  assert.equal(
    (await readFile(exclude, "utf8")).match(/\/\.pi\/tickets\//g).length,
    1,
  );
  const process = spawnSync(
    globalThis.process.execPath,
    [join(import.meta.dirname, "ticket-state.js")],
    {
      input: JSON.stringify({ action: "status", cwd: f.cwd, ticketId }),
      encoding: "utf8",
    },
  );
  assert.equal(process.status, 0, process.stdout);
  assert.deepEqual(JSON.parse(process.stdout).result.plan, f.input.plan);
});

test("rejects missing authorization and initial working plan", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    ticketState({ ...f.input, action: "init", plan: [] }),
    /working plan/,
  );
  await assert.rejects(
    ticketState({
      ...f.input,
      action: "init",
      authorization: {
        operations: [],
        boundary: "local",
        evidence: "Ready state",
      },
    }),
    /authorized operations/,
  );
  await init(f);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "commit" }),
    /not authorized/,
  );
  await assert.rejects(
    mutate(f, { action: "gate", operation: "publish" }),
    /not authorized/,
  );
});

test("refuses force-staged ticket state and never modifies tracked gitignore", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, ".gitignore"), "node_modules/\n");
  await init(f);
  assert.equal(
    await readFile(join(f.cwd, ".gitignore"), "utf8"),
    "node_modules/\n",
  );
  git(f.cwd, "add", "-f", ".pi/tickets");
  await assert.rejects(read(f), /never be staged or tracked/);
});

test("rejects unsafe state paths and symlinked Git exclude", async (t) => {
  for (const target of [
    ".pi",
    ".pi/tickets",
    `.pi/tickets/${ticketId}`,
    ".git/info/exclude",
  ]) {
    const f = await fixture(t);
    const outside = join(f.cwd, "outside");
    if (target.endsWith("exclude")) {
      await rm(join(f.cwd, target));
      await writeFile(outside, "untouched");
    } else {
      await mkdir(outside);
      await mkdir(join(f.cwd, target, ".."), { recursive: true });
    }
    await symlink(outside, join(f.cwd, target));
    await assert.rejects(init(f), /real directory|regular file/);
  }
  const f = await fixture(t);
  await assert.rejects(
    ticketState({ ...f.input, action: "init", ticketId: "../escape" }),
    /invalid immutable/,
  );
  await assert.rejects(
    ticketState({ ...f.input, action: "init", ticketId: "ABC-1" }),
    /immutable Plane ticket UUID/,
  );
  await init(f);
  await rm(f.file);
  await symlink(join(f.cwd, "code.js"), f.file);
  await assert.rejects(read(f), /regular file/);
});

test("one writer per checkout, CAS mutations and explicit takeover survive interruption", async (t) => {
  const f = await fixture(t);
  await init(f);
  await assert.rejects(
    ticketState({
      ...f.input,
      action: "init",
      ticketId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      runId: "other-run",
    }),
    /checkout already owned/,
  );
  const before = await read(f);
  const request = {
    cwd: f.cwd,
    ticketId,
    runId: before.runId,
    owner: before.owner,
    contract,
    expectedRevision: before.revision,
    action: "checkpoint",
    progress: "Completed reproduction",
    nextAction: "Repair boundary",
  };
  const results = await Promise.allSettled([
    ticketState(request),
    ticketState(request),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(
    mutate(f, {
      action: "reconcile",
      owner: "owner-2",
      observations: "All surfaces inspected",
    }),
    /previous owner/,
  );
  const resumed = await mutate(f, {
    action: "reconcile",
    owner: "owner-2",
    previousOwnerReleased: true,
    observations:
      "Prior session absent; exact ticket, files, Git, no PR and current checks reconciled",
  });
  assert.equal(resumed.owner, "owner-2");
  assert.equal(resumed.runId, "run-1");
  assert.deepEqual(resumed.plan, f.input.plan);
  await assert.rejects(
    mutate(f, {
      action: "checkpoint",
      owner: "owner-1",
      progress: "x",
      nextAction: "y",
    }),
    /another owner/,
  );
});

test("scope drift blocks atomically; authorized baseline changes preserve plan and invalidate evidence", async (t) => {
  const f = await fixture(t);
  await init(f);
  await checks(f);
  const before = await readFile(f.file, "utf8");
  await assert.rejects(
    mutate(f, {
      action: "reconcile",
      contract: "Expanded scope",
      observations: "new ticket",
    }),
    /scope drift/,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  const s = await mutate(f, {
    action: "authorize",
    contract: "Explicitly approved expanded scope",
    authorization: {
      ...f.input.authorization,
      evidence: "User explicitly approved expanded scope",
    },
  });
  assert.equal(s.contract, "Explicitly approved expanded scope");
  assert.deepEqual(s.evidence, {});
  assert.deepEqual(s.plan, f.input.plan);
});

test("changed tracked and untracked files invalidate old evidence on resume, including same HEAD edits", async (t) => {
  const f = await fixture(t);
  await init(f);
  await checks(f);
  await review(f);
  const old = await read(f);
  await writeFile(join(f.cwd, "new-test.js"), "assertBoundary();\n");
  const s = await mutate(f, {
    action: "reconcile",
    observations: "Fresh files include untracked test; prior checks stale",
  });
  assert.equal(s.snapshot.head, old.snapshot.head);
  assert.notEqual(s.snapshot.fingerprint, old.snapshot.fingerprint);
  assert.deepEqual(s.evidence, {});
  assert.equal(s.review.stale, true);
  await assert.rejects(
    mutate(f, {
      action: "handoff",
      planeState: "In Progress",
      summary: "done",
    }),
    /passing required checks/,
  );
  await assert.rejects(
    mutate(f, {
      action: "evidence",
      kind: "verification",
      fingerprint: old.snapshot.fingerprint,
      passed: true,
      summary: "old",
    }),
    /revision mismatch/,
  );
  await checks(f);
  await writeFile(join(f.cwd, "code.js"), "export const value = 2;\n");
  assert.notEqual((await snap(f)).fingerprint, s.snapshot.fingerprint);
});

test("consolidated review repairs consume before editing, persist across processes, and never reset", async (t) => {
  const f = await fixture(t);
  await init(f);
  await checks(f);
  await review(f, [blocker()]);
  let s = await mutate(f, {
    action: "begin_repair",
    repairPlan: "Fix boundary and test original failure",
  });
  assert.equal(s.repairCount, 1);
  assert.deepEqual(s.repairs[0].findings, ["boundary"]);
  await mutate(f, {
    action: "reconcile",
    observations: "Interrupted before edits; resume recorded batch",
  });
  assert.equal((await read(f)).repairCount, 1);
  await assert.rejects(
    mutate(f, { action: "begin_repair", repairPlan: "same batch" }),
    /current consolidated review|already consumed/,
  );
  await checks(f);
  await review(f);
  s = await mutate(f, {
    action: "begin_repair",
    repairPlan: "Second consolidated repair batch",
  });
  assert.equal(s.repairCount, 2);
  await checks(f);
  s = await review(f);
  assert.equal(s.status, "blocked");
  assert.match(s.blocker, /exhausted/);
  assert.equal(s.findings[0].disposition, "open");
  await mutate(f, {
    action: "reconcile",
    observations: "Same unresolved blocker and persisted allowance",
  });
  await assert.rejects(
    mutate(f, { action: "begin_repair", repairPlan: "third" }),
    /exhausted/,
  );
  await assert.rejects(
    mutate(f, {
      action: "handoff",
      planeState: "In Progress",
      summary: "exhausted is success",
    }),
    /unresolved blockers/,
  );
  s = await mutate(f, {
    action: "authorize",
    contract,
    authorization: {
      ...f.input.authorization,
      evidence: "New authority does not reset the review-specific allowance",
    },
  });
  assert.equal(s.repairCount, 2);
});

test("unfinished authorized implementation continues from review through repair to local delivery", async (t) => {
  const f = await fixture(t);
  f.input.authorization.operations.push("commit");
  f.input.authorization.evidence =
    "User requests implementation and local commits";
  await init(f);
  await checks(f);
  await review(f, [blocker()]);
  const progress = await mutate(f, {
    action: "checkpoint",
    status: "active",
    progress:
      "Foundations implemented; review identifies unfinished boundary behavior",
    nextAction:
      "Complete authorized boundary behavior in a bounded repair batch",
  });
  assert.equal(progress.status, "active");
  assert.equal(progress.findings[0].disposition, "open");
  await assert.rejects(localHandoffWithoutChecks(f), /unresolved blockers/);

  const repair = await mutate(f, {
    action: "begin_repair",
    repairPlan: "Complete boundary behavior and verify before local delivery",
  });
  assert.equal(repair.repairCount, 1);
  assert.deepEqual(repair.authorization, progress.authorization);
  await writeFile(join(f.cwd, "code.js"), "export const value = 2;\n");
  await assert.rejects(localHandoffWithoutChecks(f), /passing required checks/);
  git(f.cwd, "add", "code.js");
  git(f.cwd, "commit", "-qm", "fix: complete fixture boundary behavior");
  await checks(f);
  await assert.rejects(
    localHandoffWithoutChecks(f),
    /unresolved blockers|incomplete review/,
  );
  await review(
    f,
    [],
    [
      {
        id: "boundary",
        disposition: "fixed",
        evidence:
          "Independent fixture confirmation of completed boundary behavior",
      },
    ],
  );
  const delivered = await localHandoffWithoutChecks(f);
  assert.equal(delivered.status, "local_complete");
  assert.equal(delivered.repairCount, 1);
  assert.equal(delivered.findings[0].disposition, "fixed");
  assert.equal(delivered.runId, progress.runId);
  assert.deepEqual(delivered.authorization, progress.authorization);
});

test("verified slices can commit before ticket completion and invalidate snapshot evidence", async (t) => {
  const f = await fixture(t);
  f.input.authorization.operations.push("commit");
  f.input.authorization.evidence =
    "User authorizes incremental local implementation commits";
  await init(f);
  for (const value of [2, 3]) {
    await writeFile(join(f.cwd, "code.js"), `export const value = ${value};\n`);
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from 'node:assert/strict'; import {value} from './code.js'; assert.equal(value, ${value});`,
      ],
      { cwd: f.cwd },
    );
    const verified = await mutate(f, {
      action: "evidence",
      kind: "verification",
      fingerprint: (await snap(f)).fingerprint,
      passed: true,
      summary: `Node assertion passed for fixture slice value ${value}; ticket work remains`,
    });
    await mutate(f, { action: "gate", operation: "commit" });
    git(f.cwd, "add", "code.js");
    git(f.cwd, "commit", "-qm", `test: retain verified fixture slice ${value}`);
    const head = git(f.cwd, "rev-parse", "HEAD");
    const progress = await mutate(f, {
      action: "checkpoint",
      status: "active",
      progress: `Committed ${head}; Node assertion verified slice value ${value}`,
      nextAction: "Continue remaining acceptance work and final review",
    });
    assert.equal(progress.snapshot.head, head);
    assert.notEqual(
      progress.snapshot.fingerprint,
      verified.snapshot.fingerprint,
    );
    assert.deepEqual(progress.evidence, {});
    assert.equal(progress.status, "active");
    assert.equal(progress.plan[0].status, "in_progress");
    assert.equal(progress.repairCount, 0);
    assert.ok(!progress.review);
    await assert.rejects(
      localHandoffWithoutChecks(f),
      /passing required checks/,
    );
    await assert.rejects(
      mutate(f, {
        action: "evidence",
        kind: "verification",
        fingerprint: verified.snapshot.fingerprint,
        passed: true,
        summary: "Cannot reuse a pre-commit fingerprint",
      }),
      /evidence revision mismatch/,
    );
  }
  assert.equal(
    git(f.cwd, "rev-list", "--count", `${f.input.baseCommit}..HEAD`),
    "2",
  );
});

test("ordinary iteration consumes no review cycles; nonblockers remain visible without repairs", async (t) => {
  const f = await fixture(t);
  await init(f);
  for (const value of [2, 3]) {
    await writeFile(join(f.cwd, "code.js"), `export const value = ${value};\n`);
    await checks(f);
  }
  await review(f, [
    {
      id: "suggestion",
      blocking: false,
      category: "style",
      evidence: "Optional naming improvement in code.js:1",
    },
  ]);
  await assert.rejects(
    mutate(f, { action: "begin_repair", repairPlan: "rename for style" }),
    /with blockers/,
  );
  const s = await mutate(f, {
    action: "handoff",
    planeState: "In Progress",
    summary: "Local checks pass; optional suggestion retained",
  });
  assert.equal(s.status, "local_complete");
  assert.equal(s.repairCount, 0);
  assert.equal(s.findings.length, 1);
  const reconciled = await mutate(f, {
    action: "reconcile",
    observations: "Inspect completed delivery without restarting",
  });
  assert.equal(reconciled.status, "local_complete");
  assert.deepEqual(reconciled.evidence, s.evidence);
});

test("review intake permits missing checks; delivery, unsupported blockers and partial resolutions remain gated", async (t) => {
  const f = await fixture(t);
  await init(f);
  await review(f, [], [], false);
  await assert.rejects(localHandoffWithoutChecks(f), /passing required checks/);
  await checks(f);
  await assert.rejects(
    review(f, [{ ...blocker(), category: "style" }]),
    /violation category/,
  );
  await review(f, [blocker()]);
  const before = await readFile(f.file, "utf8");
  await assert.rejects(
    review(
      f,
      [],
      [
        { id: "boundary", disposition: "fixed", evidence: "test passes" },
        { id: "missing", disposition: "fixed", evidence: "unknown" },
      ],
    ),
    /invalid finding resolution/,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  await review(
    f,
    [],
    [
      {
        id: "boundary",
        disposition: "fixed",
        evidence: "Independent reproduction now accepts the valid boundary",
      },
    ],
  );
  assert.equal((await read(f)).findings[0].disposition, "fixed");
});

test("PR fixture requires scans, exact identity, independent review, and exact-head CI before promotion", async (t) => {
  const f = await fixture(t, true);
  await init(f);
  await checks(f);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "publish" }),
    /safety evidence/,
  );
  await assert.rejects(
    mutate(f, {
      action: "evidence",
      kind: "safety",
      fingerprint: (await snap(f)).fingerprint,
      passed: true,
      summary: "scanner missing",
    }),
    /scans are required/,
  );
  await safety(f);
  await mutate(f, { action: "gate", operation: "publish" });
  for (const change of [
    { head: "a".repeat(40) },
    { branch: "other" },
    { base: "other" },
    { open: false },
    { draft: false },
  ]) {
    await assert.rejects(
      mutate(f, {
        action: "publication",
        pr: { ...(await pr(f)), ...change },
        confirmed: true,
        metadataHash,
      }),
      /identity mismatch|reread draft/,
    );
  }
  await mutate(f, {
    action: "publication",
    pr: await pr(f),
    confirmed: true,
    metadataHash,
  });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /independent review/,
  );
  await review(f);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /passing CI/,
  );
  await assert.rejects(
    mutate(f, {
      action: "evidence",
      kind: "ci",
      fingerprint: (await snap(f)).fingerprint,
      head: "a".repeat(40),
      passed: true,
      summary: "wrong head",
    }),
    /CI head mismatch/,
  );
  await mutate(f, {
    action: "evidence",
    kind: "ci",
    fingerprint: (await snap(f)).fingerprint,
    head: (await snap(f)).head,
    passed: false,
    summary: "pending is not passing",
  });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /passing CI/,
  );
  await mutate(f, {
    action: "evidence",
    kind: "ci",
    fingerprint: (await snap(f)).fingerprint,
    head: (await snap(f)).head,
    passed: true,
    summary: "required exact-head CI passed",
  });
  await mutate(f, { action: "gate", operation: "promote" });
  await assert.rejects(
    mutate(f, {
      action: "handoff",
      pr: await pr(f, false),
      confirmed: false,
      planeState: "Review",
      summary: "unconfirmed",
    }),
    /confirmed ready/,
  );
  const s = await mutate(f, {
    action: "handoff",
    pr: await pr(f, false),
    confirmed: true,
    planeState: "Review",
    summary: "Confirmed exact-head PR human handoff",
  });
  assert.equal(s.status, "awaiting_human");
  await assert.rejects(
    mutate(f, {
      action: "settle",
      mergedHead: s.snapshot.head,
      confirmed: true,
      planeState: "Done",
    }),
    /not authorized/,
  );
  await mutate(f, {
    action: "authorize",
    contract,
    authorization: {
      ...f.input.authorization,
      operations: [...f.input.authorization.operations, "settle"],
      evidence:
        "User separately authorizes settlement of the unchanged reviewed PR",
    },
  });
  await assert.rejects(
    mutate(f, {
      action: "gate",
      operation: "settle",
      mergedHead: s.snapshot.head,
    }),
    /confirmed reviewed merged head/,
  );
  await assert.rejects(
    mutate(f, {
      action: "external",
      operation: "settle",
      key: "merge",
      intent: "Set Done",
      outcome: "pending",
      summary: "Wrong merged head",
      mergeConfirmed: true,
      mergedHead: "a".repeat(40),
    }),
    /confirmed reviewed merged head/,
  );
  await mutate(f, {
    action: "gate",
    operation: "settle",
    mergeConfirmed: true,
    mergedHead: s.snapshot.head,
  });
  const done = await mutate(f, {
    action: "settle",
    mergeConfirmed: true,
    mergedHead: s.snapshot.head,
    confirmed: true,
    planeState: "Done",
  });
  assert.equal(done.status, "done");
});

test("external intents are durable and idempotent, not proof of remote execution", async (t) => {
  const f = await fixture(t);
  await init(f);
  const request = {
    action: "external",
    key: "claim-run-1",
    operation: "implement",
    intent: "Claim exact ticket/run and set In Progress",
    summary: "Current ticket is Draft; no matching claim exists",
  };
  await mutate(f, { ...request, outcome: "pending" });
  assert.equal((await read(f)).externalWrites[0].outcome, "pending");
  await mutate(f, {
    ...request,
    outcome: "confirmed",
    summary: "Reread exact claim and In Progress",
  });
  await mutate(f, {
    ...request,
    outcome: "confirmed",
    summary: "Reread same claim after interruption",
  });
  assert.equal((await read(f)).externalWrites.length, 1);
  await assert.rejects(
    mutate(f, { ...request, outcome: "pending" }),
    /must not be repeated/,
  );
  await assert.rejects(
    mutate(f, { ...request, outcome: "confirmed", intent: "different ticket" }),
    /conflicts/,
  );
});

test("legacy records remain byte-identical and are not parsed or used for recovery", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.cwd, ".ticket-run"));
  const legacy = join(f.cwd, ".ticket-run", "state.json");
  await writeFile(legacy, "not even valid JSON: historical state");
  await init(f);
  await mutate(f, {
    action: "reconcile",
    observations: "Only new-format state used; legacy ignored",
  });
  assert.equal(
    await readFile(legacy, "utf8"),
    "not even valid JSON: historical state",
  );
  assert.equal((await read(f)).repairCount, 0);
});

test("settlement and cleanup reject unsafe pending writes before external effects", async (t) => {
  const f = await fixture(t);
  f.input.authorization.operations.push(
    "commit",
    "settle",
    "cleanup",
    "cancel",
  );
  await init(f);
  for (const operation of ["settle", "cleanup"]) {
    await assert.rejects(
      mutate(f, { action: "gate", operation }),
      /completed delivery|settled or canceled/,
    );
    await assert.rejects(
      mutate(f, {
        action: "external",
        operation,
        key: operation,
        intent: "Change exact ticket",
        outcome: "pending",
        summary: "Authorized but still active",
      }),
      /completed delivery|settled or canceled/,
    );
  }
  assert.equal((await read(f)).externalWrites.length, 0);
  await checks(f);
  await mutate(f, {
    action: "handoff",
    planeState: "In Progress",
    summary: "Authorized local implementation complete",
  });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "commit" }),
    /handoff is sticky/,
  );
  await mutate(f, { action: "gate", operation: "settle" });
  await mutate(f, {
    action: "external",
    operation: "settle",
    key: "settle",
    intent: "Set exact ticket Done",
    outcome: "pending",
    summary: "Local completion independently observed",
  });
  await mutate(f, { action: "settle", confirmed: true, planeState: "Done" });
  const observations = {
    noLiveWriter: true,
    noUnpushedWork: true,
    prDispositionKnown: true,
    planeState: "Done",
  };
  for (const missing of Object.keys(observations)) {
    await assert.rejects(
      mutate(f, {
        action: "gate",
        operation: "cleanup",
        ...observations,
        [missing]: undefined,
      }),
      /cleanup requires clean/,
    );
  }
  await mutate(f, { action: "gate", operation: "cleanup", ...observations });
  await writeFile(join(f.cwd, "unsaved.js"), "uncommitted work");
  await assert.rejects(
    mutate(f, {
      action: "external",
      operation: "cleanup",
      key: "cleanup",
      intent: "Remove exact checkout",
      outcome: "pending",
      summary: "Dirty checkout must block",
      ...observations,
    }),
    /cleanup requires clean/,
  );
  await assert.rejects(
    mutate(f, {
      action: "cancel",
      confirmed: true,
      planeState: "Canceled",
      reason: "Cannot cancel Done",
    }),
    /cannot be canceled/,
  );
});

async function localHandoff(f) {
  await checks(f);
  return mutate(f, {
    action: "handoff",
    planeState: "In Progress",
    summary: "Verified local delivery retained for the user",
  });
}
async function followup(f, overrides = {}) {
  return mutate(f, {
    action: "reopen_local",
    newContract: `${contract} Explicitly requested local follow-up.`,
    authorization: {
      operations: ["implement", "commit"],
      boundary: "local",
      evidence:
        "User explicitly requested follow-up changes and a local commit after handoff",
    },
    plan: [
      {
        step: "Implement follow-up",
        verification: "New regression tests",
        status: "todo",
      },
    ],
    observations:
      "Fresh ticket/files/Git/checks/owner inspection; same sole writer, Plane In Progress, no PR or pending effects",
    planeState: "In Progress",
    noPrConfirmed: true,
    fingerprint: (await snap(f)).fingerprint,
    ...overrides,
  });
}

test("explicit local follow-up retains delivery history and repair consumption but requires fresh evidence", async (t) => {
  const f = await fixture(t);
  await init(f);
  await checks(f);
  await review(f, [blocker()]);
  await mutate(f, {
    action: "begin_repair",
    repairPlan: "Fix original blocker",
  });
  await checks(f);
  await review(
    f,
    [],
    [
      {
        id: "boundary",
        disposition: "fixed",
        evidence: "Independent regression confirms repair",
      },
    ],
  );
  await mutate(f, {
    action: "external",
    operation: "implement",
    key: "claim",
    intent: "Claim exact ticket/run",
    outcome: "confirmed",
    summary: "Claim reread",
  });
  const old = await localHandoff(f);
  const s = await followup(f);
  assert.equal(s.status, "active");
  assert.equal(s.revision, old.revision + 1);
  for (const key of [
    "runId",
    "owner",
    "assignment",
    "findings",
    "repairs",
    "repairCount",
    "externalWrites",
  ])
    assert.deepEqual(s[key], old[key]);
  assert.equal(s.repairCount, 1);
  assert.equal(s.localFollowups.length, 1);
  for (const key of [
    "revision",
    "owner",
    "contract",
    "authorization",
    "plan",
    "progress",
    "snapshot",
    "evidence",
    "review",
    "findings",
    "repairCount",
  ])
    assert.deepEqual(s.localFollowups[0][key], old[key]);
  assert.deepEqual(s.evidence, {});
  assert.equal(s.review.stale, true);
  assert.notEqual(s.contract, old.contract);
  await assert.rejects(localHandoffWithoutChecks(f), /passing required checks/);
  for (const operation of ["publish", "settle", "cancel", "cleanup"])
    await assert.rejects(
      mutate(f, { action: "gate", operation }),
      /not authorized/,
    );
  await mutate(f, { action: "gate", operation: "commit" });
  await checks(f);
  await assert.rejects(localHandoffWithoutChecks(f), /incomplete review/);
  await review(f, [blocker("followup")]);
  await mutate(f, {
    action: "begin_repair",
    repairPlan: "Use remaining cycle",
  });
  assert.equal((await read(f)).repairCount, 2);
  await checks(f);
  await review(
    f,
    [],
    [
      {
        id: "followup",
        disposition: "fixed",
        evidence: "Focused confirmation passes",
      },
    ],
  );
  const second = await localHandoff(f);
  await writeFile(join(f.cwd, "unrelated.txt"), "Preserve unrelated user work");
  const reopened = await followup(f);
  assert.equal(reopened.localFollowups.length, 2);
  assert.deepEqual(reopened.localFollowups[0], s.localFollowups[0]);
  assert.deepEqual(reopened.localFollowups[1].evidence, second.evidence);
  assert.deepEqual(reopened.localFollowups[1].snapshot, second.snapshot);
  assert.notEqual(reopened.snapshot.fingerprint, second.snapshot.fingerprint);
  assert.equal(
    await readFile(join(f.cwd, "unrelated.txt"), "utf8"),
    "Preserve unrelated user work",
  );
  await checks(f);
  await review(f, [blocker("third")]);
  await assert.rejects(
    mutate(f, { action: "begin_repair", repairPlan: "Cannot refund budget" }),
    /exhausted/,
  );
});

async function localHandoffWithoutChecks(f) {
  return mutate(f, {
    action: "handoff",
    planeState: "In Progress",
    summary: "Attempt handoff",
  });
}

test("local reopen rejects invalid authority, stale requests and owner/scope conflicts atomically", async (t) => {
  const f = await fixture(t);
  await init(f);
  await localHandoff(f);
  const old = await read(f);
  const bytes = await readFile(f.file, "utf8");
  for (const overrides of [
    { authorization: undefined },
    {
      authorization: {
        operations: ["implement"],
        boundary: "local",
        evidence: "",
      },
    },
    ...["publish", "settle", "cancel", "cleanup"].map((op) => ({
      authorization: {
        operations: ["implement", op],
        boundary: "local",
        evidence: "New request",
      },
    })),
    {
      authorization: {
        operations: ["implement", "commit", "publish"],
        boundary: "pr",
        evidence: "PR request",
      },
    },
    { expectedRevision: old.revision - 1 },
    { runId: "other-run" },
    { owner: "other-owner", previousOwnerReleased: true },
    { contract: "Wrong prior baseline" },
    { newContract: "" },
    { plan: [] },
    { observations: "" },
    { noPrConfirmed: false },
    { planeState: "Done" },
    { fingerprint: `sha256:${"0".repeat(64)}` },
  ]) {
    await assert.rejects(followup(f, overrides));
    assert.equal(await readFile(f.file, "utf8"), bytes);
  }
  await mutate(f, {
    action: "authorize",
    authorization: f.input.authorization,
  });
  assert.equal((await read(f)).status, "local_complete");
  for (const action of ["checkpoint"])
    await assert.rejects(
      mutate(f, { action, observations: "No implicit restart" }),
      /sticky/,
    );
  await followup(f, {
    authorization: {
      ...f.input.authorization,
      evidence: "User requested follow-up without commits",
    },
  });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "commit" }),
    /not authorized/,
  );
  await assert.rejects(followup(f), /requires local completion/);
});

test("local follow-up invalidates evidence even with identical scope and snapshot", async (t) => {
  const f = await fixture(t);
  await init(f);
  await checks(f);
  await review(f);
  const old = await localHandoff(f);
  const s = await followup(f, { newContract: old.contract });
  assert.equal(s.contract, old.contract);
  assert.deepEqual(s.snapshot, old.snapshot);
  assert.deepEqual(s.evidence, {});
  assert.equal(s.review.stale, true);
  assert.deepEqual(s.localFollowups[0].evidence, old.evidence);
  assert.deepEqual(s.localFollowups[0].review, old.review);
  await assert.rejects(localHandoffWithoutChecks(f), /passing required checks/);
});

test("local reopen cannot steal a checkout released to another ticket", async (t) => {
  const f = await fixture(t);
  await init(f);
  await localHandoff(f);
  const bytes = await readFile(f.file, "utf8");
  await ticketState({
    ...f.input,
    action: "init",
    ticketId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    runId: "other-run",
  });
  await assert.rejects(followup(f), /checkout already owned/);
  assert.equal(await readFile(f.file, "utf8"), bytes);
});

test("local reopen preserves stronger PR and settlement safeguards and unresolved effects", async (t) => {
  for (const variant of [
    "active",
    "awaiting_human",
    "done",
    "canceled",
    "pr",
    "pending",
    "external-settle",
  ]) {
    const f = await fixture(
      t,
      variant === "awaiting_human" || variant === "pr",
    );
    f.input.authorization.operations.push("settle", "cancel");
    await init(f);
    if (["awaiting_human", "pr"].includes(variant)) {
      await checks(f);
      await safety(f);
      await mutate(f, {
        action: "publication",
        pr: await pr(f),
        confirmed: true,
        metadataHash,
      });
      await review(f);
      await mutate(f, {
        action: "evidence",
        kind: "ci",
        fingerprint: (await snap(f)).fingerprint,
        head: (await snap(f)).head,
        passed: true,
        summary: "Exact head checks pass",
      });
      if (variant === "pr") {
        await mutate(f, {
          action: "authorize",
          authorization: { ...f.input.authorization, boundary: "local" },
        });
        await checks(f);
        await review(f);
        await localHandoff(f);
      } else {
        await mutate(f, {
          action: "handoff",
          pr: await pr(f, false),
          confirmed: true,
          planeState: "Review",
          summary: "PR ready",
        });
      }
    } else if (variant !== "active") {
      if (variant === "pending")
        await mutate(f, {
          action: "external",
          operation: "implement",
          key: "claim",
          intent: "Claim ticket",
          outcome: "pending",
          summary: "Unresolved claim",
        });
      await localHandoff(f);
      if (variant === "external-settle")
        await mutate(f, {
          action: "external",
          operation: "settle",
          key: "settle",
          intent: "Set Done",
          outcome: "pending",
          summary: "Not yet confirmed",
        });
      if (variant === "done")
        await mutate(f, {
          action: "settle",
          planeState: "Done",
          confirmed: true,
        });
      if (variant === "canceled")
        await mutate(f, {
          action: "cancel",
          planeState: "Canceled",
          confirmed: true,
          reason: "User canceled",
        });
    }
    const bytes = await readFile(f.file, "utf8");
    await assert.rejects(
      followup(f),
      /requires local completion|external history/,
    );
    assert.equal(await readFile(f.file, "utf8"), bytes);
  }
});

async function publicationFixture(t) {
  const f = await fixture(t, true);
  f.input.authorization = {
    operations: ["implement", "commit"],
    boundary: "local",
    evidence: "Original local implementation and commit request",
  };
  await init(f);
  return f;
}
async function beginPr(f, overrides = {}) {
  return mutate(f, {
    action: "begin_pr",
    publicationEvidence:
      "User: LGTM, push and open PR, then monitor required CI",
    fingerprint: (await snap(f)).fingerprint,
    observations:
      "Same sole owner, unchanged scope/files/head/checks; fresh Plane In Progress and no PR or unresolved effects",
    planeState: "In Progress",
    noPrConfirmed: true,
    ...overrides,
  });
}

test("completed local delivery can publish with exhausted repairs, preserving history and all publication gates", async (t) => {
  const f = await publicationFixture(t);
  await localHandoff(f);
  await followup(f);
  for (const id of ["first", "second"]) {
    await checks(f);
    await review(f, [blocker(id)]);
    await mutate(f, { action: "begin_repair", repairPlan: `Fix ${id}` });
    await checks(f);
    await review(
      f,
      [],
      [
        {
          id,
          disposition: "fixed",
          evidence: "Independent confirmation passes",
        },
      ],
    );
  }
  await mutate(f, {
    action: "external",
    operation: "implement",
    key: "claim",
    intent: "Claim exact ticket",
    outcome: "confirmed",
    summary: "Reread claim",
  });
  const old = await localHandoff(f);
  assert.equal(old.repairCount, 2);
  const s = await beginPr(f);
  assert.equal(s.status, "active");
  assert.equal(s.revision, old.revision + 1);
  assert.deepEqual(s.authorization, {
    operations: ["implement", "commit", "publish"],
    boundary: "pr",
    evidence: "User: LGTM, push and open PR, then monitor required CI",
  });
  for (const key of [
    "runId",
    "owner",
    "contract",
    "assignment",
    "plan",
    "findings",
    "repairs",
    "repairCount",
    "externalWrites",
    "localFollowups",
    "snapshot",
  ])
    assert.deepEqual(s[key], old[key]);
  for (const key of [
    "revision",
    "authorization",
    "progress",
    "evidence",
    "review",
    "findings",
    "repairCount",
  ])
    assert.deepEqual(s.prDelivery[key], old[key]);
  assert.deepEqual(s.evidence, {});
  assert.equal(s.review.stale, true);
  await assert.rejects(beginPr(f), /requires local completion/);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "publish" }),
    /passing required checks/,
  );
  await checks(f);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /safety evidence/,
  );
  await review(f);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "publish" }),
    /safety evidence/,
  );
  await safety(f);
  await mutate(f, { action: "gate", operation: "publish" });
  const intent = {
    action: "external",
    operation: "publish",
    key: "publish-head",
    intent: "Push assigned branch and create draft PR",
    summary: "Exact observed publication state",
  };
  await mutate(f, { ...intent, outcome: "pending" });
  await mutate(f, {
    action: "reconcile",
    observations:
      "Interrupted publication; reread exact remote state before confirming",
  });
  await mutate(f, { ...intent, outcome: "confirmed" });
  await assert.rejects(
    mutate(f, { ...intent, outcome: "pending" }),
    /must not be repeated/,
  );
  await assert.rejects(
    mutate(f, {
      action: "publication",
      pr: { ...(await pr(f)), head: "a".repeat(40) },
      confirmed: true,
      metadataHash,
    }),
    /identity mismatch/,
  );
  await assert.rejects(
    mutate(f, {
      action: "publication",
      pr: await pr(f),
      confirmed: true,
      metadataHash: `sha256:${"0".repeat(64)}`,
    }),
    /scanned metadata/,
  );
  await mutate(f, {
    action: "publication",
    pr: await pr(f),
    confirmed: true,
    metadataHash,
  });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /passing CI/,
  );
  const ci = {
    action: "evidence",
    kind: "ci",
    fingerprint: (await snap(f)).fingerprint,
    head: (await snap(f)).head,
    summary: "Required exact-head CI observed",
  };
  await assert.rejects(
    mutate(f, { ...ci, head: "a".repeat(40), passed: true }),
    /CI head mismatch/,
  );
  await mutate(f, { ...ci, passed: false });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /passing CI/,
  );
  await mutate(f, { ...ci, passed: true });
  await mutate(f, { action: "gate", operation: "promote" });
  await review(f, [blocker("publication-blocker")]);
  await assert.rejects(
    mutate(f, {
      action: "begin_repair",
      repairPlan: "Cannot consume a third cycle",
    }),
    /exhausted/,
  );
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /independent review/,
  );
  await review(
    f,
    [],
    [
      {
        id: "publication-blocker",
        disposition: "not-applicable",
        evidence:
          "Independent reproduction demonstrates the reported violation does not apply",
      },
    ],
  );
  const delivered = await mutate(f, {
    action: "handoff",
    pr: await pr(f, false),
    confirmed: true,
    planeState: "Review",
    summary: "Exact-head human review handoff",
  });
  assert.equal(delivered.status, "awaiting_human");
  assert.equal(delivered.repairCount, 2);
  assert.deepEqual(delivered.prDelivery, s.prDelivery);
  for (const operation of ["settle", "cancel", "cleanup"])
    await assert.rejects(
      mutate(f, { action: "gate", operation }),
      /not authorized/,
    );
  await assert.rejects(beginPr(f), /requires local completion/);
});

test("begin_pr drops stale publication evidence and unrelated authority without faking a coding request", async (t) => {
  const f = await publicationFixture(t);
  await checks(f);
  await mutate(f, {
    action: "authorize",
    authorization: {
      operations: [
        "implement",
        "commit",
        "publish",
        "settle",
        "cancel",
        "cleanup",
      ],
      boundary: "local",
      evidence: "Prior separately authorized operations",
    },
  });
  await safety(f);
  const old = await localHandoff(f);
  await mutate(f, {
    action: "authorize",
    authorization: {
      ...old.authorization,
      boundary: "pr",
      evidence: "User requests PR publication",
    },
  });
  assert.equal((await read(f)).status, "local_complete");
  await assert.rejects(
    mutate(f, { action: "gate", operation: "publish" }),
    /sticky/,
  );
  const s = await beginPr(f);
  assert.deepEqual(s.prDelivery.evidence.safety, old.evidence.safety);
  assert.equal(s.evidence.safety, undefined);
  assert.equal(s.evidence.ci, undefined);
  assert.equal(s.review, null);
  await checks(f);
  await safety(f);
  await mutate(f, {
    action: "publication",
    pr: await pr(f),
    confirmed: true,
    metadataHash,
  });
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /independent review/,
  );
  for (const operation of ["settle", "cancel", "cleanup"])
    await assert.rejects(
      mutate(f, { action: "gate", operation }),
      /not authorized/,
    );
  await review(f);
  await writeFile(join(f.cwd, "code.js"), "export const value = 2;\n");
  await assert.rejects(
    mutate(f, { action: "gate", operation: "publish" }),
    /passing required checks/,
  );
  await mutate(f, {
    action: "reconcile",
    observations: "Unexpected code drift; checks/review no longer current",
  });
  assert.deepEqual((await read(f)).evidence, {});
  assert.equal((await read(f)).review.stale, true);
});

test("begin_pr rejects missing consent, stale CAS/scope/snapshot, dirty checkout and wrong owner atomically", async (t) => {
  const f = await publicationFixture(t);
  const old = await localHandoff(f);
  const bytes = await readFile(f.file, "utf8");
  for (const overrides of [
    { publicationEvidence: undefined },
    { publicationEvidence: "" },
    { observations: "" },
    { noPrConfirmed: false },
    { planeState: "Done" },
    { expectedRevision: old.revision - 1 },
    { runId: "wrong-run" },
    { owner: "other-owner", previousOwnerReleased: true },
    { contract: "Expanded scope" },
    { fingerprint: `sha256:${"0".repeat(64)}` },
  ]) {
    await assert.rejects(beginPr(f, overrides));
    assert.equal(await readFile(f.file, "utf8"), bytes);
  }
  await writeFile(join(f.cwd, "unrelated.txt"), "Unrelated user work");
  await assert.rejects(beginPr(f), /unchanged completed snapshot/);
  assert.equal(await readFile(f.file, "utf8"), bytes);
  assert.equal(
    await readFile(join(f.cwd, "unrelated.txt"), "utf8"),
    "Unrelated user work",
  );
  git(f.cwd, "add", "unrelated.txt");
  git(f.cwd, "commit", "-qm", "test: change head after completion");
  await assert.rejects(beginPr(f), /unchanged completed snapshot/);
  assert.equal(await readFile(f.file, "utf8"), bytes);
});

test("terminal authorize cannot retroactively grant delivery-time commit authority", async (t) => {
  for (const legacy of [false, true]) {
    const f = await publicationFixture(t);
    await mutate(f, {
      action: "authorize",
      authorization: { ...f.input.authorization, operations: ["implement"] },
    });
    const completed = await localHandoff(f);
    if (legacy) {
      const stored = JSON.parse(await readFile(f.file, "utf8"));
      delete stored.completionAuthorization;
      await writeFile(f.file, JSON.stringify(stored));
    }
    const authorized = await mutate(f, {
      action: "authorize",
      authorization: {
        operations: ["implement", "commit", "publish"],
        boundary: "pr",
        evidence: "Later authority does not rewrite local delivery",
      },
    });
    assert.deepEqual(
      authorized.completionAuthorization,
      completed.authorization,
    );
    const bytes = await readFile(f.file, "utf8");
    await assert.rejects(beginPr(f), /authority at local completion/);
    assert.equal(await readFile(f.file, "utf8"), bytes);
  }
});

test("legacy completion retains original authorization across later PR authorization and archives both", async (t) => {
  const f = await publicationFixture(t);
  const completed = await localHandoff(f);
  const stored = JSON.parse(await readFile(f.file, "utf8"));
  delete stored.completionAuthorization;
  await writeFile(f.file, JSON.stringify(stored));
  const updated = await mutate(f, {
    action: "authorize",
    authorization: {
      operations: ["implement", "commit", "publish"],
      boundary: "pr",
      evidence: "User later requested publication",
    },
  });
  assert.deepEqual(updated.completionAuthorization, completed.authorization);
  const s = await beginPr(f);
  assert.deepEqual(
    s.prDelivery.completionAuthorization,
    completed.authorization,
  );
  assert.deepEqual(s.prDelivery.authorization, updated.authorization);
  assert.deepEqual(s.completionAuthorization, completed.authorization);
});

test("begin_pr retains one-writer, branch and terminal lifecycle exclusions", async (t) => {
  for (const variant of [
    "active",
    "done",
    "canceled",
    "pending",
    "confirmed-settle",
    "other-ticket",
    "target-branch",
    "branch-drift",
    "no-commit",
    "scope-drift",
    "recorded-pr",
  ]) {
    const f = await publicationFixture(t);
    await mutate(f, {
      action: "authorize",
      authorization: {
        ...f.input.authorization,
        operations: ["implement", "commit", "settle", "cancel", "publish"],
      },
    });
    if (variant === "pending")
      await mutate(f, {
        action: "external",
        operation: "implement",
        key: "claim",
        intent: "Claim",
        outcome: "pending",
        summary: "Unconfirmed",
      });
    if (variant === "recorded-pr") {
      await checks(f);
      await mutate(f, {
        action: "authorize",
        authorization: {
          ...f.input.authorization,
          operations: ["implement", "commit", "publish"],
          boundary: "pr",
        },
      });
      await checks(f);
      await safety(f);
      await mutate(f, {
        action: "publication",
        pr: await pr(f),
        confirmed: true,
        metadataHash,
      });
      await mutate(f, {
        action: "authorize",
        authorization: f.input.authorization,
      });
    }
    if (variant !== "active") await localHandoff(f);
    if (variant === "done")
      await mutate(f, {
        action: "settle",
        planeState: "Done",
        confirmed: true,
      });
    if (variant === "canceled")
      await mutate(f, {
        action: "cancel",
        planeState: "Canceled",
        confirmed: true,
        reason: "User canceled",
      });
    if (variant === "confirmed-settle")
      await mutate(f, {
        action: "external",
        operation: "settle",
        key: "settle",
        intent: "Set Done",
        outcome: "confirmed",
        summary: "Reread effect",
      });
    if (variant === "other-ticket")
      await ticketState({
        ...f.input,
        action: "init",
        ticketId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        runId: "other-run",
      });
    if (variant === "target-branch")
      git(f.cwd, "branch", "-m", "main", "old-main");
    if (variant === "target-branch") git(f.cwd, "branch", "-m", "main");
    if (variant === "branch-drift") git(f.cwd, "switch", "-qc", "avery/other");
    if (variant === "no-commit")
      await mutate(f, {
        action: "authorize",
        authorization: { ...f.input.authorization, operations: ["implement"] },
      });
    if (variant === "scope-drift") {
      const bytes = await readFile(f.file, "utf8");
      await assert.rejects(
        mutate(f, {
          action: "authorize",
          contract: "Different approved scope",
          authorization: f.input.authorization,
        }),
        /explicitly authorized follow-up/,
      );
      assert.equal(await readFile(f.file, "utf8"), bytes);
      continue;
    }
    const bytes = await readFile(f.file, "utf8");
    await assert.rejects(beginPr(f));
    assert.equal(await readFile(f.file, "utf8"), bytes);
  }
});

test("malformed scanned metadata digest is rejected atomically", async (t) => {
  const f = await fixture(t, true);
  await init(f);
  await checks(f);
  const before = await readFile(f.file, "utf8");
  await assert.rejects(
    mutate(f, {
      action: "evidence",
      kind: "safety",
      fingerprint: (await snap(f)).fingerprint,
      passed: true,
      summary: "Scan result",
      historyScanned: true,
      metadataScanned: true,
      publicContentChecked: true,
      metadataHash: "sha256:metadata",
    }),
    /SHA-256 digest/,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  await safety(f);
  await assert.rejects(
    mutate(f, {
      action: "publication",
      pr: await pr(f),
      confirmed: true,
      metadataHash: `sha256:${"0".repeat(64)}`,
    }),
    /scanned metadata/,
  );
});

async function publishedFixture(f, complete = false) {
  await init(f);
  await checks(f);
  await safety(f);
  await mutate(f, {
    action: "publication",
    pr: await pr(f),
    confirmed: true,
    metadataHash,
  });
  await review(f, [], [], complete);
  await mutate(f, {
    action: "evidence",
    kind: "ci",
    fingerprint: (await snap(f)).fingerprint,
    head: (await snap(f)).head,
    passed: true,
    summary: "27 exact-head CI checks passed",
  });
  if (complete)
    await mutate(f, {
      action: "handoff",
      pr: await pr(f, false),
      confirmed: true,
      planeState: "Review",
      summary: "Reviewed delivery",
    });
}
async function acceptanceRequest(f, waivedPrerequisites, successor) {
  const s = await read(f);
  return {
    action: "accept_merged",
    acceptance: {
      source: "user",
      instruction: "Accept the merged review exception; settle this delivery",
      reference: "current user message",
      ticketId: s.ticketId,
      runId: s.runId,
      acceptMerged: true,
      waivedPrerequisites,
    },
    pr: { ...(await pr(f)), merged: true },
    mergeConfirmed: true,
    mergeEvidence: "Broker reread exact merged source head and PR identity",
    noLiveWriter: true,
    ...(successor ? { successor } : {}),
  };
}
async function settleAccepted(f) {
  const s = await read(f);
  const observations = {
    mergeConfirmed: true,
    mergedHead: s.humanAcceptance.pr.head,
    prUrl: s.humanAcceptance.pr.url,
  };
  await mutate(f, {
    action: "external",
    operation: "settle",
    key: "plane-done",
    intent: "Set exact ticket Done",
    outcome: "pending",
    summary: "Reread Plane before effect",
    ...observations,
  });
  await mutate(f, {
    action: "external",
    operation: "settle",
    key: "plane-done",
    intent: "Set exact ticket Done",
    outcome: "confirmed",
    summary: "Reread Plane Done",
    ...observations,
  });
  return mutate(f, {
    action: "settle",
    confirmed: true,
    planeState: "Done",
    ...observations,
  });
}

test("human acceptance preserves incomplete review, open findings and consumed repairs without reopening publication", async (t) => {
  const f = await fixture(t, true);
  await publishedFixture(f);
  await review(f, [blocker()], [], true);
  await mutate(f, {
    action: "begin_repair",
    repairPlan: "Retained historical repair",
  });
  await checks(f);
  await review(f, [], [], false);
  await mutate(f, {
    action: "checkpoint",
    status: "blocked",
    blocker: "Historical review qualifications",
    progress: "Human merged",
    nextAction: "Reconcile disposition",
  });
  const before = await read(f);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "settle" }),
    /not authorized/,
  );
  const request = await acceptanceRequest(f, [
    "completed-delivery",
    "independent-review",
  ]);
  const accepted = await mutate(f, request);
  for (const field of [
    "status",
    "snapshot",
    "evidence",
    "review",
    "findings",
    "repairCount",
    "repairs",
    "pr",
    "contract",
    "authorization",
    "externalWrites",
  ])
    assert.deepEqual(accepted[field], before[field], field);
  assert.equal(accepted.review.complete, false);
  assert.equal(accepted.findings[0].disposition, "open");
  assert.equal(accepted.repairCount, 1);
  await assert.rejects(
    mutate(f, { action: "gate", operation: "promote" }),
    /settlement\/cleanup only/,
  );
  await assert.rejects(mutate(f, request), /already disposed/);
  await assert.rejects(
    mutate(f, {
      action: "settle",
      mergeConfirmed: true,
      mergedHead: "a".repeat(40),
      prUrl: before.pr.url,
      confirmed: true,
      planeState: "Done",
    }),
    /exact confirmed merged/,
  );
  const done = await settleAccepted(f);
  assert.equal(done.status, "done");
  for (const field of [
    "review",
    "findings",
    "repairs",
    "evidence",
    "pr",
    "contract",
  ])
    assert.deepEqual(done[field], before[field], field);
});

test("missing, external, ambiguous and mismatched acceptance fail atomically", async (t) => {
  const f = await fixture(t, true);
  await publishedFixture(f);
  const valid = await acceptanceRequest(f, [
    "completed-delivery",
    "independent-review",
  ]);
  const bytes = await readFile(f.file, "utf8");
  for (const change of [
    { acceptance: undefined },
    { acceptance: { ...valid.acceptance, source: "ticket" } },
    { acceptance: { ...valid.acceptance, instruction: "" } },
    { acceptance: { ...valid.acceptance, reference: "" } },
    { acceptance: { ...valid.acceptance, acceptMerged: false } },
    { acceptance: { ...valid.acceptance, runId: "other" } },
    {
      acceptance: {
        ...valid.acceptance,
        ticketId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
    },
    { acceptance: { ...valid.acceptance, waivedPrerequisites: [] } },
    { pr: { ...valid.pr, url: "https://github.com/example/project/pull/9" } },
    { pr: { ...valid.pr, head: "a".repeat(40) } },
    { pr: { ...valid.pr, base: "other" } },
    { mergeConfirmed: false },
    { noLiveWriter: false },
  ]) {
    await assert.rejects(mutate(f, { ...valid, ...change }));
    assert.equal(await readFile(f.file, "utf8"), bytes);
  }
});

async function sharedMergedFixture(t) {
  const first = await fixture(t, true);
  first.input.authorization.operations.push("settle", "cleanup");
  await publishedFixture(first, true);
  const prior = await read(first);
  await writeFile(join(first.cwd, "code.js"), "export const value = 2;\n");
  git(first.cwd, "add", "code.js");
  git(first.cwd, "commit", "-qm", "fix: authorized successor");
  const secondId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const second = {
    ...first,
    file: join(first.cwd, ".pi", "tickets", secondId, "state.json"),
    input: {
      ...first.input,
      ticketId: secondId,
      identifier: "ABC-2",
      runId: "run-2",
      owner: "owner-2",
    },
  };
  await publishedFixture(second);
  await mutate(second, {
    action: "checkpoint",
    status: "blocked",
    blocker: "Cleanup failed before settlement",
    progress: "Merged; Plane Done observed",
    nextAction: "Record acceptance",
  });
  return { first, second, prior };
}

test("shared PR supersession binds successor identity without rebinding old verification or inventing transitions", async (t) => {
  const { first, second, prior } = await sharedMergedFixture(t);
  await assert.rejects(
    mutate(first, {
      action: "gate",
      operation: "settle",
      mergeConfirmed: true,
      mergedHead: (await snap(first)).head,
    }),
    /passing required checks/,
  );
  const successor = {
    ticketId: second.input.ticketId,
    runId: second.input.runId,
    priorHead: prior.pr.head,
    mergedHead: (await snap(first)).head,
    authorizationEvidence:
      "User explicitly authorized successor on the same PR",
  };
  const request = await acceptanceRequest(
    first,
    [
      "required-checks",
      "independent-review",
      "published-head",
      "delivery-snapshot",
    ],
    successor,
  );
  for (const change of [
    { successor: undefined },
    { successor: { ...successor, runId: "wrong" } },
    { successor: { ...successor, authorizationEvidence: "" } },
  ])
    await assert.rejects(mutate(first, { ...request, ...change }));
  const accepted = await mutate(first, request);
  assert.deepEqual(accepted.pr, prior.pr);
  assert.deepEqual(accepted.evidence, prior.evidence);
  assert.deepEqual(accepted.snapshot, prior.snapshot);
  assert.equal(accepted.status, "awaiting_human");
  await settleAccepted(first);
  const secondBefore = await read(second);
  await mutate(
    second,
    await acceptanceRequest(second, [
      "completed-delivery",
      "independent-review",
    ]),
  );
  await settleAccepted(second);
  assert.deepEqual((await read(second)).review, secondBefore.review);
  assert.equal((await read(first)).status, "done");
  assert.equal((await read(second)).status, "done");
});

async function cleanupRequest(t, fixtures) {
  const archiveDir = await mkdtemp(join(tmpdir(), "ticket-cleanup-"));
  t.after(() => rm(archiveDir, { recursive: true, force: true }));
  return {
    action: "prepare_cleanup",
    archiveDir,
    cleanupId: "cleanup-1",
    key: "remove-shared-checkout",
    intent:
      "Remove exact fixture checkout/workspace without force; retain branch",
    cleanupAuthorization: {
      source: "user",
      removeCheckout: true,
      instruction: "Cleanup these settled tickets",
      reference: "fresh user message",
    },
    tickets: await Promise.all(
      fixtures.map(async (f) => {
        const s = await read(f);
        return {
          ticketId: s.ticketId,
          runId: s.runId,
          owner: s.owner,
          expectedRevision: s.revision,
          contractHash: `sha256:${createHash("sha256").update(s.contract).digest("hex")}`,
          planeState: "Done",
        };
      }),
    ),
    noLiveWriter: true,
    noUnpushedWork: true,
    prDispositionKnown: true,
    noUniqueIgnoredWork: true,
    evidencePreserved: true,
    safetyEvidence:
      "Fresh process inventory, clean Git, retained merged head, no unique ignored data, all PR/Plane dispositions reread",
  };
}
function journalRequest(j, archiveDir, action) {
  return {
    action,
    archiveDir,
    cleanupId: j.cleanupId,
    expectedRevision: j.revision,
    key: j.key,
    intent: j.intent,
    identities: j.records.map((s) => ({
      ticketId: s.ticketId,
      runId: s.runId,
      owner: s.owner,
    })),
  };
}
async function settledLocal(t) {
  const f = await fixture(t);
  f.input.authorization.operations.push("settle", "cleanup");
  await init(f);
  await checks(f);
  await mutate(f, {
    action: "handoff",
    planeState: "In Progress",
    summary: "Complete",
  });
  await mutate(f, { action: "settle", planeState: "Done", confirmed: true });
  return f;
}

test("durable cleanup preserves every shared ticket and confirms after source checkout disappears", async (t) => {
  const { first, second, prior } = await sharedMergedFixture(t);
  await mutate(
    first,
    await acceptanceRequest(
      first,
      [
        "required-checks",
        "independent-review",
        "published-head",
        "delivery-snapshot",
      ],
      {
        ticketId: second.input.ticketId,
        runId: second.input.runId,
        priorHead: prior.pr.head,
        mergedHead: (await snap(first)).head,
        authorizationEvidence: "Explicit successor authorization",
      },
    ),
  );
  await settleAccepted(first);
  await mutate(
    second,
    await acceptanceRequest(second, [
      "completed-delivery",
      "independent-review",
    ]),
  );
  await settleAccepted(second);
  const request = await cleanupRequest(t, [first, second]);
  const handoff = join(
    first.cwd,
    ".pi",
    "tickets",
    first.input.ticketId,
    "handoff.md",
  );
  await writeFile(handoff, "Retained recovery evidence\n");
  const bytes = await readFile(first.file);
  await assert.rejects(
    mutate(first, { ...request, tickets: request.tickets.slice(0, 1) }),
    /identity mismatch/,
  );
  const j = await mutate(first, request);
  assert.equal(j.records.length, 2);
  assert.deepEqual(await readFile(first.file), bytes);
  const handoffFile = j.files.find((file) => file.path.endsWith("handoff.md"));
  assert.equal(
    await readFile(
      join(request.archiveDir, "evidence", handoffFile.digest.slice(7)),
      "utf8",
    ),
    "Retained recovery evidence\n",
  );
  await assert.rejects(mutate(first, request), /reread before retry/);
  await assert.rejects(
    ticketState({
      ...journalRequest(j, request.archiveDir, "cleanup_confirm"),
      removed: true,
      inventoryEvidence: "Not removed",
    }),
    /checkout absence/,
  );
  // Simulate removal only inside an isolated temporary fixture, never a live worktree.
  await rm(first.cwd, { recursive: true });
  const reread = await ticketState({
    action: "cleanup_status",
    archiveDir: request.archiveDir,
    cleanupId: j.cleanupId,
  });
  assert.equal(reread.outcome, "pending");
  const confirmed = await ticketState({
    ...journalRequest(reread, request.archiveDir, "cleanup_confirm"),
    removed: true,
    inventoryEvidence:
      "Fresh inventory has no fixture workspace or worktree; path absent",
  });
  assert.equal(confirmed.outcome, "confirmed");
  assert.deepEqual(confirmed.files, j.files);
  assert.equal(
    (
      await ticketState({
        ...journalRequest(confirmed, request.archiveDir, "cleanup_confirm"),
        removed: true,
        inventoryEvidence: "Reread already confirmed removal",
      })
    ).revision,
    confirmed.revision,
  );
});

test("cleanup refuses live, dirty, unique, unpreserved, in-progress and mismatched work; retry is bounded and reread first", async (t) => {
  const f = await settledLocal(t);
  const request = await cleanupRequest(t, [f]);
  for (const field of [
    "noLiveWriter",
    "noUnpushedWork",
    "prDispositionKnown",
    "noUniqueIgnoredWork",
    "evidencePreserved",
  ])
    await assert.rejects(
      mutate(f, { ...request, [field]: false }),
      /unpreserved evidence/,
    );
  await assert.rejects(
    mutate(f, {
      ...request,
      cleanupAuthorization: {
        ...request.cleanupAuthorization,
        source: "ticket",
      },
    }),
    /user cleanup/,
  );
  await assert.rejects(
    mutate(f, { ...request, archiveDir: join(f.cwd, ".pi") }),
    /survive outside/,
  );
  await assert.rejects(
    mutate(f, {
      ...request,
      tickets: [{ ...request.tickets[0], runId: "wrong" }],
    }),
    /identity mismatch/,
  );
  await writeFile(join(f.cwd, "unsaved"), "unique");
  await assert.rejects(mutate(f, request), /clean checkout/);
  await rm(join(f.cwd, "unsaved"));
  await writeFile(join(f.cwd, ".git", "MERGE_HEAD"), (await snap(f)).head);
  await assert.rejects(mutate(f, request), /in-progress Git/);
  await rm(join(f.cwd, ".git", "MERGE_HEAD"));
  const j = await mutate(f, request);
  const retry = {
    ...request,
    ...journalRequest(j, request.archiveDir, "cleanup_retry"),
    effectAbsent: true,
    inventoryEvidence:
      "Fresh inventory proves exact checkout remains; no removal happened",
  };
  await assert.rejects(
    ticketState({ ...retry, effectAbsent: false }),
    /proven absence/,
  );
  await assert.rejects(
    ticketState({ ...retry, noLiveWriter: false }),
    /unpreserved evidence/,
  );
  await assert.rejects(
    ticketState({ ...retry, identities: [] }),
    /CAS or ticket/,
  );
  await writeFile(
    join(f.cwd, ".pi", "tickets", ticketId, "new-evidence"),
    "not yet archived",
  );
  await assert.rejects(ticketState(retry), /state\/evidence changed/);
  await rm(join(f.cwd, ".pi", "tickets", ticketId, "new-evidence"));
  const retried = await ticketState(retry);
  assert.equal(retried.retries, 1);
  await assert.rejects(ticketState(retry), /CAS/);
  await assert.rejects(
    ticketState({ ...retry, expectedRevision: retried.revision }),
    /unused retry/,
  );
});

test("already removed archived pending cleanup is adopted without modifying old state or inventing a receipt", async (t) => {
  const f = await settledLocal(t);
  const request = await cleanupRequest(t, [f]);
  const sourceDirectory = await mkdtemp(join(tmpdir(), "old-cleanup-archive-"));
  t.after(() => rm(sourceDirectory, { recursive: true, force: true }));
  const state = await read(f);
  // Sanitized legacy helper record: removal preceded durable journal support.
  state.externalWrites.push({
    operation: "cleanup",
    key: "old-removal",
    intent: "Remove exact old checkout, retain branch",
    outcome: "pending",
    evidence: "Original safety gates passed",
  });
  const bytes = JSON.stringify(state);
  await writeFile(join(sourceDirectory, "state.json"), bytes);
  await writeFile(
    join(sourceDirectory, "handoff.md"),
    "Byte-preserved handoff",
  );
  const adopt = {
    action: "adopt_cleanup",
    archiveDir: request.archiveDir,
    cleanupId: "adopt-1",
    sourceDirectory,
    ticketId,
    runId: state.runId,
    owner: state.owner,
    contract: state.contract,
    expectedRevision: state.revision,
    sourceDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    key: "old-removal",
    intent: "Remove exact old checkout, retain branch",
    cleanupAuthorization: request.cleanupAuthorization,
    planeState: "Done",
    prDispositionKnown: true,
    recoveryEvidence:
      "Exact archived state/handoff bytes and old removal receipt verified against fresh inventory",
  };
  await assert.rejects(ticketState(adopt), /already removed/);
  await rm(f.cwd, { recursive: true });
  await assert.rejects(
    ticketState({ ...adopt, sourceDigest: `sha256:${"0".repeat(64)}` }),
    /digest mismatch/,
  );
  await assert.rejects(
    ticketState({ ...adopt, key: "different" }),
    /original cleanup intent/,
  );
  const journal = await ticketState(adopt);
  assert.equal(journal.outcome, "pending");
  assert.equal(journal.recovered, true);
  await assert.rejects(
    ticketState({
      ...journalRequest(journal, request.archiveDir, "cleanup_retry"),
      effectAbsent: true,
    }),
    /pending original intent/,
  );
  const confirmed = await ticketState({
    ...journalRequest(journal, request.archiveDir, "cleanup_confirm"),
    removed: true,
    inventoryEvidence:
      "Authoritative inventory confirms exact old checkout removed, branch retained",
  });
  assert.equal(confirmed.outcome, "confirmed");
  assert.equal(
    await readFile(join(sourceDirectory, "state.json"), "utf8"),
    bytes,
  );
  const retainedState = confirmed.files.find(
    (file) => file.path === "state.json",
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(request.archiveDir, "evidence", retainedState.digest.slice(7)),
        "utf8",
      ),
    ).externalWrites[0].outcome,
    "pending",
  );
});

test("CLI cleanup streams aggregate evidence and uses compact scope claims for near-limit multi-ticket contracts", async (t) => {
  const f = await fixture(t);
  f.input.contract = "x".repeat(100000);
  f.input.authorization.operations.push("settle", "cleanup");
  const fixtures = [];
  for (const uuid of [
    ticketId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
  ]) {
    const member = {
      ...f,
      input: {
        ...f.input,
        ticketId: uuid,
        runId: `run-${fixtures.length}`,
        owner: `owner-${fixtures.length}`,
      },
    };
    await init(member);
    await checks(member);
    await mutate(member, {
      action: "handoff",
      planeState: "In Progress",
      summary: "Complete",
    });
    await mutate(member, {
      action: "settle",
      confirmed: true,
      planeState: "Done",
    });
    fixtures.push(member);
  }
  for (let i = 0; i < 24; i++)
    await writeFile(
      join(f.cwd, ".pi", "tickets", ticketId, `evidence-${i}`),
      `${i}`.padEnd(250000, "x"),
    );
  const request = await cleanupRequest(t, fixtures);
  const s = await read(fixtures[0]);
  const cli = (input) => {
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "ticket-state.js")],
      { input: JSON.stringify(input), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).result;
  };
  const journal = cli({
    ...request,
    cwd: f.cwd,
    ticketId,
    runId: s.runId,
    owner: s.owner,
    expectedRevision: s.revision,
    contract: s.contract,
  });
  assert.equal(journal.records.length, 3);
  assert.ok(
    journal.files.reduce((total, file) => total + file.size, 0) >
      4 * 1024 * 1024,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(journal)) < 30000);
  for (const file of journal.files) {
    const retained = await readFile(
      join(request.archiveDir, "evidence", file.digest.slice(7)),
    );
    assert.deepEqual(
      retained,
      await readFile(join(f.cwd, ".pi", "tickets", file.path)),
    );
  }
  const retried = cli({
    ...request,
    ...journalRequest(journal, request.archiveDir, "cleanup_retry"),
    effectAbsent: true,
    inventoryEvidence:
      "Exact fixture still present; effect absent; safety rechecked",
  });
  assert.equal(retried.retries, 1);
  await rm(f.cwd, { recursive: true });
  const confirmed = cli({
    ...journalRequest(retried, request.archiveDir, "cleanup_confirm"),
    removed: true,
    inventoryEvidence: "Reread exact fixture removal after interruption",
  });
  assert.equal(confirmed.outcome, "confirmed");
  const blob = join(
    request.archiveDir,
    "evidence",
    confirmed.files[0].digest.slice(7),
  );
  await writeFile(blob, "corrupted");
  await assert.rejects(
    ticketState({
      action: "cleanup_status",
      archiveDir: request.archiveDir,
      cleanupId: confirmed.cleanupId,
    }),
    /digest mismatch/,
  );
});
