import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addDecision,
  addEvidence,
  completeMilestone,
  completeTask,
  getNextWork,
  initializeRun,
  openRun,
  parsePlan,
  readRun,
  startMilestone,
  startTask,
  stopMilestone,
  validatePlan,
} from "./plan-run-state.js";

const PLAN = `# Example Plan

## Lineage

- Status: Ready

## Acceptance Criteria

- **AC-1:** Build the foundation.
- **AC-2:** Expose the behavior.
- **AC-3:** Verify integration.

## Execution Milestones

### M1: Foundation

- Acceptance criteria: AC-1
- Depends on: None
- Verification gate: npm test -- foundation passes
- Checkpoint: Commit the verified foundation.

#### T1: Build the state model

- Scope: src/state.js
- Outcome: State transitions are explicit.
- Verification: npm test -- state

### M2: Integration

- Acceptance criteria: AC-2, AC-3
- Depends on: M1
- Verification gate: npm test passes
- Checkpoint: Commit the integrated behavior.

#### T2: Expose the behavior

- Scope: src/index.js
- Outcome: Callers can use the state model.
- Verification: npm test -- integration
`;

async function planWorkspace(plan = PLAN) {
  const cwd = await mkdtemp(join(tmpdir(), "execute-milestone-"));
  const planDir = join(cwd, ".design", "plans");
  await mkdir(planDir, { recursive: true });
  const planPath = join(planDir, "example.md");
  await writeFile(planPath, plan);
  return { cwd, planPath };
}

async function fixture(plan = PLAN) {
  const workspace = await planWorkspace(plan);
  const initialized = await initializeRun({
    cwd: workspace.cwd,
    planPath: ".design/plans/example.md",
    runId: "run-1",
    now: "2026-08-22T12:00:00.000Z",
  });
  return { ...workspace, ...initialized };
}

test("parsePlan returns ordered milestones, tasks, criteria, and dependencies", () => {
  const parsed = parsePlan(PLAN);

  assert.deepEqual(parsed.acceptanceCriteria, ["AC-1", "AC-2", "AC-3"]);
  assert.deepEqual(
    parsed.milestones.map(({ id, title, criteria, dependencies }) => ({
      id,
      title,
      criteria,
      dependencies,
    })),
    [
      {
        id: "M1",
        title: "Foundation",
        criteria: ["AC-1"],
        dependencies: [],
      },
      {
        id: "M2",
        title: "Integration",
        criteria: ["AC-2", "AC-3"],
        dependencies: ["M1"],
      },
    ],
  );
  assert.deepEqual(parsed.milestones[0].tasks[0], {
    id: "T1",
    title: "Build the state model",
    scope: "src/state.js",
    outcome: "State transitions are explicit.",
    verification: "npm test -- state",
  });
});

test("parsePlan requires a Ready plan and rejects invalid milestone graphs", () => {
  assert.throws(
    () => parsePlan(PLAN.replace("- Status: Ready", "- Status: Draft")),
    /Plan status must be Ready/,
  );
  assert.throws(
    () => parsePlan(PLAN.replace("- Status: Ready\n", "")),
    /Plan Lineage must declare Status: Ready/,
  );

  const duplicate = PLAN.replace("### M2: Integration", "### M1: Integration");
  assert.throws(() => parsePlan(duplicate), /Duplicate milestone ID M1/);

  const missingDependency = PLAN.replace("Depends on: M1", "Depends on: M9");
  assert.throws(() => parsePlan(missingDependency), /unknown milestone M9/);

  const cycle = PLAN.replace("Depends on: None", "Depends on: M2");
  assert.throws(() => parsePlan(cycle), /dependency cycle/);

  const noCheckpoint = PLAN.replace(
    "- Checkpoint: Commit the verified foundation.\n",
    "",
  );
  assert.throws(() => parsePlan(noCheckpoint), /M1 has no checkpoint/);

  const noTasks = PLAN.replace(/#### T1:[\s\S]*?(?=\n### M2:)/, "");
  assert.throws(() => parsePlan(noTasks), /M1 has no tasks/);
});

test("validatePlan reports the consumer-facing execution contract", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "execute-milestone-validation-"));
  await mkdir(join(cwd, ".design", "plans"), { recursive: true });
  await writeFile(join(cwd, ".design", "plans", "example.md"), PLAN);

  assert.deepEqual(
    await validatePlan({ cwd, planPath: ".design/plans/example.md" }),
    {
      planPath: ".design/plans/example.md",
      status: "Ready",
      acceptanceCriteria: ["AC-1", "AC-2", "AC-3"],
      milestones: [
        { id: "M1", dependencies: [], taskCount: 1 },
        { id: "M2", dependencies: ["M1"], taskCount: 1 },
      ],
    },
  );
});

