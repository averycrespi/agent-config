import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  _ticketRunLock,
  applyTicketRunAction,
  hashTicketContract,
  initializeTicketRun,
  readTicketRun,
} from "./ticket-run.js";

function assignment(contractHash = hashTicketContract("Ticket contract\n")) {
  return {
    ticket: {
      id: "plane-id-123",
      identifier: "ABC-123",
      url: "https://plane.example.com/ABC-123",
      contractHash,
    },
    assignment: {
      repository: "example/project",
      targetBranch: "main",
      branch: "avery/abc-123-example",
      baseCommit: "a".repeat(40),
      herdrWorkspaceId: "workspace-123",
      workerName: "ticket-abc-123",
    },
  };
}

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "ticket-run-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function mutate(root, request) {
  const state = await readTicketRun({ cwd: root });
  return applyTicketRunAction({
    cwd: root,
    expectedRevision: state.revision,
    ...request,
  });
}

function runCli(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "ticket-run.js")],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

test("hashes the exact approved ticket contract deterministically", () => {
  assert.equal(
    hashTicketContract("Ticket contract\n"),
    hashTicketContract("Ticket contract\n"),
  );
  assert.notEqual(
    hashTicketContract("Ticket contract\n"),
    hashTicketContract("Ticket contract changed\n"),
  );
  assert.match(
    hashTicketContract("Ticket contract\n"),
    /^sha256:[a-f0-9]{64}$/,
  );
});

