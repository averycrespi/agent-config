#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const TICKET_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,39}-\d{1,10}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const WORKER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const SHA = /^[a-f0-9]{40}$/;
const CONTRACT_HASH = /^sha256:[a-f0-9]{64}$/;
const STATUSES = new Set([
  "paused",
  "active",
  "blocked",
  "awaiting_human",
  "complete",
  "canceled",
]);
const PHASES = [
  "planning",
  "implementing",
  "verifying",
  "publishing",
  "reviewing",
];
const CI_STATES = new Set(["pass", "pending", "unavailable"]);
const MAX_STATE_BYTES = 64 * 1024;
const MAX_CONTRACT_BYTES = 128 * 1024;

function cleanText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must not be empty`);
  if (/\p{Cc}/u.test(value))
    throw new Error(`${name} must not contain control characters`);
  const text = value.trim();
  if (text.length > maxLength)
    throw new Error(`${name} must be at most ${maxLength} characters`);
  return text;
}

function optionalText(value, name, maxLength) {
  return value === null ? null : cleanText(value, name, maxLength);
}

function timestamp(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("now must be a valid timestamp");
  return date.toISOString();
}

function assertSha(value, name) {
  if (!SHA.test(value ?? ""))
    throw new Error(`${name} must be a 40-character lowercase commit SHA`);
  return value;
}

function assertUrl(value, name) {
  const text = cleanText(value, name, 1000);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${name} must be an absolute HTTP URL`);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol))
    throw new Error(`${name} must be an absolute HTTP URL`);
  return text;
}

function assertBranch(value, name) {
  const branch = cleanText(value, name, 200);
  if (
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    /[\s~^:?*\[\\]/.test(branch)
  ) {
    throw new Error(`${name} must be a valid simple Git branch name`);
  }
  return branch;
}

function validateIdentity(ticket, assignment) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket))
    throw new Error("ticket must be an object");
  if (
    !assignment ||
    typeof assignment !== "object" ||
    Array.isArray(assignment)
  ) {
    throw new Error("assignment must be an object");
  }
  const validatedTicket = {
    id: cleanText(ticket.id, "ticket.id", 200),
    identifier: cleanText(ticket.identifier, "ticket.identifier", 50),
    url: assertUrl(ticket.url, "ticket.url"),
    contractHash: ticket.contractHash,
  };
  if (!TICKET_IDENTIFIER.test(validatedTicket.identifier)) {
    throw new Error("ticket.identifier must look like ABC-123");
  }
  if (!CONTRACT_HASH.test(validatedTicket.contractHash ?? "")) {
    throw new Error("ticket.contractHash must be a sha256 hash");
  }

  const repository = cleanText(
    assignment.repository,
    "assignment.repository",
    201,
  );
  if (!REPOSITORY.test(repository))
    throw new Error("assignment.repository must look like owner/repository");
  const workerName = cleanText(
    assignment.workerName,
    "assignment.workerName",
    32,
  );
  if (!WORKER_NAME.test(workerName))
    throw new Error("assignment.workerName is invalid");

  return {
    ticket: validatedTicket,
    assignment: {
      repository,
      targetBranch: assertBranch(
        assignment.targetBranch,
        "assignment.targetBranch",
      ),
      branch: assertBranch(assignment.branch, "assignment.branch"),
      baseCommit: assertSha(assignment.baseCommit, "assignment.baseCommit"),
      herdrWorkspaceId: cleanText(
        assignment.herdrWorkspaceId,
        "assignment.herdrWorkspaceId",
        200,
      ),
      workerName,
    },
  };
}

function deriveNextAction(state) {
  if (state.status === "active") return { action: "work", phase: state.phase };
  if (state.status === "paused")
    return { action: "activate", phase: state.phase };
  if (state.status === "blocked")
    return { action: "resume", phase: state.phase };
  if (state.status === "awaiting_human") return { action: "await_human" };
  return { action: "none" };
}

function publicState(state) {
  return { ...structuredClone(state), nextAction: deriveNextAction(state) };
}