test("validatePlan rejects a plans directory that escapes through a symlink", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "execute-milestone-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "execute-milestone-plans-"));
  await mkdir(join(cwd, ".design"));
  await writeFile(join(outside, "example.md"), PLAN);
  await symlink(outside, join(cwd, ".design", "plans"));

  await assert.rejects(
    validatePlan({ cwd, planPath: ".design/plans/example.md" }),
    /Plan must not escape the workspace through a symlink/,
  );
});

test("initializeRun rejects a runs directory that escapes through a symlink", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "execute-milestone-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "execute-milestone-runs-"));
  await mkdir(join(cwd, ".design", "plans"), { recursive: true });
  await writeFile(join(cwd, ".design", "plans", "example.md"), PLAN);
  await symlink(outside, join(cwd, ".design", "runs"));

  await assert.rejects(
    initializeRun({
      cwd,
      planPath: ".design/plans/example.md",
      runId: "run-1",
    }),
    /Runs directory must not escape the workspace through a symlink/,
  );
});

test("readRun rejects a resumed run that escapes through a symlink", async () => {
  const { runDir } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "execute-milestone-run-"));
  const movedRun = join(outside, "run-1");
  await rename(runDir, movedRun);
  await symlink(movedRun, runDir);

  await assert.rejects(
    readRun(runDir),
    /Run directory must not escape the workspace through a symlink/,
  );
});

test("initializeRun writes compact pending state and returns the first work item", async () => {
  const { runDir } = await fixture();
  const state = await readRun(runDir);

  assert.equal(state.status, "pending");
  assert.equal(state.currentMilestone, null);
  assert.match(state.planFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(state.milestones), ["M1", "M2"]);
  assert.equal(state.milestones.M1.tasks.T1.status, "pending");
  assert.deepEqual(await getNextWork(runDir), {
    milestoneId: "M1",
    taskId: "T1",
  });
});

test("openRun creates the first run and resumes the sole matching run", async () => {
  const { cwd } = await planWorkspace();
  const created = await openRun({
    cwd,
    planPath: ".design/plans/example.md",
    now: "2026-08-22T12:00:00.000Z",
  });

  assert.equal(created.action, "created");
  assert.equal(created.runDir.split("/").at(-1), "20260822T120000Z");
  assert.equal(created.runStatus, "pending");
  assert.deepEqual(created.next, { milestoneId: "M1", taskId: "T1" });
  assert.equal(created.nextMilestoneAttempts, 0);
  assert.equal(created.nextTaskAttempts, 0);

  const resumed = await openRun({
    cwd,
    planPath: ".design/plans/example.md",
    runId: "unused-run-id",
  });
  assert.equal(resumed.action, "resumed");
  assert.equal(resumed.runDir, created.runDir);
  assert.deepEqual(resumed.next, { milestoneId: "M1", taskId: "T1" });
});

test("openRun reports ambiguous resumable runs without choosing one", async () => {
  const { cwd } = await planWorkspace();
  const first = await initializeRun({
    cwd,
    planPath: ".design/plans/example.md",
    runId: "run-1",
  });
  const second = await initializeRun({
    cwd,
    planPath: ".design/plans/example.md",
    runId: "run-2",
  });

  const opened = await openRun({ cwd, planPath: ".design/plans/example.md" });
  assert.equal(opened.action, "ambiguous");
  assert.deepEqual(
    opened.candidates.map(({ runDir }) => runDir),
    [first.runDir, second.runDir],
  );
});

