#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MILESTONE_ID = /^M\d+$/;
const TASK_ID = /^T\d+$/;
const CRITERION_ID = /^AC-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const EVIDENCE_KINDS = new Set(["command", "artifact", "inspection", "manual"]);
const PROFILES = new Set(["fast", "balanced", "strong"]);
const STOP_STATUSES = new Set(["blocked", "failed"]);
const RUN_STATUSES = new Set([
  "pending",
  "running",
  "blocked",
  "failed",
  "complete",
]);
const WORK_STATUSES = new Set([
  "pending",
  "running",
  "blocked",
  "failed",
  "done",
]);

function timestamp(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid timestamp: ${value}`);
  return date.toISOString();
}

function compactText(value, name, maxLength) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error(`${name} must not be empty`);
  if (text.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return text;
}

function uniqueMatches(value, pattern) {
  return [...new Set(value.match(pattern) ?? [])];
}

function sectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`Plan is missing ## ${heading}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function assertAcyclic(milestones) {
  const byId = new Map(
    milestones.map((milestone) => [milestone.id, milestone]),
  );
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id))
      throw new Error(`Milestone dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }

  for (const milestone of milestones) visit(milestone.id);
}

export function parsePlan(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("Plan content must not be empty");
  }

  let lineageLines;
  try {
    lineageLines = sectionLines(markdown, "Lineage");
  } catch {
    throw new Error("Plan Lineage must declare Status: Ready");
  }
  const statuses = lineageLines
    .map((line) =>
      line
        .trim()
        .match(/^-\s+Status:\s*(.+)$/i)?.[1]
        ?.trim(),
    )
    .filter(Boolean);
  if (statuses.length !== 1) {
    throw new Error("Plan Lineage must declare Status: Ready exactly once");
  }
  if (statuses[0] !== "Ready") {
    throw new Error(`Plan status must be Ready, received ${statuses[0]}`);
  }

  const acceptanceLines = sectionLines(markdown, "Acceptance Criteria");
  const acceptanceCriteria = uniqueMatches(
    acceptanceLines.join("\n"),
    /AC-[A-Za-z0-9][A-Za-z0-9._-]*/g,
  );
  if (acceptanceCriteria.length === 0) {
    throw new Error("Plan Acceptance Criteria section has no criterion IDs");
  }

  const lines = sectionLines(markdown, "Execution Milestones");
  const milestones = [];
  const milestoneIds = new Set();
  const taskIds = new Set();
  let currentMilestone;
  let currentTask;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const milestoneMatch = line.match(/^###\s+(M\d+):\s+(.+)$/);
    if (milestoneMatch) {
      const [, id, rawTitle] = milestoneMatch;
      if (milestoneIds.has(id)) throw new Error(`Duplicate milestone ID ${id}`);
      milestoneIds.add(id);
      currentMilestone = {
        id,
        title: compactText(rawTitle, `${id} title`, 200),
        criteria: [],
        dependencies: [],
        verificationGate: null,
        checkpoint: null,
        tasks: [],
      };
      currentTask = undefined;
      milestones.push(currentMilestone);
      continue;
    }

    const taskMatch = line.match(/^####\s+(T\d+):\s+(.+)$/);
    if (taskMatch) {
      if (!currentMilestone) {
        throw new Error(`Task ${taskMatch[1]} appears before a milestone`);
      }
      const [, id, rawTitle] = taskMatch;
      if (taskIds.has(id)) throw new Error(`Duplicate task ID ${id}`);
      taskIds.add(id);
      currentTask = {
        id,
        title: compactText(rawTitle, `${id} title`, 200),
        scope: null,
        outcome: null,
        verification: null,
      };
      currentMilestone.tasks.push(currentTask);
      continue;
    }

    if (!currentMilestone) continue;
    if (currentTask) {
      const scopeMatch = line.match(/^-\s+Scope:\s*(.+)$/i);
      if (scopeMatch) {
        currentTask.scope = compactText(
          scopeMatch[1],
          `${currentTask.id} scope`,
          1000,
        );
        continue;
      }
      const outcomeMatch = line.match(/^-\s+Outcome:\s*(.+)$/i);
      if (outcomeMatch) {
        currentTask.outcome = compactText(
          outcomeMatch[1],
          `${currentTask.id} outcome`,
          1000,
        );
        continue;
      }
      const verificationMatch = line.match(/^-\s+Verification:\s*(.+)$/i);
      if (verificationMatch) {
        currentTask.verification = compactText(
          verificationMatch[1],
          `${currentTask.id} verification`,
          1000,
        );
        continue;
      }
    }
    const criteriaMatch = line.match(/^-\s+Acceptance criteria:\s*(.+)$/i);
    if (criteriaMatch) {
      currentMilestone.criteria = uniqueMatches(
        criteriaMatch[1],
        /AC-[A-Za-z0-9][A-Za-z0-9._-]*/g,
      );
      continue;
    }
    const dependencyMatch = line.match(/^-\s+Depends on:\s*(.+)$/i);
    if (dependencyMatch) {
      currentMilestone.dependencies = /^none$/i.test(dependencyMatch[1].trim())
        ? []
        : uniqueMatches(dependencyMatch[1], /M\d+/g);
      continue;
    }
    const gateMatch = line.match(/^-\s+Verification gate:\s*(.+)$/i);
    if (gateMatch) {
      currentMilestone.verificationGate = compactText(
        gateMatch[1],
        `${currentMilestone.id} verification gate`,
        1000,
      );
      continue;
    }
    const checkpointMatch = line.match(/^-\s+Checkpoint:\s*(.+)$/i);
    if (checkpointMatch) {
      currentMilestone.checkpoint = compactText(
        checkpointMatch[1],
        `${currentMilestone.id} checkpoint`,
        1000,
      );
    }
  }

  if (milestones.length === 0) {
    throw new Error("Plan Execution Milestones section has no milestones");
  }

  const knownCriteria = new Set(acceptanceCriteria);
  for (const milestone of milestones) {
    if (milestone.criteria.length === 0) {
      throw new Error(`${milestone.id} has no acceptance criteria`);
    }
    if (!milestone.verificationGate) {
      throw new Error(`${milestone.id} has no verification gate`);
    }
    if (!milestone.checkpoint) {
      throw new Error(`${milestone.id} has no checkpoint`);
    }
    if (milestone.tasks.length === 0) {
      throw new Error(`${milestone.id} has no tasks`);
    }
    for (const criterion of milestone.criteria) {
      if (!knownCriteria.has(criterion)) {
        throw new Error(
          `${milestone.id} references unknown criterion ${criterion}`,
        );
      }
    }
    for (const task of milestone.tasks) {
      const missingFields = ["scope", "outcome", "verification"].filter(
        (field) => !task[field],
      );
      if (missingFields.length > 0) {
        throw new Error(`${task.id} is missing: ${missingFields.join(", ")}`);
      }
    }
    for (const dependency of milestone.dependencies) {
      if (!milestoneIds.has(dependency)) {
        throw new Error(
          `${milestone.id} depends on unknown milestone ${dependency}`,
        );
      }
      if (dependency === milestone.id) {
        throw new Error(`Milestone dependency cycle includes ${milestone.id}`);
      }
    }
  }

  const covered = new Set(
    milestones.flatMap((milestone) => milestone.criteria),
  );
  const uncovered = acceptanceCriteria.filter(
    (criterion) => !covered.has(criterion),
  );
  if (uncovered.length > 0) {
    throw new Error(
      `Acceptance criteria lack milestone ownership: ${uncovered.join(", ")}`,
    );
  }
  assertAcyclic(milestones);

  return { acceptanceCriteria, milestones };
}

function fingerprint(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function gitHead(cwd) {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      cwd,
      "rev-parse",
      "HEAD",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitIsAncestor(cwd, commit) {
  if (!commit) return true;
  try {
    await execFileAsync("git", [
      "-C",
      cwd,
      "merge-base",
      "--is-ancestor",
      commit,
      "HEAD",
    ]);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function assertPlanPath(cwd, planPath) {
  const root = resolve(cwd);
  const plansRoot = resolve(root, ".design", "plans");
  const absolutePlan = resolve(root, planPath);
  const relation = relative(plansRoot, absolutePlan);
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Plan must be a file below .design/plans");
  }
  const [realRoot, realPlansRoot, realPlan] = await Promise.all([
    realpath(root),
    realpath(plansRoot),
    realpath(absolutePlan),
  ]);
  if (realPlansRoot !== resolve(realRoot, ".design", "plans")) {
    throw new Error("Plan must not escape the workspace through a symlink");
  }
  const realRelation = relative(realPlansRoot, realPlan);
  if (
    !realRelation ||
    realRelation.startsWith("..") ||
    isAbsolute(realRelation)
  ) {
    throw new Error("Plan must not escape .design/plans through a symlink");
  }
  return {
    root: realRoot,
    absolutePlan: realPlan,
    relativePlan: relative(realRoot, realPlan),
  };
}

export async function validatePlan({ cwd, planPath } = {}) {
  const location = await assertPlanPath(cwd ?? process.cwd(), planPath);
  const parsed = parsePlan(await readFile(location.absolutePlan, "utf8"));
  return {
    planPath: location.relativePlan.split("\\").join("/"),
    status: "Ready",
    acceptanceCriteria: parsed.acceptanceCriteria,
    milestones: parsed.milestones.map((milestone) => ({
      id: milestone.id,
      dependencies: milestone.dependencies,
      taskCount: milestone.tasks.length,
    })),
  };
}

async function canonicalRunsRoot(root, create = false) {
  const realRoot = await realpath(root);
  const runsRoot = resolve(realRoot, ".design", "runs");
  if (create) await mkdir(runsRoot, { recursive: true });
  const realRunsRoot = await realpath(runsRoot);
  if (realRunsRoot !== runsRoot) {
    throw new Error(
      "Runs directory must not escape the workspace through a symlink",
    );
  }
  return realRunsRoot;
}

async function assertRunPath(runDir) {
  const absoluteRunDir = resolve(runDir);
  const root = workspaceRoot(absoluteRunDir);
  const runsRoot = resolve(root, ".design", "runs");
  const relation = relative(runsRoot, absoluteRunDir);
  const parts = relation.split(/[\\/]/);
  if (
    parts.length !== 2 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(parts[0]) ||
    !RUN_ID.test(parts[1])
  ) {
    throw new Error(
      "Run directory must match .design/runs/<plan-slug>/<run-id>",
    );
  }

  const realRunsRoot = await canonicalRunsRoot(root);
  const realRunDir = await realpath(absoluteRunDir);
  if (realRunDir !== resolve(realRunsRoot, ...parts)) {
    throw new Error(
      "Run directory must not escape the workspace through a symlink",
    );
  }
  return realRunDir;
}

function safeSlug(planPath) {
  const name = basename(planPath).replace(/\.md$/i, "");
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("Plan filename cannot produce a run slug");
  return slug;
}

function milestoneState(milestone) {
  return {
    id: milestone.id,
    title: milestone.title,
    status: "pending",
    attempts: 0,
    criteria: milestone.criteria,
    dependencies: milestone.dependencies,
    verificationGate: milestone.verificationGate,
    checkpoint: milestone.checkpoint,
    gateRepairProfileHistory: [],
    taskOrder: milestone.tasks.map((task) => task.id),
    tasks: Object.fromEntries(
      milestone.tasks.map((task) => [
        task.id,
        {
          id: task.id,
          title: task.title,
          scope: task.scope,
          outcome: task.outcome,
          verification: task.verification,
          status: "pending",
          attempts: 0,
          profileHistory: [],
          startedAt: null,
          completedAt: null,
          stopReason: null,
        },
      ]),
    ),
    evidencePath: `evidence/${milestone.id}.json`,
    commit: null,
    startedAt: null,
    completedAt: null,
    stopReason: null,
  };
}

export async function initializeRun({ cwd, planPath, runId, now } = {}) {
  if (!RUN_ID.test(runId ?? "")) {
    throw new Error(
      "runId must use 1-80 letters, numbers, dots, underscores, or hyphens",
    );
  }
  const location = await assertPlanPath(cwd ?? process.cwd(), planPath);
  const content = await readFile(location.absolutePlan, "utf8");
  const parsed = parsePlan(content);
  const createdAt = timestamp(now);
  const runsRoot = await canonicalRunsRoot(location.root, true);
  const slugDir = join(runsRoot, safeSlug(location.relativePlan));
  await mkdir(slugDir, { recursive: true });
  if ((await realpath(slugDir)) !== slugDir) {
    throw new Error(
      "Run directory must not escape the workspace through a symlink",
    );
  }
  const runDir = join(slugDir, runId);
  await mkdir(runDir);
  if ((await realpath(runDir)) !== runDir) {
    throw new Error(
      "Run directory must not escape the workspace through a symlink",
    );
  }
  await mkdir(join(runDir, "evidence"));
  const state = {
    schemaVersion: 1,
    runId,
    planPath: location.relativePlan.split("\\").join("/"),
    planFingerprint: fingerprint(content),
    baseCommit: await gitHead(location.root),
    status: "pending",
    currentMilestone: null,
    currentTask: null,
    createdAt,
    updatedAt: createdAt,
    milestoneOrder: parsed.milestones.map((milestone) => milestone.id),
    milestones: Object.fromEntries(
      parsed.milestones.map((milestone) => [
        milestone.id,
        milestoneState(milestone),
      ]),
    ),
  };
  await atomicWriteJson(join(runDir, "state.json"), state);
  await writeFile(join(runDir, "decisions.jsonl"), "", { flag: "wx" });
  return { runDir, state };
}

function invalidState(field) {
  throw new Error(`Invalid run state: ${field}`);
}

function validateState(state) {
  if (!state || typeof state !== "object" || state.schemaVersion !== 1) {
    invalidState("schemaVersion");
  }
  if (!RUN_ID.test(state.runId ?? "")) invalidState("runId");
  if (
    typeof state.planPath !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(state.planFingerprint ?? "")
  ) {
    invalidState("plan identity");
  }
  if (!RUN_STATUSES.has(state.status)) invalidState("status");
  if (
    !Array.isArray(state.milestoneOrder) ||
    !state.milestones ||
    typeof state.milestones !== "object" ||
    Array.isArray(state.milestones)
  ) {
    invalidState("milestones");
  }

  const milestoneIds = new Set(state.milestoneOrder);
  if (
    milestoneIds.size !== state.milestoneOrder.length ||
    state.milestoneOrder.some((id) => !MILESTONE_ID.test(id)) ||
    Object.keys(state.milestones).some((id) => !milestoneIds.has(id)) ||
    Object.keys(state.milestones).length !== milestoneIds.size
  ) {
    invalidState("milestoneOrder");
  }

  for (const milestoneId of state.milestoneOrder) {
    const milestone = state.milestones[milestoneId];
    if (!milestone || milestone.id !== milestoneId) {
      invalidState(`milestones.${milestoneId}.id`);
    }
    if (!WORK_STATUSES.has(milestone.status)) {
      invalidState(`milestones.${milestoneId}.status`);
    }
    if (milestone.gateRepairProfileHistory !== undefined) {
      if (
        !Array.isArray(milestone.gateRepairProfileHistory) ||
        milestone.gateRepairProfileHistory.length > 100
      ) {
        invalidState(`milestones.${milestoneId}.gateRepairProfileHistory`);
      }
      let previousRound = 0;
      for (const selection of milestone.gateRepairProfileHistory) {
        if (
          !selection ||
          typeof selection !== "object" ||
          !Number.isInteger(selection.round) ||
          selection.round <= previousRound ||
          !Number.isInteger(selection.milestoneAttempt) ||
          selection.milestoneAttempt < 1 ||
          selection.milestoneAttempt > milestone.attempts ||
          !PROFILES.has(selection.profile) ||
          typeof selection.reason !== "string" ||
          !selection.reason.trim() ||
          selection.reason.length > 500 ||
          typeof selection.selectedAt !== "string" ||
          !Number.isFinite(Date.parse(selection.selectedAt))
        ) {
          invalidState(`milestones.${milestoneId}.gateRepairProfileHistory`);
        }
        previousRound = selection.round;
      }
    }
    if (
      !Array.isArray(milestone.criteria) ||
      milestone.criteria.some((id) => !CRITERION_ID.test(id)) ||
      !Array.isArray(milestone.dependencies) ||
      milestone.dependencies.some((id) => !milestoneIds.has(id))
    ) {
      invalidState(`milestones.${milestoneId}.relationships`);
    }
    if (milestone.evidencePath !== `evidence/${milestoneId}.json`) {
      invalidState(`milestones.${milestoneId}.evidencePath`);
    }
    if (
      !Array.isArray(milestone.taskOrder) ||
      !milestone.tasks ||
      typeof milestone.tasks !== "object" ||
      Array.isArray(milestone.tasks)
    ) {
      invalidState(`milestones.${milestoneId}.tasks`);
    }
    const taskIds = new Set(milestone.taskOrder);
    if (
      taskIds.size !== milestone.taskOrder.length ||
      milestone.taskOrder.some((id) => !TASK_ID.test(id)) ||
      Object.keys(milestone.tasks).some((id) => !taskIds.has(id)) ||
      Object.keys(milestone.tasks).length !== taskIds.size
    ) {
      invalidState(`milestones.${milestoneId}.taskOrder`);
    }
    for (const taskId of milestone.taskOrder) {
      const task = milestone.tasks[taskId];
      if (!task || task.id !== taskId || !WORK_STATUSES.has(task.status)) {
        invalidState(`milestones.${milestoneId}.tasks.${taskId}`);
      }
      if (task.profileHistory !== undefined) {
        if (
          !Array.isArray(task.profileHistory) ||
          task.profileHistory.length > 100
        ) {
          invalidState(
            `milestones.${milestoneId}.tasks.${taskId}.profileHistory`,
          );
        }
        let previousAttempt = 0;
        for (const selection of task.profileHistory) {
          if (
            !selection ||
            typeof selection !== "object" ||
            !Number.isInteger(selection.attempt) ||
            selection.attempt <= previousAttempt ||
            selection.attempt > task.attempts ||
            !PROFILES.has(selection.profile) ||
            typeof selection.reason !== "string" ||
            !selection.reason.trim() ||
            selection.reason.length > 500 ||
            typeof selection.selectedAt !== "string" ||
            !Number.isFinite(Date.parse(selection.selectedAt))
          ) {
            invalidState(
              `milestones.${milestoneId}.tasks.${taskId}.profileHistory`,
            );
          }
          previousAttempt = selection.attempt;
        }
      }
    }
  }

  if (
    state.currentMilestone !== null &&
    !milestoneIds.has(state.currentMilestone)
  ) {
    invalidState("currentMilestone");
  }
  if (state.currentTask !== null) {
    const current = state.milestones[state.currentMilestone];
    if (!current || !current.taskOrder.includes(state.currentTask)) {
      invalidState("currentTask");
    }
  }
  return state;
}

export async function readRun(runDir) {
  const absoluteRunDir = await assertRunPath(runDir);
  const content = await readFile(join(absoluteRunDir, "state.json"), "utf8");
  return validateState(JSON.parse(content));
}

function workspaceRoot(runDir) {
  let current = resolve(runDir);
  while (dirname(current) !== current) {
    if (basename(current) === ".design") return dirname(current);
    current = dirname(current);
  }
  throw new Error("Run directory must be below a .design directory");
}

async function assertCurrentPlan(runDir, state) {
  const root = workspaceRoot(runDir);
  const location = await assertPlanPath(root, state.planPath);
  const content = await readFile(location.absolutePlan, "utf8");
  if (fingerprint(content) !== state.planFingerprint) {
    throw new Error(
      "Plan fingerprint changed; start a new run or explicitly migrate state",
    );
  }
  return root;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function processIdentity(pid) {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "lstart=",
      "-p",
      String(pid),
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function validLockMetadata(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.token === "string" &&
    /^[A-Za-z0-9._-]{1,160}$/.test(value.token) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    (value.processStartedAt === null ||
      typeof value.processStartedAt === "string")
  );
}

async function readLockMetadata(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function reclaimStaleLock(lockPath) {
  const metadata = await readLockMetadata(lockPath);
  if (!validLockMetadata(metadata)) return false;
  if (processIsAlive(metadata.pid)) {
    const identity = await processIdentity(metadata.pid);
    if (
      !metadata.processStartedAt ||
      !identity ||
      identity === metadata.processStartedAt
    ) {
      return false;
    }
  }

  const recoveryToken = metadata.token;
  const recoveryPath = `${lockPath}.reclaim-${recoveryToken}`;
  try {
    await rename(lockPath, recoveryPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }

  const moved = await readLockMetadata(recoveryPath);
  if (!validLockMetadata(moved) || moved.token !== recoveryToken) {
    try {
      await rename(recoveryPath, lockPath);
    } catch {
      // A new owner won the lock path. Preserve that lock and leave the
      // unexpected recovery artifact for explicit inspection.
    }
    return false;
  }
  await rm(recoveryPath, { force: true });
  return true;
}

async function acquireLock(lockPath) {
  const metadata = {
    pid: process.pid,
    token: `${process.pid}-${process.hrtime.bigint().toString(36)}`,
    createdAt: new Date().toISOString(),
    processStartedAt: await processIdentity(process.pid),
  };
  const candidatePath = `${lockPath}.candidate-${metadata.token}`;
  try {
    const candidate = await open(candidatePath, "wx");
    try {
      await candidate.writeFile(`${JSON.stringify(metadata)}\n`);
      await candidate.sync();
    } finally {
      await candidate.close();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await link(candidatePath, lockPath);
        return { metadata };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (attempt === 0) {
          await reclaimStaleLock(lockPath);
          continue;
        }
        throw new Error("Run state is locked by another process");
      }
    }
    throw new Error("Run state is locked by another process");
  } finally {
    await rm(candidatePath, { force: true });
  }
}

async function releaseLock(lockPath, lock) {
  const current = await readLockMetadata(lockPath);
  if (validLockMetadata(current) && current.token === lock.metadata.token) {
    await rm(lockPath, { force: true });
  }
}

async function withLock(runDir, operation) {
  const absoluteRunDir = await assertRunPath(runDir);
  const lockPath = join(absoluteRunDir, ".state.lock");
  const lock = await acquireLock(lockPath);
  try {
    return await operation(absoluteRunDir);
  } finally {
    await releaseLock(lockPath, lock);
  }
}

function generatedRunId(now) {
  return timestamp(now)
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

async function openSummary(action, runDir, state) {
  const next = await getNextWork(runDir);
  const milestone = next ? state.milestones[next.milestoneId] : null;
  const task = next?.taskId ? milestone.tasks[next.taskId] : null;
  return {
    action,
    runDir,
    runStatus: state.status,
    currentMilestone: state.currentMilestone,
    currentTask: state.currentTask,
    next,
    milestone: milestone
      ? {
          id: milestone.id,
          title: milestone.title,
          status: milestone.status,
          attempts: milestone.attempts,
          tasks: milestone.taskOrder.map((taskId) => ({
            id: taskId,
            title: milestone.tasks[taskId].title,
            status: milestone.tasks[taskId].status,
            attempts: milestone.tasks[taskId].attempts,
            stopReason: milestone.tasks[taskId].stopReason,
          })),
        }
      : null,
    nextMilestoneStatus: milestone?.status ?? null,
    nextMilestoneAttempts: milestone?.attempts ?? null,
    nextTaskStatus: task?.status ?? null,
    nextTaskAttempts: task?.attempts ?? null,
    stopReason: task?.stopReason ?? milestone?.stopReason ?? null,
  };
}

export async function openRun({ cwd, planPath, runId, now } = {}) {
  const location = await assertPlanPath(cwd ?? process.cwd(), planPath);
  const content = await readFile(location.absolutePlan, "utf8");
  parsePlan(content);
  const planPathKey = location.relativePlan.split("\\").join("/");
  const planFingerprint = fingerprint(content);
  const runsRoot = await canonicalRunsRoot(location.root, true);
  const slugDir = join(runsRoot, safeSlug(location.relativePlan));
  await mkdir(slugDir, { recursive: true });
  if ((await realpath(slugDir)) !== slugDir) {
    throw new Error(
      "Run directory must not escape the workspace through a symlink",
    );
  }

  const lockPath = join(slugDir, ".open.lock");
  const lock = await acquireLock(lockPath);
  try {
    const entries = await readdir(slugDir, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (
        !RUN_ID.test(entry.name) ||
        (!entry.isDirectory() && !entry.isSymbolicLink())
      ) {
        continue;
      }
      const candidateDir = join(slugDir, entry.name);
      let state;
      try {
        state = await readRun(candidateDir);
      } catch (error) {
        throw new Error(`Cannot inspect run ${candidateDir}: ${error.message}`);
      }
      if (state.planPath === planPathKey) {
        candidates.push({ runDir: candidateDir, state });
      }
    }

    const matching = candidates.filter(
      ({ state }) => state.planFingerprint === planFingerprint,
    );
    const validMatching = [];
    const invalidMatching = [];
    for (const candidate of matching) {
      let reason = null;
      if (!(await gitIsAncestor(location.root, candidate.state.baseCommit))) {
        reason = `base commit ${candidate.state.baseCommit} is not an ancestor of HEAD`;
      } else {
        for (const milestoneId of candidate.state.milestoneOrder) {
          const milestone = candidate.state.milestones[milestoneId];
          if (
            milestone.status === "done" &&
            !(await gitIsAncestor(location.root, milestone.commit))
          ) {
            reason = `${milestoneId} checkpoint ${milestone.commit} is not an ancestor of HEAD`;
            break;
          }
        }
      }
      if (reason) invalidMatching.push({ ...candidate, reason });
      else validMatching.push(candidate);
    }

    const resumable = validMatching.filter(
      ({ state }) => state.status !== "complete",
    );
    if (resumable.length > 1) {
      return {
        action: "ambiguous",
        candidates: await Promise.all(
          resumable.map(({ runDir: candidateDir, state }) =>
            openSummary("candidate", candidateDir, state),
          ),
        ),
      };
    }
    if (resumable.length === 1) {
      const [{ runDir: candidateDir, state }] = resumable;
      return openSummary("resumed", candidateDir, state);
    }

    const completed = validMatching.filter(
      ({ state }) => state.status === "complete",
    );
    if (completed.length > 0) {
      const { runDir: candidateDir, state } = completed.at(-1);
      return openSummary("complete", candidateDir, state);
    }

    if (invalidMatching.length > 0) {
      return {
        action: "invalid",
        candidates: invalidMatching.map(
          ({ runDir: candidateDir, state, reason }) => ({
            runDir: candidateDir,
            runStatus: state.status,
            createdAt: state.createdAt,
            reason,
          }),
        ),
      };
    }

    const drifted = candidates.filter(
      ({ state }) => state.planFingerprint !== planFingerprint,
    );
    if (drifted.length > 0) {
      return {
        action: "drifted",
        candidates: drifted.map(({ runDir: candidateDir, state }) => ({
          runDir: candidateDir,
          runStatus: state.status,
          createdAt: state.createdAt,
        })),
      };
    }

    const initialized = await initializeRun({
      cwd: location.root,
      planPath: planPathKey,
      runId: runId ?? generatedRunId(now),
      now,
    });
    return openSummary("created", initialized.runDir, initialized.state);
  } finally {
    await releaseLock(lockPath, lock);
  }
}

async function mutateRun(runDir, now, update) {
  return withLock(runDir, async (absoluteRunDir) => {
    const state = await readRun(absoluteRunDir);
    await assertCurrentPlan(absoluteRunDir, state);
    await update(state, absoluteRunDir);
    state.updatedAt = timestamp(now);
    await atomicWriteJson(join(absoluteRunDir, "state.json"), state);
    return state;
  });
}

function requireMilestone(state, milestoneId) {
  if (!MILESTONE_ID.test(milestoneId ?? "")) {
    throw new Error(`Invalid milestone ID ${milestoneId}`);
  }
  const milestone = state.milestones[milestoneId];
  if (!milestone) throw new Error(`Unknown milestone ${milestoneId}`);
  return milestone;
}

function taskOwner(state, taskId) {
  if (!TASK_ID.test(taskId ?? "")) throw new Error(`Invalid task ID ${taskId}`);
  for (const milestoneId of state.milestoneOrder) {
    const task = state.milestones[milestoneId].tasks[taskId];
    if (task) return { milestone: state.milestones[milestoneId], task };
  }
  throw new Error(`Unknown task ${taskId}`);
}

function nextReadyMilestone(state) {
  for (const milestoneId of state.milestoneOrder) {
    const milestone = state.milestones[milestoneId];
    if (milestone.status === "done") continue;
    if (
      milestone.dependencies.every(
        (dependency) => state.milestones[dependency].status === "done",
      )
    ) {
      return milestone;
    }
  }
  return null;
}

export async function getNextWork(runDir) {
  const state = await readRun(runDir);
  await assertCurrentPlan(runDir, state);
  if (state.status === "complete") return null;

  if (state.currentMilestone) {
    const milestone = state.milestones[state.currentMilestone];
    if (state.currentTask) {
      return {
        step: "task",
        milestoneId: milestone.id,
        taskId: state.currentTask,
      };
    }
    const taskId = milestone.taskOrder.find(
      (id) => milestone.tasks[id].status !== "done",
    );
    return taskId
      ? { step: "task", milestoneId: milestone.id, taskId }
      : { step: "gate", milestoneId: milestone.id, taskId: null };
  }

  const milestone = nextReadyMilestone(state);
  if (!milestone) return null;
  const taskId = milestone.taskOrder.find(
    (id) => milestone.tasks[id].status !== "done",
  );
  return taskId
    ? { step: "task", milestoneId: milestone.id, taskId }
    : { step: "gate", milestoneId: milestone.id, taskId: null };
}

export async function startMilestone({ runDir, milestoneId, now }) {
  return mutateRun(runDir, now, (state) => {
    if (state.currentMilestone) {
      throw new Error(`Milestone ${state.currentMilestone} is already running`);
    }
    const milestone = requireMilestone(state, milestoneId);
    if (milestone.status === "done")
      throw new Error(`${milestoneId} is already done`);
    const next = nextReadyMilestone(state);
    if (!next) throw new Error("No milestone is dependency-ready");
    if (next.id !== milestoneId) {
      throw new Error(`${milestoneId} is not next; expected ${next.id}`);
    }
    milestone.status = "running";
    milestone.attempts += 1;
    milestone.startedAt = timestamp(now);
    milestone.completedAt = null;
    milestone.stopReason = null;
    state.status = "running";
    state.currentMilestone = milestoneId;
    state.currentTask = null;
  });
}

export async function startTask({
  runDir,
  taskId,
  profile,
  profileReason,
  now,
}) {
  if (!PROFILES.has(profile)) {
    throw new Error("profile must be one of: fast, balanced, strong");
  }
  const reason = compactText(profileReason, "profile reason", 500);
  const selectedAt = timestamp(now);
  return mutateRun(runDir, now, (state) => {
    if (!state.currentMilestone) throw new Error("No milestone is running");
    if (state.currentTask)
      throw new Error(`Task ${state.currentTask} is already running`);
    const { milestone, task } = taskOwner(state, taskId);
    if (milestone.id !== state.currentMilestone) {
      throw new Error(
        `${taskId} does not belong to running milestone ${state.currentMilestone}`,
      );
    }
    if (task.status === "done") throw new Error(`${taskId} is already done`);
    const index = milestone.taskOrder.indexOf(taskId);
    const incompleteEarlier = milestone.taskOrder
      .slice(0, index)
      .filter((id) => milestone.tasks[id].status !== "done");
    if (incompleteEarlier.length > 0) {
      throw new Error(
        `${taskId} is blocked by earlier tasks: ${incompleteEarlier.join(", ")}`,
      );
    }
    task.status = "running";
    task.attempts += 1;
    task.profileHistory ??= [];
    if (task.profileHistory.length >= 100) {
      throw new Error(`${taskId} profile history is limited to 100 entries`);
    }
    task.profileHistory.push({
      attempt: task.attempts,
      profile,
      reason,
      selectedAt,
    });
    task.startedAt = selectedAt;
    task.completedAt = null;
    task.stopReason = null;
    state.currentTask = taskId;
  });
}

export async function recordGateRepairProfile({
  runDir,
  milestoneId,
  profile,
  profileReason,
  now,
}) {
  if (!PROFILES.has(profile)) {
    throw new Error("profile must be one of: fast, balanced, strong");
  }
  const reason = compactText(profileReason, "profile reason", 500);
  const selectedAt = timestamp(now);
  return mutateRun(runDir, now, (state) => {
    if (state.currentMilestone !== milestoneId || state.currentTask !== null) {
      throw new Error(`${milestoneId} is not ready for a gate repair`);
    }
    const milestone = requireMilestone(state, milestoneId);
    const incompleteTasks = milestone.taskOrder.filter(
      (taskId) => milestone.tasks[taskId].status !== "done",
    );
    if (incompleteTasks.length > 0) {
      throw new Error(
        `${milestoneId} gate repair requires completed tasks: ${incompleteTasks.join(", ")}`,
      );
    }
    milestone.gateRepairProfileHistory ??= [];
    if (milestone.gateRepairProfileHistory.length >= 100) {
      throw new Error(
        `${milestoneId} gate repair profile history is limited to 100 entries`,
      );
    }
    milestone.gateRepairProfileHistory.push({
      round: milestone.gateRepairProfileHistory.length + 1,
      milestoneAttempt: milestone.attempts,
      profile,
      reason,
      selectedAt,
    });
  });
}

async function readEvidence(runDir, milestone) {
  try {
    const content = await readFile(
      join(runDir, "evidence", `${milestone.id}.json`),
      "utf8",
    );
    const evidence = JSON.parse(content);
    if (
      evidence?.schemaVersion !== 1 ||
      evidence.milestoneId !== milestone.id ||
      !Array.isArray(evidence.entries)
    ) {
      throw new Error(`Invalid evidence file for ${milestone.id}`);
    }
    return evidence;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        schemaVersion: 1,
        milestoneId: milestone.id,
        entries: [],
      };
    }
    throw error;
  }
}

export async function addEvidence({
  runDir,
  milestoneId,
  taskId,
  criteria,
  kind,
  summary,
  command,
  exitCode,
  path,
  now,
}) {
  return withLock(runDir, async (absoluteRunDir) => {
    const state = await readRun(absoluteRunDir);
    await assertCurrentPlan(absoluteRunDir, state);
    const milestone = requireMilestone(state, milestoneId);
    if (
      state.currentMilestone !== milestoneId ||
      milestone.status !== "running"
    ) {
      throw new Error(`${milestoneId} is not the running milestone`);
    }
    let task = null;
    if (taskId !== undefined) {
      const owner = taskOwner(state, taskId);
      task = owner.task;
      if (owner.milestone.id !== milestoneId || state.currentTask !== taskId) {
        throw new Error(`${taskId} is not the running task`);
      }
    }
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new Error("Evidence must name at least one acceptance criterion");
    }
    const normalizedCriteria = [...new Set(criteria)];
    for (const criterion of normalizedCriteria) {
      if (
        !CRITERION_ID.test(criterion) ||
        !milestone.criteria.includes(criterion)
      ) {
        throw new Error(`${criterion} is not owned by ${milestoneId}`);
      }
    }
    if (!EVIDENCE_KINDS.has(kind))
      throw new Error(`Invalid evidence kind ${kind}`);

    const entry = {
      id: null,
      milestoneId,
      taskId: taskId ?? null,
      milestoneAttempt: milestone.attempts,
      taskAttempt: task?.attempts ?? null,
      criteria: normalizedCriteria,
      kind,
      summary: compactText(summary, "evidence summary", 1000),
      recordedAt: timestamp(now),
    };
    if (kind === "command") {
      entry.command = compactText(command, "evidence command", 2000);
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
        throw new Error(
          "command evidence exitCode must be an integer from 0 to 255",
        );
      }
      entry.exitCode = exitCode;
    } else if (path !== undefined) {
      entry.path = compactText(path, "evidence path", 500);
    }

    const evidence = await readEvidence(absoluteRunDir, milestone);
    if (evidence.entries.length >= 200) {
      throw new Error(`${milestoneId} evidence is limited to 200 entries`);
    }
    entry.id = `E${evidence.entries.length + 1}`;
    evidence.entries.push(entry);
    await atomicWriteJson(
      join(absoluteRunDir, "evidence", `${milestone.id}.json`),
      evidence,
    );
    state.updatedAt = timestamp(now);
    await atomicWriteJson(join(absoluteRunDir, "state.json"), state);
    return entry;
  });
}

function currentAttemptEvidence(evidence, milestone, task) {
  return evidence.entries.filter(
    (entry) =>
      entry.milestoneAttempt === milestone.attempts &&
      (task
        ? entry.taskId === task.id && entry.taskAttempt === task.attempts
        : true),
  );
}

export async function completeTask({ runDir, taskId, now }) {
  return mutateRun(runDir, now, async (state, absoluteRunDir) => {
    if (!state.currentMilestone || state.currentTask !== taskId) {
      throw new Error(`${taskId} is not the running task`);
    }
    const { milestone, task } = taskOwner(state, taskId);
    const evidence = await readEvidence(absoluteRunDir, milestone);
    const entries = currentAttemptEvidence(evidence, milestone, task);
    if (entries.length === 0) {
      throw new Error(`${taskId} has no evidence for its current attempt`);
    }
    if (
      entries.some((entry) => entry.kind === "command" && entry.exitCode !== 0)
    ) {
      throw new Error(
        `${taskId} has failing command evidence for its current attempt`,
      );
    }
    task.status = "done";
    task.completedAt = timestamp(now);
    task.stopReason = null;
    state.currentTask = null;
  });
}

export async function completeMilestone({ runDir, milestoneId, now }) {
  return mutateRun(runDir, now, async (state, absoluteRunDir) => {
    if (state.currentMilestone !== milestoneId) {
      throw new Error(`${milestoneId} is not the running milestone`);
    }
    if (state.currentTask)
      throw new Error(`Task ${state.currentTask} is still running`);
    const milestone = requireMilestone(state, milestoneId);
    const incompleteTasks = milestone.taskOrder.filter(
      (taskId) => milestone.tasks[taskId].status !== "done",
    );
    if (incompleteTasks.length > 0) {
      throw new Error(
        `${milestoneId} tasks are incomplete: ${incompleteTasks.join(", ")}`,
      );
    }
    const evidence = await readEvidence(absoluteRunDir, milestone);
    const entries = currentAttemptEvidence(evidence, milestone, null);
    if (
      entries.some((entry) => entry.kind === "command" && entry.exitCode !== 0)
    ) {
      throw new Error(
        `${milestoneId} has failing command evidence for its current attempt`,
      );
    }
    const covered = new Set(entries.flatMap((entry) => entry.criteria));
    const uncovered = milestone.criteria.filter(
      (criterion) => !covered.has(criterion),
    );
    if (uncovered.length > 0) {
      throw new Error(
        `${milestoneId} lacks evidence for criteria: ${uncovered.join(", ")}`,
      );
    }

    milestone.status = "done";
    milestone.completedAt = timestamp(now);
    milestone.stopReason = null;
    milestone.commit = await gitHead(workspaceRoot(absoluteRunDir));
    state.currentMilestone = null;
    state.currentTask = null;
    state.status = state.milestoneOrder.every(
      (id) => state.milestones[id].status === "done",
    )
      ? "complete"
      : "pending";
  });
}

export async function stopMilestone({
  runDir,
  milestoneId,
  status,
  reason,
  now,
}) {
  if (!STOP_STATUSES.has(status)) {
    throw new Error("Milestone stop status must be blocked or failed");
  }
  return mutateRun(runDir, now, (state) => {
    if (state.currentMilestone !== milestoneId) {
      throw new Error(`${milestoneId} is not the running milestone`);
    }
    const milestone = requireMilestone(state, milestoneId);
    const stopReason = compactText(reason, "stop reason", 1000);
    if (state.currentTask) {
      const task = milestone.tasks[state.currentTask];
      task.status = status;
      task.stopReason = stopReason;
    }
    milestone.status = status;
    milestone.stopReason = stopReason;
    state.status = status;
    state.currentMilestone = null;
    state.currentTask = null;
  });
}

export async function addDecision({
  runDir,
  milestoneId,
  summary,
  rationale,
  now,
}) {
  return withLock(runDir, async (absoluteRunDir) => {
    const state = await readRun(absoluteRunDir);
    await assertCurrentPlan(absoluteRunDir, state);
    requireMilestone(state, milestoneId);
    const decision = {
      milestoneId,
      summary: compactText(summary, "decision summary", 500),
      rationale: compactText(rationale, "decision rationale", 1000),
      recordedAt: timestamp(now),
    };
    await appendFile(
      join(absoluteRunDir, "decisions.jsonl"),
      `${JSON.stringify(decision)}\n`,
    );
    return decision;
  });
}

function parseFlags(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument ${key}`);
    const value = values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function required(flags, name) {
  if (!(name in flags)) throw new Error(`Missing --${name}`);
  return flags[name];
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function cli() {
  const [command, ...rawFlags] = process.argv.slice(2);
  const flags = parseFlags(rawFlags);
  const runDir = flags.run;
  switch (command) {
    case "validate":
      print(
        await validatePlan({
          cwd: flags.cwd ?? process.cwd(),
          planPath: required(flags, "plan"),
        }),
      );
      break;
    case "init":
      print(
        await initializeRun({
          cwd: flags.cwd ?? process.cwd(),
          planPath: required(flags, "plan"),
          runId: required(flags, "run-id"),
        }),
      );
      break;
    case "open":
      print(
        await openRun({
          cwd: flags.cwd ?? process.cwd(),
          planPath: required(flags, "plan"),
          runId: flags["run-id"],
        }),
      );
      break;
    case "status": {
      const state = await readRun(required(flags, "run"));
      let planDrift = false;
      try {
        await assertCurrentPlan(required(flags, "run"), state);
      } catch (error) {
        if (!String(error.message).startsWith("Plan fingerprint changed"))
          throw error;
        planDrift = true;
      }
      print({ state, planDrift });
      break;
    }
    case "next":
      print(await getNextWork(required(flags, "run")));
      break;
    case "milestone-start":
      print(
        await startMilestone({
          runDir: required(flags, "run"),
          milestoneId: required(flags, "milestone"),
        }),
      );
      break;
    case "task-start":
      print(
        await startTask({
          runDir: required(flags, "run"),
          taskId: required(flags, "task"),
          profile: required(flags, "profile"),
          profileReason: required(flags, "profile-reason"),
        }),
      );
      break;
    case "gate-repair-profile":
      print(
        await recordGateRepairProfile({
          runDir: required(flags, "run"),
          milestoneId: required(flags, "milestone"),
          profile: required(flags, "profile"),
          profileReason: required(flags, "profile-reason"),
        }),
      );
      break;
    case "evidence-add":
      print(
        await addEvidence({
          runDir: required(flags, "run"),
          milestoneId: required(flags, "milestone"),
          taskId: flags.task,
          criteria: required(flags, "criteria")
            .split(",")
            .map((item) => item.trim()),
          kind: required(flags, "kind"),
          summary: required(flags, "summary"),
          command: flags.command,
          exitCode:
            flags["exit-code"] === undefined
              ? undefined
              : Number(flags["exit-code"]),
          path: flags.path,
        }),
      );
      break;
    case "task-complete":
      print(
        await completeTask({
          runDir: required(flags, "run"),
          taskId: required(flags, "task"),
        }),
      );
      break;
    case "milestone-complete":
      print(
        await completeMilestone({
          runDir: required(flags, "run"),
          milestoneId: required(flags, "milestone"),
        }),
      );
      break;
    case "milestone-stop":
      print(
        await stopMilestone({
          runDir: required(flags, "run"),
          milestoneId: required(flags, "milestone"),
          status: required(flags, "status"),
          reason: required(flags, "reason"),
        }),
      );
      break;
    case "decision-add":
      print(
        await addDecision({
          runDir: required(flags, "run"),
          milestoneId: required(flags, "milestone"),
          summary: required(flags, "summary"),
          rationale: required(flags, "rationale"),
        }),
      );
      break;
    default:
      throw new Error(
        "Usage: plan-run-state.js <validate|init|open|status|next|milestone-start|task-start|gate-repair-profile|evidence-add|task-complete|milestone-complete|milestone-stop|decision-add> [flags]",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  cli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