function validateState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1
  ) {
    throw new Error("invalid ticket-run schemaVersion");
  }
  if (!Number.isInteger(value.revision) || value.revision < 0)
    throw new Error("invalid ticket-run revision");
  if (!RUN_ID.test(value.runId ?? ""))
    throw new Error("invalid ticket-run runId");
  const identity = validateIdentity(value.ticket, value.assignment);
  if (!STATUSES.has(value.status)) throw new Error("invalid ticket-run status");
  if (!PHASES.includes(value.phase))
    throw new Error("invalid ticket-run phase");
  if (value.planSummary !== null)
    optionalText(value.planSummary, "planSummary", 2000);
  if (value.stopReason !== null)
    optionalText(value.stopReason, "stopReason", 1000);
  if (value.checkpoint !== null) {
    if (
      !value.checkpoint ||
      typeof value.checkpoint !== "object" ||
      Array.isArray(value.checkpoint)
    ) {
      throw new Error("invalid ticket-run checkpoint");
    }
    cleanText(value.checkpoint.summary, "checkpoint.summary", 1000);
    if (value.checkpoint.commit !== null)
      assertSha(value.checkpoint.commit, "checkpoint.commit");
  }
  const publication = value.publication;
  if (
    !publication ||
    typeof publication !== "object" ||
    Array.isArray(publication)
  ) {
    throw new Error("invalid ticket-run publication");
  }
  if (publication.draftPrUrl !== null)
    assertUrl(publication.draftPrUrl, "publication.draftPrUrl");
  if (publication.publishedHead !== null)
    assertSha(publication.publishedHead, "publication.publishedHead");
  if (publication.reviewedHead !== null)
    assertSha(publication.reviewedHead, "publication.reviewedHead");
  if (
    ![null, "pass", "changes_requested"].includes(publication.reviewOutcome)
  ) {
    throw new Error("invalid publication.reviewOutcome");
  }
  if (![null, ...CI_STATES].includes(publication.ciState))
    throw new Error("invalid publication.ciState");
  timestamp(value.createdAt);
  timestamp(value.updatedAt);
  return { ...value, ...identity };
}

async function rootAndRunDir(cwd, create = false) {
  const root = await realpath(resolve(cwd ?? process.cwd()));
  const runDir = join(root, ".ticket-run");
  try {
    const entry = await lstat(runDir);
    if (entry.isSymbolicLink())
      throw new Error(".ticket-run must not be a symbolic link");
    if (!entry.isDirectory())
      throw new Error(".ticket-run must be a directory");
  } catch (error) {
    if (error?.code !== "ENOENT" || !create) throw error;
    await mkdir(runDir);
  }
  const entry = await lstat(runDir);
  if (entry.isSymbolicLink() || !entry.isDirectory())
    throw new Error(".ticket-run must remain a real directory");
  if ((await realpath(runDir)) !== runDir)
    throw new Error(".ticket-run must not escape the repository");
  return {
    root,
    runDir,
    runDirIdentity: { dev: entry.dev, ino: entry.ino },
    statePath: join(runDir, "state.json"),
  };
}

async function assertRunDirIdentity(runDir, identity) {
  const entry = await lstat(runDir);
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    entry.dev !== identity.dev ||
    entry.ino !== identity.ino ||
    (await realpath(runDir)) !== runDir
  ) {
    throw new Error(".ticket-run changed during the state operation");
  }
}

async function acquireTicketRunLock(cwd) {
  const { runDir } = await rootAndRunDir(cwd);
  const lockDir = join(runDir, ".state.lock");
  const token = randomUUID();
  try {
    await mkdir(lockDir);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error("ticket run is locked by another helper process");
    throw error;
  }
  try {
    await writeFile(
      join(lockDir, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token })}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    await rm(lockDir, { recursive: true, force: true });
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      let owner;
      try {
        owner = JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8"));
      } catch {
        return;
      }
      if (owner?.token === token)
        await rm(lockDir, { recursive: true, force: true });
    },
  };
}

export const _ticketRunLock = { acquire: acquireTicketRunLock };