test("openRun refuses plan drift instead of silently starting another run", async () => {
  const { cwd, planPath, runDir } = await fixture();
  await writeFile(planPath, `${PLAN}\nChanged after initialization.\n`);

  const opened = await openRun({ cwd, planPath: ".design/plans/example.md" });
  assert.equal(opened.action, "drifted");
  assert.deepEqual(
    opened.candidates.map((candidate) => candidate.runDir),
    [runDir],
  );
});

test("openRun reports a completed run instead of creating another", async () => {
  const { cwd, runDir } = await fixture();
  for (const [milestoneId, taskId, criteria] of [
    ["M1", "T1", ["AC-1"]],
    ["M2", "T2", ["AC-2", "AC-3"]],
  ]) {
    await startMilestone({ runDir, milestoneId });
    await startTask({ runDir, taskId });
    await addEvidence({
      runDir,
      milestoneId,
      taskId,
      criteria,
      kind: "command",
      summary: `${taskId} passed.`,
      command: `npm test -- ${taskId}`,
      exitCode: 0,
    });
    await completeTask({ runDir, taskId });
    await completeMilestone({ runDir, milestoneId });
  }

  const opened = await openRun({ cwd, planPath: ".design/plans/example.md" });
  assert.equal(opened.action, "complete");
  assert.equal(opened.runDir, runDir);
  assert.equal(opened.runStatus, "complete");
  assert.equal(opened.next, null);
});

