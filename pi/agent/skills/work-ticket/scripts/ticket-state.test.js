import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
  return ticketState({ cwd: f.cwd, ticketId, action: "status" });
}
async function mutate(f, request) {
  const s = await read(f);
  return ticketState({
    cwd: f.cwd,
    ticketId,
    runId: s.runId,
    owner: s.owner,
    expectedRevision: s.revision,
    contract: s.contract,
    ...request,
  });
}
async function snap(f) {
  return ticketState({ cwd: f.cwd, ticketId, action: "snapshot" });
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
    /consolidated complete review|already consumed/,
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
  await assert.rejects(
    mutate(f, { action: "reconcile", observations: "restart" }),
    /sticky/,
  );
});

test("review requires prior checks; unsupported blockers and partial resolutions reject atomically", async (t) => {
  const f = await fixture(t);
  await init(f);
  await assert.rejects(review(f, [blocker()]), /passing required checks/);
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