async function readRawState(cwd) {
  const { runDir, runDirIdentity, statePath } = await rootAndRunDir(cwd);
  const entry = await lstat(statePath);
  if (entry.isSymbolicLink() || !entry.isFile())
    throw new Error("state.json must be a regular file");
  if (entry.size > MAX_STATE_BYTES) throw new Error("state.json is too large");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid state.json: ${error.message}`);
  }
  return {
    state: validateState(parsed),
    runDir,
    runDirIdentity,
    statePath,
  };
}

async function atomicWrite(statePath, state, runDir, runDirIdentity) {
  await assertRunDirIdentity(runDir, runDirIdentity);
  const content = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_STATE_BYTES)
    throw new Error("state.json is too large");
  const temporary = `${statePath}.${process.pid}.${state.revision}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  try {
    await assertRunDirIdentity(runDir, runDirIdentity);
    await rename(temporary, statePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function hashTicketContract(contract) {
  if (typeof contract !== "string" || !contract.trim())
    throw new Error("contract must not be empty");
  if (Buffer.byteLength(contract) > MAX_CONTRACT_BYTES)
    throw new Error("contract is too large");
  return `sha256:${createHash("sha256").update(contract, "utf8").digest("hex")}`;
}

export async function initializeTicketRun({
  cwd,
  runId,
  ticket,
  assignment,
  now,
} = {}) {
  if (!RUN_ID.test(runId ?? "")) {
    throw new Error(
      "runId must use 1-80 letters, numbers, dots, underscores, or hyphens",
    );
  }
  const identity = validateIdentity(ticket, assignment);
  await rootAndRunDir(cwd, true);
  const lock = await acquireTicketRunLock(cwd);
  try {
    const { runDir, runDirIdentity, statePath } = await rootAndRunDir(cwd);
    try {
      await lstat(statePath);
      throw new Error("ticket run already exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const createdAt = timestamp(now);
    const state = validateState({
      schemaVersion: 1,
      revision: 0,
      runId,
      ...identity,
      status: "paused",
      phase: "planning",
      planSummary: null,
      checkpoint: null,
      publication: {
        draftPrUrl: null,
        publishedHead: null,
        reviewedHead: null,
        reviewOutcome: null,
        ciState: null,
      },
      stopReason: null,
      createdAt,
      updatedAt: createdAt,
    });
    await atomicWrite(statePath, state, runDir, runDirIdentity);
    return publicState(state);
  } finally {
    await lock.release();
  }
}

export async function readTicketRun({ cwd } = {}) {
  const { state } = await readRawState(cwd);
  return publicState(state);
}

function requireActive(state) {
  if (state.status !== "active")
    throw new Error("action requires an active run");
}

function applyProgress(state, request) {
  requireActive(state);
  const from = PHASES.indexOf(state.phase);
  const to = PHASES.indexOf(request.toPhase);
  const repair =
    state.phase === "reviewing" && request.toPhase === "implementing";
  if (to === -1 || (!repair && to !== from + 1)) {
    throw new Error(
      `invalid phase transition ${state.phase} -> ${request.toPhase}`,
    );
  }
  if (state.phase === "planning") {
    state.planSummary = cleanText(request.planSummary, "planSummary", 2000);
  }
  if (request.toPhase === "reviewing") {
    const draftPrUrl = assertUrl(request.draftPrUrl, "draftPrUrl");
    const publishedHead = assertSha(request.publishedHead, "publishedHead");
    if (request.draftPrConfirmed !== true)
      throw new Error("reviewing requires a confirmed draft PR");
    if (request.draftPrHead !== publishedHead)
      throw new Error("draft PR head must equal published head");
    if (request.draftPrTargetBranch !== state.assignment.targetBranch)
      throw new Error("draft PR target must equal assigned target branch");
    if (request.draftPrSourceBranch !== state.assignment.branch)
      throw new Error("draft PR source must equal assigned source branch");
    state.publication = {
      draftPrUrl,
      publishedHead,
      reviewedHead: null,
      reviewOutcome: null,
      ciState: null,
    };
  }
  if (repair) {
    state.publication.reviewedHead = null;
    state.publication.reviewOutcome = "changes_requested";
    state.publication.ciState = null;
  }
  state.phase = request.toPhase;
  state.stopReason = null;
}

function applyAction(state, request) {
  switch (request.action) {
    case "activate":
      if (state.status !== "paused")
        throw new Error("activate requires a paused run");
      state.status = "active";
      state.stopReason = null;
      return;
    case "resume":
      if (!["paused", "blocked"].includes(state.status))
        throw new Error("resume requires a paused or blocked run");
      state.status = "active";
      state.stopReason = null;
      return;
    case "progress":
      applyProgress(state, request);
      return;
    case "checkpoint":
      requireActive(state);
      state.checkpoint = {
        summary: cleanText(request.summary, "summary", 1000),
        commit:
          request.commit == null ? null : assertSha(request.commit, "commit"),
      };
      return;
    case "pause":
      if (!["active", "blocked"].includes(state.status))
        throw new Error("pause requires an active or blocked run");
      state.status = "paused";
      state.stopReason = cleanText(request.reason, "reason", 1000);
      return;
    case "block":
      requireActive(state);
      state.status = "blocked";
      state.stopReason = cleanText(request.reason, "reason", 1000);
      return;
    case "record_review":
      requireActive(state);
      if (state.phase !== "reviewing")
        throw new Error("record_review requires the reviewing phase");
      if (request.reviewOutcome !== "pass")
        throw new Error("record_review requires a passing review");
      if (request.reviewedHead !== state.publication.publishedHead)
        throw new Error("reviewed head must equal published head");
      state.publication.reviewedHead = request.reviewedHead;
      state.publication.reviewOutcome = "pass";
      return;
    case "handoff":
      requireActive(state);
      if (state.phase !== "reviewing")
        throw new Error("handoff requires the reviewing phase");
      if (
        state.publication.reviewOutcome !== "pass" ||
        state.publication.reviewedHead !== state.publication.publishedHead
      ) {
        throw new Error("handoff requires a recorded passing review");
      }
      if (request.reviewOutcome !== "pass")
        throw new Error("handoff requires a passing review");
      if (request.reviewedHead !== state.publication.reviewedHead)
        throw new Error("reviewed head must equal published head");
      if (request.ciState !== "pass")
        throw new Error("handoff requires passing CI");
      if (request.ciHead !== state.publication.publishedHead)
        throw new Error("CI head must equal published head");
      if (request.prReadyConfirmed !== true)
        throw new Error("handoff requires a PR ready for review");
      if (request.prReadyHead !== state.publication.publishedHead)
        throw new Error("ready PR head must equal published head");
      if (request.planeReviewConfirmed !== true)
        throw new Error("handoff requires confirmed Plane Review state");
      state.publication.reviewedHead = assertSha(
        request.reviewedHead,
        "reviewedHead",
      );
      state.publication.reviewOutcome = "pass";
      state.publication.ciState = request.ciState;
      state.status = "awaiting_human";
      state.stopReason = null;
      return;
    case "complete":
      if (state.status !== "awaiting_human")
        throw new Error("complete requires awaiting_human state");
      if (request.mergedHead !== state.publication.reviewedHead) {
        throw new Error("merged head must equal reviewed head");
      }
      if (request.planeDoneConfirmed !== true)
        throw new Error("complete requires confirmed Plane Done state");
      state.status = "complete";
      state.stopReason = null;
      return;
    case "cancel":
      if (["complete", "canceled"].includes(state.status))
        throw new Error("terminal run cannot be canceled");
      if (request.planeCanceledConfirmed !== true)
        throw new Error("cancel requires confirmed Plane Canceled state");
      state.status = "canceled";
      state.stopReason = cleanText(request.reason, "reason", 1000);
      return;
    default:
      throw new Error(`unknown action: ${request.action}`);
  }
}

export async function applyTicketRunAction({
  cwd,
  expectedRevision,
  now,
  ...request
} = {}) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("expectedRevision must be a non-negative integer");
  }
  const lock = await acquireTicketRunLock(cwd);
  try {
    const {
      state: current,
      runDir,
      runDirIdentity,
      statePath,
    } = await readRawState(cwd);
    if (current.revision !== expectedRevision) {
      throw new Error(
        `revision conflict: expected ${expectedRevision}, found ${current.revision}`,
      );
    }
    const state = structuredClone(current);
    applyAction(state, request);
    state.revision += 1;
    state.updatedAt = timestamp(now);
    validateState(state);
    await atomicWrite(statePath, state, runDir, runDirIdentity);
    return publicState(state);
  } finally {
    await lock.release();
  }
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_CONTRACT_BYTES * 2)
      throw new Error("request is too large");
  }
  if (!input.trim()) throw new Error("request must not be empty");
  return JSON.parse(input);
}

async function runCli() {
  const request = await readStdin();
  let state;
  if (request.action === "hash") {
    process.stdout.write(
      `${JSON.stringify({ hash: hashTicketContract(request.contract) })}\n`,
    );
    return;
  }
  if (request.action === "init") state = await initializeTicketRun(request);
  else if (request.action === "status") state = await readTicketRun(request);
  else if (
    [
      "activate",
      "resume",
      "progress",
      "checkpoint",
      "pause",
      "block",
      "record_review",
      "handoff",
      "complete",
      "cancel",
    ].includes(request.action)
  ) {
    state = await applyTicketRunAction(request);
  } else {
    throw new Error(`unknown action: ${request.action}`);
  }
  process.stdout.write(`${JSON.stringify({ state })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch((error) => {
    process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  });
}