test("openRun rejects a run whose base commit is absent from the checkout", async () => {
  const { cwd, runDir } = await fixture();
  const statePath = join(runDir, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.baseCommit = "0123456789abcdef0123456789abcdef01234567";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const opened = await openRun({ cwd, planPath: ".design/plans/example.md" });
  assert.equal(opened.action, "invalid");
  assert.equal(opened.candidates[0].runDir, runDir);
  assert.match(opened.candidates[0].reason, /base commit.*not an ancestor/);
});

test("milestone start accepts only the helper's next ready milestone", async () => {
  const { runDir } = await fixture(
    PLAN.replace("- Depends on: M1", "- Depends on: None"),
  );

  await assert.rejects(
    startMilestone({ runDir, milestoneId: "M2" }),
    /M2 is not next; expected M1/,
  );
});

test("a milestone completes only with completed tasks and criterion evidence", async () => {
  const { runDir } = await fixture();

  await assert.rejects(
    startMilestone({
      runDir,
      milestoneId: "M2",
      now: "2026-08-22T12:01:00.000Z",
    }),
    /M2 is not next; expected M1/,
  );

  await startMilestone({
    runDir,
    milestoneId: "M1",
    now: "2026-08-22T12:01:00.000Z",
  });
  await startTask({
    runDir,
    taskId: "T1",
    now: "2026-08-22T12:02:00.000Z",
  });

  await assert.rejects(
    completeTask({
      runDir,
      taskId: "T1",
      now: "2026-08-22T12:03:00.000Z",
    }),
    /has no evidence for its current attempt/,
  );

  await addEvidence({
    runDir,
    milestoneId: "M1",
    taskId: "T1",
    criteria: ["AC-1"],
    kind: "command",
    summary: "State tests passed.",
    command: "npm test -- state",
    exitCode: 0,
    now: "2026-08-22T12:04:00.000Z",
  });
  await completeTask({
    runDir,
    taskId: "T1",
    now: "2026-08-22T12:05:00.000Z",
  });
  const completed = await completeMilestone({
    runDir,
    milestoneId: "M1",
    now: "2026-08-22T12:06:00.000Z",
  });

  assert.equal(completed.milestones.M1.status, "done");
  assert.equal(completed.milestones.M1.tasks.T1.status, "done");
  assert.equal(completed.currentMilestone, null);
  assert.deepEqual(await getNextWork(runDir), {
    milestoneId: "M2",
    taskId: "T2",
  });

  const evidence = JSON.parse(
    await readFile(join(runDir, "evidence", "M1.json"), "utf8"),
  );
  assert.equal(evidence.entries.length, 1);
  assert.equal(evidence.entries[0].exitCode, 0);
});

test("failed command evidence prevents task completion in the current attempt", async () => {
  const { runDir } = await fixture();
  await startMilestone({ runDir, milestoneId: "M1" });
  await startTask({ runDir, taskId: "T1" });
  await addEvidence({
    runDir,
    milestoneId: "M1",
    taskId: "T1",
    criteria: ["AC-1"],
    kind: "command",
    summary: "State tests failed.",
    command: "npm test -- state",
    exitCode: 1,
  });

  await assert.rejects(
    completeTask({ runDir, taskId: "T1" }),
    /has failing command evidence/,
  );
});

test("blocked work can resume without losing prior evidence or attempt history", async () => {
  const { runDir } = await fixture();
  await startMilestone({ runDir, milestoneId: "M1" });
  await startTask({ runDir, taskId: "T1" });
  await addEvidence({
    runDir,
    milestoneId: "M1",
    taskId: "T1",
    criteria: ["AC-1"],
    kind: "inspection",
    summary: "The required SDK capability is unavailable.",
    path: "src/state.js",
  });
  await stopMilestone({
    runDir,
    milestoneId: "M1",
    status: "blocked",
    reason: "Dependency capability needs a user decision.",
  });

  let state = await readRun(runDir);
  assert.equal(state.status, "blocked");
  assert.equal(state.milestones.M1.status, "blocked");
  assert.equal(state.milestones.M1.tasks.T1.status, "blocked");

  await startMilestone({ runDir, milestoneId: "M1" });
  await startTask({ runDir, taskId: "T1" });
  state = await readRun(runDir);
  assert.equal(state.milestones.M1.attempts, 2);
  assert.equal(state.milestones.M1.tasks.T1.attempts, 2);
});

test("invalid state-controlled evidence paths cannot escape the run", async () => {
  const { cwd, runDir } = await fixture();
  const statePath = join(runDir, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.milestones.M1.evidencePath = "../../../../outside.json";
  await writeFile(statePath, `${JSON.stringify(state)}\n`);

  await assert.rejects(
    startMilestone({ runDir, milestoneId: "M1" }),
    /Invalid run state.*evidencePath/,
  );
  await assert.rejects(access(join(cwd, "outside.json")), { code: "ENOENT" });
});

test("a stale dead-owner lock is reclaimed before mutation", async () => {
  const { runDir } = await fixture();
  await writeFile(
    join(runDir, ".state.lock"),
    `${JSON.stringify({
      pid: 999999999,
      token: "dead-owner",
      createdAt: "2026-08-22T11:00:00.000Z",
      processStartedAt: null,
    })}\n`,
  );

  const state = await startMilestone({ runDir, milestoneId: "M1" });
  assert.equal(state.currentMilestone, "M1");
});

test("a stale lock is reclaimed after its PID is reused", async () => {
  const { runDir } = await fixture();
  const lockPath = join(runDir, ".state.lock");
  await writeFile(
    lockPath,
    `${JSON.stringify({
      pid: process.pid,
      token: "reused-pid",
      createdAt: "2000-01-01T00:00:00.000Z",
      processStartedAt: "Mon Jan  1 00:00:00 2000",
    })}\n`,
  );

  const state = await startMilestone({ runDir, milestoneId: "M1" });
  assert.equal(state.currentMilestone, "M1");
});

test("plan drift blocks mutations and decisions are append-only", async () => {
  const { runDir, planPath } = await fixture();
  await addDecision({
    runDir,
    milestoneId: "M1",
    summary: "Keep state transitions explicit.",
    rationale: "Resume must not depend on model memory.",
    now: "2026-08-22T12:01:00.000Z",
  });
  await writeFile(planPath, `${PLAN}\nChanged after initialization.\n`);

  await assert.rejects(
    startMilestone({ runDir, milestoneId: "M1" }),
    /Plan fingerprint changed/,
  );

  const decisions = (await readFile(join(runDir, "decisions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].milestoneId, "M1");
});