test("initializes one paused run and derives its next safe action", async (t) => {
  const root = await repository(t);
  const state = await initializeTicketRun({
    cwd: root,
    runId: "run-123",
    ...assignment(),
    now: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(state.revision, 0);
  assert.equal(state.status, "paused");
  assert.equal(state.phase, "planning");
  assert.deepEqual(state.nextAction, { action: "activate", phase: "planning" });
  assert.deepEqual(await readTicketRun({ cwd: root }), state);

  await assert.rejects(
    initializeTicketRun({ cwd: root, runId: "run-other", ...assignment() }),
    /already exists/,
  );
});

test("advances the minimal delivery lifecycle with expected revisions", async (t) => {
  const root = await repository(t);
  await initializeTicketRun({ cwd: root, runId: "run-123", ...assignment() });

  let state = await mutate(root, { action: "activate" });
  assert.equal(state.status, "active");
  assert.deepEqual(state.nextAction, { action: "work", phase: "planning" });

  state = await mutate(root, {
    action: "progress",
    toPhase: "implementing",
    planSummary: "Implement AC-1 and verify the repository checks.",
  });
  assert.equal(state.phase, "implementing");
  assert.equal(state.revision, 2);

  state = await mutate(root, {
    action: "checkpoint",
    summary: "Implemented AC-1",
    commit: "b".repeat(40),
  });
  assert.equal(state.checkpoint.commit, "b".repeat(40));

  for (const toPhase of ["verifying", "publishing"]) {
    state = await mutate(root, { action: "progress", toPhase });
  }
  for (const [evidence, error] of [
    [{}, /confirmed draft PR/],
    [
      {
        draftPrConfirmed: true,
        draftPrHead: "d".repeat(40),
        draftPrTargetBranch: "main",
        draftPrSourceBranch: "avery/abc-123-example",
      },
      /draft PR head/,
    ],
    [
      {
        draftPrConfirmed: true,
        draftPrHead: "c".repeat(40),
        draftPrTargetBranch: "other",
        draftPrSourceBranch: "avery/abc-123-example",
      },
      /assigned target branch/,
    ],
    [
      {
        draftPrConfirmed: true,
        draftPrHead: "c".repeat(40),
        draftPrTargetBranch: "main",
        draftPrSourceBranch: "other",
      },
      /assigned source branch/,
    ],
  ]) {
    await assert.rejects(
      mutate(root, {
        action: "progress",
        toPhase: "reviewing",
        draftPrUrl: "https://github.com/example/project/pull/42",
        publishedHead: "c".repeat(40),
        ...evidence,
      }),
      error,
    );
  }

  state = await mutate(root, {
    action: "progress",
    toPhase: "reviewing",
    draftPrUrl: "https://github.com/example/project/pull/42",
    publishedHead: "c".repeat(40),
    draftPrConfirmed: true,
    draftPrHead: "c".repeat(40),
    draftPrTargetBranch: "main",
    draftPrSourceBranch: "avery/abc-123-example",
  });

  assert.equal(state.phase, "reviewing");
  assert.equal(state.publication.reviewedHead, null);
  assert.deepEqual(state.nextAction, { action: "work", phase: "reviewing" });
});

test("serializes helper users with one cooperative run lock", async (t) => {
  const root = await repository(t);
  await initializeTicketRun({ cwd: root, runId: "run-123", ...assignment() });

  const first = await _ticketRunLock.acquire(root);
  await assert.rejects(
    _ticketRunLock.acquire(root),
    /locked by another helper process/,
  );
  await first.release();
  const next = await _ticketRunLock.acquire(root);
  await next.release();
});

test("allows only one concurrent mutation of the same revision", async (t) => {
  const root = await repository(t);
  await initializeTicketRun({ cwd: root, runId: "run-123", ...assignment() });
  await applyTicketRunAction({
    cwd: root,
    action: "activate",
    expectedRevision: 0,
  });

  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      applyTicketRunAction({
        cwd: root,
        action: "checkpoint",
        expectedRevision: 1,
        summary: `Concurrent checkpoint ${index}`,
      }),
    ),
  );

  assert.equal(
    attempts.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal((await readTicketRun({ cwd: root })).revision, 2);
});

test("rejects stale or invalid transitions without changing state bytes", async (t) => {
  const root = await repository(t);
  await initializeTicketRun({ cwd: root, runId: "run-123", ...assignment() });
  const statePath = join(root, ".ticket-run", "state.json");
  const before = await readFile(statePath, "utf8");

  await assert.rejects(
    applyTicketRunAction({
      cwd: root,
      action: "activate",
      expectedRevision: 9,
    }),
    /revision conflict/,
  );
  await assert.rejects(
    applyTicketRunAction({
      cwd: root,
      action: "progress",
      expectedRevision: 0,
      toPhase: "publishing",
    }),
    /active run/,
  );

  assert.equal(await readFile(statePath, "utf8"), before);
});

test("requires reviewed, CI-passing, review-ready current-head evidence for handoff", async (t) => {
  const root = await repository(t);
  await initializeTicketRun({ cwd: root, runId: "run-123", ...assignment() });
  await mutate(root, { action: "activate" });
  await mutate(root, {
    action: "progress",
    toPhase: "implementing",
    planSummary: "One bounded packet.",
  });
  await mutate(root, { action: "progress", toPhase: "verifying" });
  await mutate(root, { action: "progress", toPhase: "publishing" });
  await mutate(root, {
    action: "progress",
    toPhase: "reviewing",
    draftPrUrl: "https://github.com/example/project/pull/42",
    publishedHead: "c".repeat(40),
    draftPrConfirmed: true,
    draftPrHead: "c".repeat(40),
    draftPrTargetBranch: "main",
    draftPrSourceBranch: "avery/abc-123-example",
  });

  let state = await readTicketRun({ cwd: root });
  const statePath = join(root, ".ticket-run", "state.json");
  const currentHeadEvidence = {
    reviewedHead: "c".repeat(40),
    reviewOutcome: "pass",
    ciState: "pass",
    ciHead: "c".repeat(40),
    prReadyConfirmed: true,
    prReadyHead: "c".repeat(40),
    planeReviewConfirmed: true,
  };

  await assert.rejects(
    applyTicketRunAction({
      cwd: root,
      action: "handoff",
      expectedRevision: state.revision,
      ...currentHeadEvidence,
    }),
    /recorded passing review/,
  );
  await assert.rejects(
    mutate(root, {
      action: "record_review",
      reviewedHead: "d".repeat(40),
      reviewOutcome: "pass",
    }),
    /reviewed head must equal published head/,
  );
  state = await mutate(root, {
    action: "record_review",
    reviewedHead: "c".repeat(40),
    reviewOutcome: "pass",
  });
  assert.equal(state.publication.reviewedHead, "c".repeat(40));
  const before = await readFile(statePath, "utf8");

  for (const [overrides, error] of [
    [{ reviewedHead: "d".repeat(40) }, /reviewed head/],
    [{ ciState: "pending" }, /passing CI/],
    [{ ciHead: "d".repeat(40) }, /CI head/],
    [{ prReadyConfirmed: false }, /ready for review/],
    [{ prReadyHead: "d".repeat(40) }, /ready PR head/],
  ]) {
    await assert.rejects(
      applyTicketRunAction({
        cwd: root,
        action: "handoff",
        expectedRevision: state.revision,
        ...currentHeadEvidence,
        ...overrides,
      }),
      error,
    );
    assert.equal(await readFile(statePath, "utf8"), before);
  }

  state = await mutate(root, {
    action: "handoff",
    ...currentHeadEvidence,
  });
  assert.equal(state.status, "awaiting_human");
  assert.deepEqual(state.nextAction, { action: "await_human" });

  await assert.rejects(
    applyTicketRunAction({
      cwd: root,
      action: "complete",
      expectedRevision: state.revision,
      mergedHead: "d".repeat(40),
      planeDoneConfirmed: true,
    }),
    /merged head must equal reviewed head/,
  );

  state = await mutate(root, {
    action: "complete",
    mergedHead: "c".repeat(40),
    planeDoneConfirmed: true,
  });
  assert.equal(state.status, "complete");
  assert.deepEqual(state.nextAction, { action: "none" });
});

test("provides a structured stdin JSON CLI", async (t) => {
  const root = await repository(t);
  let result = await runCli({
    action: "init",
    cwd: root,
    runId: "run-123",
    ...assignment(),
  });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).state.status, "paused");

  result = await runCli({ action: "status", cwd: root });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).state.runId, "run-123");

  result = await runCli({ action: "unknown", cwd: root });
  assert.notEqual(result.code, 0);
  assert.match(JSON.parse(result.stdout).error, /unknown action/);
});

test("refuses a symlinked ticket-run directory", async (t) => {
  const root = await repository(t);
  const outside = await repository(t);
  await symlink(outside, join(root, ".ticket-run"));

  await assert.rejects(
    initializeTicketRun({ cwd: root, runId: "run-123", ...assignment() }),
    /must not be a symbolic link/,
  );
});
