#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LIMIT = 256 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const TICKET_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const TERMINAL = new Set([
  "local_complete",
  "awaiting_human",
  "done",
  "canceled",
]);
const OPERATIONS = [
  "implement",
  "commit",
  "publish",
  "settle",
  "cancel",
  "cleanup",
];
const BLOCKERS = new Set([
  "security",
  "correctness",
  "acceptance",
  "compatibility",
  "data-integrity",
  "required-CI",
  "resource-requirement",
]);

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function text(value, name, max = 4000) {
  requireThat(
    typeof value === "string" &&
      value.trim() &&
      value.length <= max &&
      !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value),
    `invalid ${name}`,
  );
  return value;
}
function id(value) {
  requireThat(
    typeof value === "string" && ID.test(value),
    "invalid immutable ticket or owner ID",
  );
  return value;
}
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function authority(value) {
  requireThat(
    value &&
      Array.isArray(value.operations) &&
      value.operations.includes("implement") &&
      value.operations.every((op) => OPERATIONS.includes(op)),
    "invalid authorized operations",
  );
  requireThat(
    ["local", "pr"].includes(value.boundary),
    "invalid completion boundary",
  );
  requireThat(
    value.boundary !== "pr" ||
      (value.operations.includes("publish") &&
        value.operations.includes("commit")),
    "PR delivery requires explicit commit and publication authority",
  );
  return {
    operations: [...new Set(value.operations)],
    boundary: value.boundary,
    evidence: text(value.evidence, "authorization evidence"),
  };
}
function plan(value) {
  requireThat(
    Array.isArray(value) && value.length > 0 && value.length <= 40,
    "working plan is required",
  );
  return value.map((item) => {
    requireThat(
      ["todo", "in_progress", "done", "blocked"].includes(item.status),
      "invalid plan status",
    );
    return {
      step: text(item.step, "plan step"),
      verification: text(item.verification, "plan verification"),
      status: item.status,
    };
  });
}
async function directory(path, create) {
  if (create)
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  const stat = await lstat(path);
  requireThat(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (await realpath(path)) === path,
    "state path must be a real directory",
  );
  return { path, dev: stat.dev, ino: stat.ino };
}
async function excludeState(root) {
  requireThat(
    !git(root, "ls-files", "--", ".pi/tickets").trim(),
    "ticket state must never be staged or tracked",
  );
  const exclude = resolve(
    root,
    git(root, "rev-parse", "--git-path", "info/exclude").trim(),
  );
  const parent = resolve(exclude, "..");
  await directory(parent, true);
  let content = "";
  try {
    const stat = await lstat(exclude);
    requireThat(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMIT,
      "Git info exclude must be a bounded regular file",
    );
    content = await readFile(exclude, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!content.split(/\r?\n/).includes("/.pi/tickets/")) {
    await appendFile(
      exclude,
      `${content && !content.endsWith("\n") ? "\n" : ""}/.pi/tickets/\n`,
      { mode: 0o600 },
    );
  }
}
async function paths(cwd, ticketId, create = false) {
  requireThat(
    typeof ticketId === "string" && TICKET_ID.test(ticketId),
    "invalid immutable Plane ticket UUID; do not use the display identifier",
  );
  const root = await realpath(resolve(cwd));
  requireThat(
    (await realpath(git(root, "rev-parse", "--show-toplevel").trim())) === root,
    "cwd must be the repository root",
  );
  if (create) await excludeState(root);
  const identities = [];
  for (const path of [
    join(root, ".pi"),
    join(root, ".pi", "tickets"),
    join(root, ".pi", "tickets", ticketId),
  ])
    identities.push(await directory(path, create));
  const store = join(root, ".pi", "tickets");
  requireThat(
    !git(root, "ls-files", "--", ".pi/tickets").trim(),
    "ticket state must never be staged or tracked",
  );
  git(
    root,
    "check-ignore",
    "--quiet",
    "--",
    `.pi/tickets/${ticketId}/state.json`,
  );
  return { root, store, file: join(store, ticketId, "state.json"), identities };
}
async function assertPaths(p) {
  for (const prior of p.identities) {
    const current = await directory(prior.path, false);
    requireThat(
      current.dev === prior.dev && current.ino === prior.ino,
      "state directory changed during operation",
    );
  }
}
async function readState(file, ticketId) {
  const stat = await lstat(file);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMIT,
    "state must be a bounded regular file",
  );
  const state = JSON.parse(await readFile(file, "utf8"));
  validate(state);
  requireThat(state.ticketId === ticketId, "state ticket identity mismatch");
  return state;
}
function validate(s) {
  requireThat(
    s?.schemaVersion === 1 && Number.isInteger(s.revision) && s.revision >= 0,
    "invalid ticket state schema or revision",
  );
  requireThat(TICKET_ID.test(s.ticketId), "invalid immutable ticket UUID");
  id(s.runId);
  id(s.owner);
  text(s.identifier, "ticket identifier");
  text(s.contract, "scope baseline", 100000);
  requireThat(
    ["active", "blocked", "waiting", ...TERMINAL].includes(s.status) &&
      !("phase" in s),
    "invalid ticket status or phase cursor",
  );
  authority(s.authorization);
  plan(s.plan);
  requireThat(
    Number.isInteger(s.repairCount) && s.repairCount >= 0 && s.repairCount <= 2,
    "invalid repair count",
  );
  requireThat(
    Array.isArray(s.findings) &&
      Array.isArray(s.repairs) &&
      s.repairs.length === s.repairCount &&
      Array.isArray(s.externalWrites),
    "invalid findings, repairs or external writes",
  );
  requireThat(
    s.assignment &&
      /^[\w.-]+\/[\w.-]+$/.test(s.assignment.repository) &&
      SHA.test(s.assignment.baseCommit) &&
      typeof s.assignment.branch === "string" &&
      typeof s.assignment.targetBranch === "string",
    "invalid repository assignment",
  );
  requireThat(
    s.snapshot &&
      SHA.test(s.snapshot.head) &&
      HASH.test(s.snapshot.fingerprint),
    "invalid revision snapshot",
  );
  text(s.progress, "progress");
  text(s.nextAction, "next action");
  requireThat(s.evidence && typeof s.evidence === "object", "invalid evidence");
}
async function snapshot(root) {
  const head = git(root, "rev-parse", "HEAD").trim();
  const branch = git(root, "symbolic-ref", "--short", "HEAD").trim();
  const digest = createHash("sha256")
    .update(head)
    .update(
      git(
        root,
        "diff",
        "HEAD",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        ".",
        ":(exclude).pi/tickets",
        ":(exclude).ticket-run",
      ),
    );
  const untracked = git(
    root,
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
    ":(exclude).ticket-run",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const name of untracked) {
    const file = join(root, name);
    const stat = await lstat(file);
    requireThat(
      stat.isFile() || stat.isSymbolicLink(),
      "unsupported untracked artifact",
    );
    requireThat(
      stat.size <= 16 * 1024 * 1024,
      "untracked artifact too large to fingerprint",
    );
    digest
      .update(JSON.stringify([name, stat.mode]))
      .update(
        stat.isSymbolicLink() ? await readlink(file) : await readFile(file),
      );
  }
  return {
    head,
    branch,
    fingerprint: `sha256:${digest.digest("hex")}`,
    clean: !git(root, "status", "--porcelain", "--untracked-files=all").trim(),
  };
}
async function locked(p, fn) {
  const lock = join(p.store, ".writer.lock");
  await mkdir(lock).catch((error) => {
    if (error.code === "EEXIST")
      throw new Error(
        "checkout state is locked by another helper; inspect owner before recovery",
      );
    throw error;
  });
  const token = randomUUID();
  await writeFile(
    join(lock, "owner.json"),
    JSON.stringify({ pid: process.pid, token }),
    { flag: "wx", mode: 0o600 },
  );
  try {
    return await fn();
  } finally {
    await assertPaths(p);
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    if (owner.token === token) await rm(lock, { recursive: true });
  }
}
async function persist(p, s) {
  validate(s);
  const content = `${JSON.stringify(s, null, 2)}\n`;
  requireThat(
    Buffer.byteLength(content) <= LIMIT,
    "state too large; retain concise evidence, not transcripts",
  );
  await assertPaths(p);
  const temporary = `${p.file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  try {
    await assertPaths(p);
    await rename(temporary, p.file);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function noOtherWriter(p, ticketId) {
  for (const entry of await readdir(p.store, { withFileTypes: true })) {
    if (entry.name === ".writer.lock" || entry.name === ticketId) continue;
    requireThat(
      entry.isDirectory() && !entry.isSymbolicLink() && ID.test(entry.name),
      "unexpected ticket store entry",
    );
    const entryPath = join(p.store, entry.name);
    if ((await readdir(entryPath)).length === 0) continue;
    const other = await readState(join(entryPath, "state.json"), entry.name);
    requireThat(
      TERMINAL.has(other.status),
      `checkout already owned by ticket ${other.ticketId}`,
    );
  }
}
function deliveryArchive(s) {
  return structuredClone({
    revision: s.revision,
    owner: s.owner,
    contract: s.contract,
    authorization: s.authorization,
    completionAuthorization: s.completionAuthorization ?? s.authorization,
    plan: s.plan,
    progress: s.progress,
    nextAction: s.nextAction,
    blocker: s.blocker,
    snapshot: s.snapshot,
    evidence: s.evidence,
    review: s.review,
    findings: s.findings,
    repairCount: s.repairCount,
    reconciliation: s.reconciliation ?? null,
  });
}
function invalidate(s, current) {
  if (s.snapshot.fingerprint !== current.fingerprint) {
    s.evidence = {};
    if (s.review) s.review.stale = true;
  }
  s.snapshot = current;
}
function permitted(s, op) {
  if (op === "settle" && s.humanAcceptance) return;
  requireThat(
    s.authorization.operations.includes(op),
    `${op} is not authorized`,
  );
}
function verified(s) {
  requireThat(
    s.evidence.verification?.fingerprint === s.snapshot.fingerprint &&
      s.evidence.verification.passed === true,
    "current revision requires passing required checks",
  );
}
function openBlockers(s) {
  return s.findings.filter((f) => f.blocking && f.disposition === "open");
}
function reviewed(s) {
  verified(s);
  requireThat(
    s.review &&
      !s.review.stale &&
      s.review.fingerprint === s.snapshot.fingerprint &&
      s.review.complete &&
      !openBlockers(s).length,
    "current revision requires complete independent review without blockers",
  );
}
function publicationGate(s) {
  permitted(s, "publish");
  verified(s);
  requireThat(
    s.authorization.boundary === "pr",
    "publication requires PR completion boundary",
  );
  requireThat(
    s.assignment.branch !== s.assignment.targetBranch && s.snapshot.clean,
    "publication requires a clean separate source branch",
  );
  requireThat(
    s.evidence.safety?.fingerprint === s.snapshot.fingerprint &&
      s.evidence.safety.passed === true,
    "publication requires outgoing-history and metadata safety evidence",
  );
}
function prIdentity(s, pr) {
  requireThat(
    pr &&
      typeof pr.url === "string" &&
      pr.url.startsWith(
        `https://github.com/${s.assignment.repository}/pull/`,
      ) &&
      /^\d+$/.test(pr.url.split("/").at(-1)),
    "invalid PR identity",
  );
  requireThat(
    pr.head === s.snapshot.head &&
      pr.branch === s.assignment.branch &&
      pr.base === s.assignment.targetBranch &&
      pr.open === true,
    "PR head/source/base/open identity mismatch",
  );
  if (s.pr) requireThat(s.pr.url === pr.url, "PR identity changed");
}
function gate(s, operation, observations = {}) {
  if (operation === "publish") publicationGate(s);
  else if (operation === "promote") {
    publicationGate(s);
    reviewed(s);
    requireThat(
      s.pr?.head === s.snapshot.head &&
        s.evidence.ci?.fingerprint === s.snapshot.fingerprint &&
        s.evidence.ci.passed === true,
      "promotion requires published exact-head passing CI",
    );
  } else {
    permitted(s, operation);
    if (operation === "settle" && s.humanAcceptance) {
      requireThat(
        s.status !== "done" &&
          s.status !== "canceled" &&
          observations.mergeConfirmed === true &&
          observations.mergedHead === s.humanAcceptance.pr.head &&
          observations.prUrl === s.humanAcceptance.pr.url &&
          observations.currentHead === s.humanAcceptance.pr.head,
        "accepted settlement requires the exact confirmed merged PR/head",
      );
    } else if (operation === "settle") {
      requireThat(
        ["local_complete", "awaiting_human"].includes(s.status),
        "settlement requires completed delivery before external writes",
      );
      verified(s);
      if (s.status === "awaiting_human") {
        reviewed(s);
        requireThat(
          observations.mergeConfirmed === true &&
            observations.mergedHead === s.pr?.head &&
            s.pr?.head === s.snapshot.head,
          "settlement requires confirmed reviewed merged head before external writes",
        );
      }
    } else if (operation === "cleanup") {
      requireThat(
        ["done", "canceled"].includes(s.status),
        "cleanup requires settled or canceled delivery",
      );
      requireThat(
        s.snapshot.clean &&
          observations.noLiveWriter === true &&
          observations.noUnpushedWork === true &&
          observations.prDispositionKnown === true &&
          observations.planeState ===
            (s.status === "done" ? "Done" : "Canceled"),
        "cleanup requires clean checkout, no live writer or unpushed work, known PR disposition and matching Plane state",
      );
    } else if (operation === "cancel") {
      requireThat(
        !["done", "canceled"].includes(s.status),
        "terminal settlement cannot be canceled again",
      );
    }
  }
}
async function acceptMerged(p, s, r, current) {
  requireThat(
    !s.humanAcceptance && !["done", "canceled"].includes(s.status),
    "delivery already disposed",
  );
  const a = r.acceptance;
  requireThat(
    a?.source === "user" &&
      a.ticketId === s.ticketId &&
      a.runId === s.runId &&
      a.acceptMerged === true,
    "explicit applicable user acceptance with ticket/run identity is required",
  );
  text(a.instruction, "actual user instruction");
  text(a.reference, "user instruction reference");
  requireThat(
    r.noLiveWriter === true,
    "acceptance reconciliation requires no live writer",
  );
  const pr = r.pr;
  requireThat(
    s.pr &&
      pr &&
      pr.url === s.pr.url &&
      pr.url.startsWith(
        `https://github.com/${s.assignment.repository}/pull/`,
      ) &&
      /^\d+$/.test(pr.url.split("/").at(-1)) &&
      pr.branch === s.assignment.branch &&
      pr.base === s.assignment.targetBranch &&
      SHA.test(pr.head) &&
      pr.head === current.head &&
      pr.merged === true &&
      r.mergeConfirmed === true,
    "acceptance requires confirmed merged PR/source/base/current-head identity",
  );
  text(r.mergeEvidence, "reread merge evidence");
  if (s.pr.head !== pr.head) {
    const successor = r.successor;
    requireThat(
      successor &&
        successor.ticketId !== s.ticketId &&
        successor.priorHead === s.pr.head &&
        successor.mergedHead === pr.head,
      "superseding head requires explicit successor relationship",
    );
    const other = await readState(
      join(p.store, successor.ticketId, "state.json"),
      successor.ticketId,
    );
    requireThat(
      other.runId === successor.runId &&
        other.assignment.root === p.root &&
        other.assignment.repository === s.assignment.repository &&
        other.assignment.branch === pr.branch &&
        other.assignment.targetBranch === pr.base &&
        other.pr?.url === pr.url &&
        other.pr.head === pr.head,
      "successor ticket/run/PR identity mismatch",
    );
    text(successor.authorizationEvidence, "explicit successor authorization");
    git(p.root, "merge-base", "--is-ancestor", s.pr.head, pr.head);
  } else
    requireThat(r.successor === undefined, "unexpected successor relationship");
  const waived = [];
  if (!["local_complete", "awaiting_human"].includes(s.status))
    waived.push("completed-delivery");
  if (
    !(
      s.evidence.verification?.passed === true &&
      s.evidence.verification.fingerprint === current.fingerprint
    )
  )
    waived.push("required-checks");
  if (
    !(
      s.review?.complete &&
      !s.review.stale &&
      s.review.fingerprint === current.fingerprint &&
      !openBlockers(s).length
    )
  )
    waived.push("independent-review");
  if (s.pr.head !== pr.head) waived.push("published-head");
  if (s.snapshot.fingerprint !== current.fingerprint)
    waived.push("delivery-snapshot");
  requireThat(
    Array.isArray(a.waivedPrerequisites) &&
      JSON.stringify([...a.waivedPrerequisites].sort()) ===
        JSON.stringify(waived.sort()),
    `explicit acceptance must name exactly the waived prerequisites: ${waived.join(", ")}`,
  );
  s.humanAcceptance = {
    authorization: structuredClone(a),
    pr: structuredClone(pr),
    mergeEvidence: r.mergeEvidence,
    successor: r.successor ? structuredClone(r.successor) : null,
    priorDelivery: deliveryArchive(s),
    observedSnapshot: current,
  };
}

function apply(s, r) {
  switch (r.action) {
    case "checkpoint":
      if (r.plan !== undefined) s.plan = plan(r.plan);
      s.progress = text(r.progress, "progress");
      s.nextAction = text(r.nextAction, "next action");
      if (r.status !== undefined) {
        requireThat(
          ["active", "waiting", "blocked"].includes(r.status),
          "invalid checkpoint status",
        );
        s.status = r.status;
      }
      s.blocker =
        s.status === "active"
          ? null
          : text(r.blocker, "blocker or waiting condition");
      break;
    case "authorize":
      s.authorization = authority(r.authorization);
      if (r.contract !== s.contract) {
        s.contract = text(r.contract, "authorized scope baseline", 100000);
        s.evidence = {};
        if (s.review) s.review.stale = true;
      }
      break;
    case "reopen_local": {
      requireThat(
        s.status === "local_complete" &&
          s.authorization.boundary === "local" &&
          !s.pr,
        "reopen_local requires local completion without a recorded PR",
      );
      requireThat(
        s.externalWrites.every(
          (w) => w.operation === "implement" && w.outcome === "confirmed",
        ),
        "reopen_local requires confirmed implementation-only external history",
      );
      requireThat(
        r.planeState === "In Progress" && r.noPrConfirmed === true,
        "reopen_local requires fresh Plane In Progress and no-PR observations",
      );
      const authorization = authority(r.authorization);
      requireThat(
        authorization.boundary === "local" &&
          authorization.operations.every((op) =>
            ["implement", "commit"].includes(op),
          ),
        "reopen_local accepts only explicit local implementation/commit authority",
      );
      const nextContract = text(
        r.newContract,
        "follow-up scope baseline",
        100000,
      );
      const nextPlan = plan(r.plan);
      const observations = text(r.observations, "follow-up reconciliation");
      s.localFollowups ??= [];
      s.localFollowups.push(deliveryArchive(s));
      s.authorization = authorization;
      delete s.completionAuthorization;
      s.contract = nextContract;
      s.plan = nextPlan;
      s.evidence = {};
      if (s.review) s.review.stale = true;
      s.reconciliation = { observations, fingerprint: r.fingerprint };
      s.status = "active";
      s.blocker = null;
      s.progress =
        "Explicitly authorized local follow-up; prior delivery archived";
      s.nextAction =
        "Implement the follow-up plan and record fresh verification evidence";
      break;
    }
    case "begin_pr": {
      requireThat(
        s.status === "local_complete" && !s.pr && !s.prDelivery,
        "begin_pr requires local completion without prior PR delivery",
      );
      permitted(s, "implement");
      permitted(s, "commit");
      requireThat(
        s.completionAuthorization?.operations.includes("implement") &&
          s.completionAuthorization.operations.includes("commit"),
        "begin_pr requires implementation/commit authority at local completion",
      );
      requireThat(
        s.externalWrites.every(
          (w) => w.operation === "implement" && w.outcome === "confirmed",
        ),
        "begin_pr requires confirmed implementation-only external history",
      );
      requireThat(
        r.planeState === "In Progress" && r.noPrConfirmed === true,
        "begin_pr requires fresh Plane In Progress and no-PR observations",
      );
      verified(s);
      requireThat(
        !openBlockers(s).length,
        "unresolved blockers prevent PR transition",
      );
      const publicationEvidence = text(
        r.publicationEvidence,
        "explicit push/PR authorization evidence",
      );
      const observations = text(r.observations, "PR delivery reconciliation");
      s.prDelivery = deliveryArchive(s);
      s.authorization = {
        operations: ["implement", "commit", "publish"],
        boundary: "pr",
        evidence: publicationEvidence,
      };
      delete s.evidence.safety;
      delete s.evidence.ci;
      s.reconciliation = { observations, fingerprint: r.fingerprint };
      s.status = "active";
      s.blocker = null;
      s.progress =
        "Explicitly authorized publication of the unchanged local delivery";
      s.nextAction =
        "Scan outgoing history and PR metadata, then follow publication and exact-head review/CI gates";
      break;
    }
    case "reconcile":
      text(r.observations, "ticket/files/Git/PR/check reconciliation");
      s.reconciliation = {
        observations: r.observations,
        fingerprint: s.snapshot.fingerprint,
      };
      s.status = "active";
      s.blocker = null;
      break;
    case "evidence": {
      requireThat(
        ["verification", "safety", "ci"].includes(r.kind) &&
          typeof r.passed === "boolean",
        "invalid evidence kind or outcome",
      );
      requireThat(
        r.fingerprint === s.snapshot.fingerprint,
        "evidence revision mismatch",
      );
      if (r.kind === "safety") {
        permitted(s, "publish");
        requireThat(
          r.historyScanned === true &&
            r.metadataScanned === true &&
            r.publicContentChecked === true,
          "complete outgoing-history and metadata scans are required",
        );
        requireThat(
          HASH.test(r.metadataHash),
          "metadataHash must be a SHA-256 digest of scanned title/body bytes",
        );
      }
      if (r.kind === "ci")
        requireThat(
          s.pr?.head === s.snapshot.head && r.head === s.snapshot.head,
          "CI head mismatch",
        );
      s.evidence[r.kind] = {
        fingerprint: r.fingerprint,
        passed: r.passed,
        summary: text(r.summary, "evidence summary"),
        ...(r.kind === "safety"
          ? { metadataHash: text(r.metadataHash, "scanned PR metadata hash") }
          : {}),
      };
      break;
    }
    case "review": {
      verified(s);
      requireThat(
        r.fingerprint === s.snapshot.fingerprint &&
          r.independent === true &&
          typeof r.complete === "boolean",
        "independent review revision/completeness required",
      );
      requireThat(
        Array.isArray(r.findings) &&
          r.findings.length <= 100 &&
          Array.isArray(r.resolutions),
        "consolidated findings and resolutions required",
      );
      const resolved = new Set();
      for (const resolution of r.resolutions) {
        const finding = s.findings.find((f) => f.id === resolution.id);
        requireThat(
          finding &&
            finding.disposition === "open" &&
            !resolved.has(finding.id) &&
            ["fixed", "not-applicable"].includes(resolution.disposition),
          "invalid finding resolution",
        );
        finding.disposition = resolution.disposition;
        finding.resolution = text(
          resolution.evidence,
          "independent resolution evidence",
        );
        resolved.add(finding.id);
      }
      for (const f of r.findings) {
        id(f.id);
        requireThat(
          typeof f.blocking === "boolean" &&
            (!f.blocking || BLOCKERS.has(f.category)),
          "blocker requires a supported violation category",
        );
        requireThat(
          !s.findings.some((old) => old.id === f.id),
          "finding ID already exists; retain open findings or supply resolutions",
        );
        s.findings.push({
          id: f.id,
          blocking: f.blocking,
          category: text(f.category, "category"),
          evidence: text(f.evidence, "finding evidence"),
          disposition: "open",
        });
      }
      s.review = {
        fingerprint: r.fingerprint,
        complete: r.complete,
        stale: false,
        summary: text(r.summary, "review evidence"),
        sequence: (s.review?.sequence ?? 0) + 1,
      };
      if (openBlockers(s).length && s.repairCount === 2) {
        s.status = "blocked";
        s.blocker =
          "Review repair allowance exhausted; remaining blockers require human handoff";
        s.nextAction = s.blocker;
      }
      break;
    }
    case "begin_repair":
      permitted(s, "implement");
      requireThat(
        s.review &&
          !s.review.stale &&
          s.review.complete &&
          openBlockers(s).length,
        "repair requires consolidated complete review with blockers",
      );
      requireThat(s.repairCount < 2, "review repair allowance exhausted");
      requireThat(
        !s.repairs.some((r) => r.reviewSequence === s.review.sequence),
        "repair batch already consumed; resume the recorded batch",
      );
      s.repairCount += 1;
      s.repairs.push({
        reviewSequence: s.review.sequence,
        findings: openBlockers(s).map((f) => f.id),
        plan: text(r.repairPlan, "repair plan"),
        fingerprint: s.snapshot.fingerprint,
      });
      s.nextAction =
        "Complete the recorded repair batch, rerun affected checks, then focused confirmation review";
      s.evidence = {};
      s.review.stale = true;
      break;
    case "external": {
      requireThat(
        ["pending", "confirmed"].includes(r.outcome),
        "invalid external write outcome",
      );
      requireThat(
        [
          "publish",
          "promote",
          "settle",
          "cancel",
          "cleanup",
          "implement",
        ].includes(r.operation),
        "invalid external operation",
      );
      gate(s, r.operation, r);
      requireThat(
        r.operation !== "cleanup",
        "use prepare_cleanup and durable cleanup confirmation",
      );
      const key = text(r.key, "idempotency key", 200);
      const prior = s.externalWrites.find((w) => w.key === key);
      const intent = text(r.intent, "external intent");
      if (prior) {
        requireThat(
          prior.operation === r.operation && prior.intent === intent,
          "external write key conflicts with prior intent",
        );
        requireThat(
          !(prior.outcome === "confirmed" && r.outcome === "pending"),
          "confirmed external write must not be repeated",
        );
        prior.outcome = r.outcome;
        prior.evidence = text(r.summary, "external evidence");
      } else
        s.externalWrites.push({
          key,
          operation: r.operation,
          intent,
          outcome: r.outcome,
          evidence: text(r.summary, "external evidence"),
        });
      break;
    }
    case "publication":
      publicationGate(s);
      prIdentity(s, r.pr);
      requireThat(
        r.pr.draft === true &&
          r.confirmed === true &&
          r.metadataHash === s.evidence.safety.metadataHash,
        "publication requires reread draft PR and scanned metadata",
      );
      s.pr = structuredClone(r.pr);
      break;
    case "handoff":
      verified(s);
      requireThat(
        !openBlockers(s).length &&
          (!s.review || (!s.review.stale && s.review.complete)),
        "unresolved blockers or incomplete review prevent handoff",
      );
      if (s.authorization.boundary === "pr") {
        gate(s, "promote");
        prIdentity(s, r.pr);
        requireThat(
          r.pr.draft === false &&
            r.confirmed === true &&
            r.planeState === "Review",
          "handoff requires confirmed ready PR and Plane Review",
        );
        s.pr = structuredClone(r.pr);
        s.status = "awaiting_human";
      } else {
        requireThat(
          r.planeState === "In Progress",
          "local completion leaves Plane In Progress",
        );
        s.status = "local_complete";
        s.completionAuthorization = structuredClone(s.authorization);
      }
      s.progress = text(r.summary, "handoff evidence");
      s.nextAction =
        "Human handoff; no further execution authorized by completion";
      break;
    case "settle":
      gate(s, "settle", r);
      requireThat(
        r.confirmed === true && r.planeState === "Done",
        "settlement requires confirmed Plane Done",
      );
      requireThat(
        s.humanAcceptance ||
          s.status === "local_complete" ||
          (s.status === "awaiting_human" &&
            r.mergedHead === s.pr?.head &&
            s.review?.fingerprint === s.snapshot.fingerprint),
        "settlement requires local completion or confirmed reviewed merged head",
      );
      s.status = "done";
      s.nextAction = "Cleanup only with separate authority";
      break;
    case "cancel":
      gate(s, "cancel", r);
      requireThat(
        r.confirmed === true && r.planeState === "Canceled",
        "cancellation requires confirmed Plane Canceled",
      );
      s.status = "canceled";
      s.blocker = text(r.reason, "cancellation reason");
      s.nextAction = "Cleanup only with separate authority";
      break;
    default:
      throw new Error(`unknown action: ${r.action}`);
  }
}

const JOURNAL_LIMIT = 4 * 1024 * 1024;
function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
async function evidenceBlob(archive, hash) {
  requireThat(HASH.test(hash), "invalid cleanup evidence digest");
  await directory(join(archive, "evidence"), false);
  const file = join(archive, "evidence", hash.slice(7));
  const stat = await lstat(file);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMIT,
    "invalid cleanup evidence file",
  );
  const bytes = await readFile(file);
  requireThat(digest(bytes) === hash, "cleanup evidence digest mismatch");
  return bytes;
}
function cleanupIdentity(s) {
  return {
    ticketId: s.ticketId,
    runId: s.runId,
    owner: s.owner,
    revision: s.revision,
    contractHash: digest(s.contract),
    status: s.status,
    assignment: s.assignment,
  };
}
async function archiveFiles(root, archive, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    if (!prefix && entry.name === ".writer.lock") continue;
    const name = join(prefix, entry.name);
    requireThat(!entry.isSymbolicLink(), "evidence archive refuses symlinks");
    if (entry.isDirectory())
      files.push(...(await archiveFiles(root, archive, name)));
    else {
      const stat = await lstat(join(root, name));
      requireThat(
        stat.isFile() && stat.size <= LIMIT,
        "evidence must be bounded regular files",
      );
      const bytes = await readFile(join(root, name));
      const hash = digest(bytes);
      if (archive) {
        await directory(join(archive, "evidence"), true);
        const target = join(archive, "evidence", hash.slice(7));
        if (await absent(target)) {
          const temporary = `${target}.${randomUUID()}.tmp`;
          await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
          try {
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
        }
        requireThat(
          (await evidenceBlob(archive, hash)).equals(bytes),
          "cleanup evidence copy mismatch",
        );
      }
      files.push({ path: name, size: bytes.length, digest: hash });
    }
    requireThat(
      Buffer.byteLength(JSON.stringify(files)) <= JOURNAL_LIMIT,
      "cleanup evidence too large",
    );
  }
  return files;
}
async function journalPaths(r, sourceRoot) {
  requireThat(
    typeof r.archiveDir === "string" && resolve(r.archiveDir) === r.archiveDir,
    "absolute durable archiveDir required",
  );
  const identity = await directory(r.archiveDir, false);
  requireThat(
    r.archiveDir !== sourceRoot && !r.archiveDir.startsWith(`${sourceRoot}/`),
    "cleanup journal must survive outside the removed checkout",
  );
  return {
    root: r.archiveDir,
    store: r.archiveDir,
    file: join(r.archiveDir, "cleanup.json"),
    identities: [identity],
  };
}
async function writeJournal(p, journal) {
  const content = `${JSON.stringify(journal, null, 2)}\n`;
  requireThat(
    Buffer.byteLength(content) <= JOURNAL_LIMIT,
    "cleanup journal too large",
  );
  await assertPaths(p);
  const temporary = `${p.file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  try {
    await assertPaths(p);
    await rename(temporary, p.file);
  } finally {
    await rm(temporary, { force: true });
  }
}
function cleanupAuthority(r) {
  const a = r.cleanupAuthorization;
  requireThat(
    a?.source === "user" && a.removeCheckout === true,
    "separate explicit user cleanup authorization required",
  );
  text(a.instruction, "cleanup user instruction");
  text(a.reference, "cleanup instruction reference");
  return structuredClone(a);
}
async function cleanupRecords(p, r, current) {
  requireThat(
    r.noLiveWriter === true &&
      r.noUnpushedWork === true &&
      r.prDispositionKnown === true &&
      r.noUniqueIgnoredWork === true &&
      r.evidencePreserved === true,
    "cleanup requires no live writer, dirty/unique work or unpreserved evidence",
  );
  text(
    r.safetyEvidence,
    "fresh process/Git/remote/PR/Plane and ignored-file observations",
  );
  requireThat(current.clean, "cleanup requires clean checkout");
  for (const operation of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "BISECT_LOG",
  ]) {
    requireThat(
      await absent(
        resolve(
          p.root,
          git(p.root, "rev-parse", "--git-path", operation).trim(),
        ),
      ),
      "cleanup refuses an in-progress Git operation",
    );
  }
  requireThat(
    Array.isArray(r.tickets) && r.tickets.length > 0,
    "all retained ticket identities required",
  );
  const records = [];
  for (const entry of await readdir(p.store, { withFileTypes: true })) {
    if (entry.name === ".writer.lock") continue;
    requireThat(
      entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        TICKET_ID.test(entry.name),
      "unexpected ticket store entry",
    );
    if (!(await readdir(join(p.store, entry.name))).length) continue;
    const s = await readState(
      join(p.store, entry.name, "state.json"),
      entry.name,
    );
    const claim = r.tickets.find((item) => item.ticketId === s.ticketId);
    requireThat(
      claim &&
        claim.runId === s.runId &&
        claim.owner === s.owner &&
        claim.expectedRevision === s.revision &&
        claim.contractHash === digest(s.contract) &&
        s.assignment.root === p.root &&
        s.assignment.branch === current.branch,
      "cleanup ticket/run/owner/revision/checkout identity mismatch",
    );
    gate({ ...s, snapshot: current }, "cleanup", {
      ...r,
      planeState: claim.planeState,
    });
    records.push(cleanupIdentity(s));
  }
  requireThat(
    records.length === r.tickets.length,
    "cleanup must cover each retained ticket exactly once",
  );
  return records;
}
async function prepareCleanup(p, r, current) {
  const authorization = cleanupAuthority(r);
  const records = await cleanupRecords(p, r, current);
  const archive = await journalPaths(r, p.root);
  return locked(archive, async () => {
    requireThat(
      await absent(archive.file),
      "cleanup journal exists; reread before retry",
    );
    const files = await archiveFiles(p.store, archive.root);
    const journal = {
      schemaVersion: 1,
      cleanupId: id(r.cleanupId),
      revision: 0,
      outcome: "pending",
      retries: 0,
      sourceRoot: p.root,
      sourceStore: p.store,
      snapshot: current,
      authorization,
      key: text(r.key, "cleanup idempotency key", 200),
      intent: text(
        r.intent,
        "exact cleanup intent (checkout/workspace; retain branch)",
      ),
      safetyEvidence: r.safetyEvidence,
      records,
      files,
      recovered: false,
    };
    await writeJournal(archive, journal);
    return journal;
  });
}
async function cleanupJournal(r) {
  const p = await journalPaths(r, "\0");
  return locked(p, async () => {
    if (r.action === "adopt_cleanup") {
      requireThat(
        await absent(p.file),
        "cleanup journal exists; reread before retry",
      );
      const authorization = cleanupAuthority(r);
      const source = await directory(resolve(r.sourceDirectory), false);
      const s = await readState(join(source.path, "state.json"), r.ticketId);
      requireThat(
        s.runId === r.runId &&
          s.owner === r.owner &&
          s.revision === r.expectedRevision &&
          s.contract === r.contract &&
          ["done", "canceled"].includes(s.status),
        "archived settled identity mismatch",
      );
      requireThat(
        digest(await readFile(join(source.path, "state.json"))) ===
          r.sourceDigest,
        "archived state digest mismatch",
      );
      requireThat(
        await absent(s.assignment.root),
        "archive adoption requires already removed checkout",
      );
      requireThat(
        r.archiveDir !== s.assignment.root &&
          !r.archiveDir.startsWith(`${s.assignment.root}/`),
        "archive must survive cleanup",
      );
      const intent = s.externalWrites.find(
        (w) => w.operation === "cleanup" && w.key === r.key,
      );
      requireThat(
        intent && intent.intent === r.intent,
        "archive adoption requires matching original cleanup intent",
      );
      permitted(s, "cleanup");
      requireThat(
        r.planeState === (s.status === "done" ? "Done" : "Canceled") &&
          r.prDispositionKnown === true,
        "archive adoption requires matching Plane and known PR disposition",
      );
      const journal = {
        schemaVersion: 1,
        cleanupId: id(r.cleanupId),
        revision: 0,
        outcome: "pending",
        retries: 0,
        sourceRoot: s.assignment.root,
        authorization,
        key: r.key,
        intent: r.intent,
        records: [cleanupIdentity(s)],
        files: await archiveFiles(source.path, p.root),
        recovered: true,
        recoveryEvidence: text(
          r.recoveryEvidence,
          "archive provenance and fresh removal observations",
        ),
      };
      await writeJournal(p, journal);
      return journal;
    }
    const stat = await lstat(p.file);
    requireThat(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= JOURNAL_LIMIT,
      "invalid cleanup journal file",
    );
    const j = JSON.parse(await readFile(p.file, "utf8"));
    requireThat(
      j.schemaVersion === 1 &&
        j.cleanupId === r.cleanupId &&
        Array.isArray(j.records) &&
        j.records.length > 0 &&
        Array.isArray(j.files) &&
        ["pending", "confirmed"].includes(j.outcome),
      "cleanup journal identity mismatch",
    );
    for (const file of j.files)
      requireThat(
        (await evidenceBlob(p.root, file.digest)).length === file.size,
        "cleanup evidence size mismatch",
      );
    if (r.action === "cleanup_status") return j;
    requireThat(
      r.expectedRevision === j.revision &&
        r.key === j.key &&
        r.intent === j.intent &&
        JSON.stringify(r.identities) ===
          JSON.stringify(
            j.records.map((s) => ({
              ticketId: s.ticketId,
              runId: s.runId,
              owner: s.owner,
            })),
          ),
      "cleanup journal CAS or ticket/run/owner/intent mismatch",
    );
    if (r.action === "cleanup_confirm") {
      requireThat(
        r.removed === true && (await absent(j.sourceRoot)),
        "cleanup confirmation requires observed checkout absence",
      );
      text(r.inventoryEvidence, "fresh Herdr inventory and removal evidence");
      if (j.outcome === "confirmed") return j;
      j.outcome = "confirmed";
      j.confirmation = r.inventoryEvidence;
    } else {
      requireThat(
        !j.recovered &&
          j.outcome === "pending" &&
          j.retries === 0 &&
          r.effectAbsent === true,
        "retry requires pending original intent, proven absence and unused retry",
      );
      text(
        r.inventoryEvidence,
        "fresh inventory proving removal effect absent",
      );
      const source = await paths(j.sourceRoot, j.records[0].ticketId);
      await locked(source, async () => {
        const current = await snapshot(source.root);
        requireThat(
          current.fingerprint === j.snapshot.fingerprint,
          "cleanup source changed; stop and reconcile",
        );
        const records = await cleanupRecords(source, r, current);
        requireThat(
          JSON.stringify(records) === JSON.stringify(j.records) &&
            JSON.stringify(await archiveFiles(source.store)) ===
              JSON.stringify(j.files),
          "cleanup state/evidence changed; preserve and reconcile before removal",
        );
      });
      j.retries += 1;
      j.retryEvidence = r.inventoryEvidence;
    }
    j.revision += 1;
    await writeJournal(p, j);
    return j;
  });
}

export async function ticketState(r) {
  if (
    [
      "cleanup_status",
      "cleanup_confirm",
      "cleanup_retry",
      "adopt_cleanup",
    ].includes(r.action)
  )
    return cleanupJournal(r);
  const p = await paths(r.cwd, r.ticketId, r.action === "init");
  if (r.action === "status") return readState(p.file, r.ticketId);
  if (r.action === "snapshot") return snapshot(p.root);
  return locked(p, async () => {
    const current = await snapshot(p.root);
    if (r.action === "init") {
      await noOtherWriter(p, r.ticketId);
      try {
        await lstat(p.file);
        throw new Error(
          "ticket attempt already exists; inspect and reconcile instead",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const s = {
        schemaVersion: 1,
        revision: 0,
        ticketId: r.ticketId,
        identifier: text(r.identifier, "identifier"),
        runId: id(r.runId),
        owner: id(r.owner),
        contract: text(r.contract, "scope baseline", 100000),
        authorization: authority(r.authorization),
        assignment: {
          repository: text(r.repository, "repository"),
          root: p.root,
          branch: current.branch,
          targetBranch: text(r.targetBranch, "target branch"),
          baseCommit: r.baseCommit,
          isolation: r.isolation ?? null,
        },
        status: "active",
        plan: plan(r.plan),
        progress: "Initial repository inspection and working plan recorded",
        nextAction: "Implement the working plan within the authorized boundary",
        blocker: null,
        snapshot: current,
        evidence: {},
        review: null,
        findings: [],
        repairs: [],
        repairCount: 0,
        pr: null,
        externalWrites: [],
      };
      requireThat(SHA.test(r.baseCommit), "invalid base commit");
      git(p.root, "merge-base", "--is-ancestor", r.baseCommit, current.head);
      await persist(p, s);
      return s;
    }
    const s = await readState(p.file, r.ticketId);
    requireThat(
      r.runId === s.runId && r.expectedRevision === s.revision,
      "run identity or revision conflict",
    );
    requireThat(
      s.assignment.root === p.root && s.assignment.branch === current.branch,
      "checkout/branch identity drift",
    );
    git(
      p.root,
      "merge-base",
      "--is-ancestor",
      s.assignment.baseCommit,
      current.head,
    );
    requireThat(
      r.action === "authorize" || r.contract === s.contract,
      "ticket scope drift requires explicit authorization",
    );
    if (r.action === "reconcile" && r.owner !== s.owner) {
      requireThat(
        r.previousOwnerReleased === true,
        "prove previous owner is absent before takeover",
      );
      s.owner = id(r.owner);
    } else
      requireThat(r.owner === s.owner, "checkout belongs to another owner");
    requireThat(
      !TERMINAL.has(s.status) ||
        [
          "authorize",
          "reopen_local",
          "begin_pr",
          "accept_merged",
          "prepare_cleanup",
          "settle",
          "cancel",
        ].includes(r.action) ||
        (["external", "gate"].includes(r.action) &&
          ["settle", "cancel", "cleanup"].includes(r.operation)),
      "handoff is sticky; do not resume completed delivery",
    );
    if (
      r.action !== "accept_merged" &&
      !s.humanAcceptance &&
      (!TERMINAL.has(s.status) ||
        r.operation === "cleanup" ||
        ["reopen_local", "begin_pr"].includes(r.action))
    )
      await noOtherWriter(p, s.ticketId);
    if (s.status === "local_complete" && !s.completionAuthorization) {
      // Preserve legacy completion authority before a terminal authorize can replace it.
      s.completionAuthorization = structuredClone(s.authorization);
    }
    if (r.action === "begin_pr") {
      requireThat(
        r.fingerprint === current.fingerprint &&
          current.fingerprint === s.snapshot.fingerprint &&
          current.clean &&
          s.assignment.branch !== s.assignment.targetBranch,
        "begin_pr requires unchanged completed snapshot and clean separate source branch",
      );
    }
    if (["reopen_local", "begin_pr"].includes(r.action)) {
      requireThat(
        r.fingerprint === current.fingerprint,
        "follow-up revision mismatch",
      );
      // Archive the completed delivery before snapshot invalidation drops its evidence.
      apply(s, r);
      invalidate(s, current);
      s.revision += 1;
      await persist(p, s);
      return s;
    }
    if (r.action === "accept_merged") {
      await acceptMerged(p, s, r, current);
      s.revision += 1;
      await persist(p, s);
      return s;
    }
    if (r.action === "prepare_cleanup") return prepareCleanup(p, r, current);
    if (s.humanAcceptance) {
      requireThat(
        ["authorize", "settle", "gate", "external"].includes(r.action) &&
          (!["gate", "external"].includes(r.action) ||
            ["settle", "cleanup"].includes(r.operation)),
        "human acceptance permits settlement/cleanup only, not renewed delivery",
      );
      requireThat(
        r.contract === s.contract,
        "accepted delivery scope cannot change",
      );
      r = { ...r, currentHead: current.head };
      // Keep verification bound to its original code, even during settlement.
      if (r.operation === "cleanup") await noOtherWriter(p, s.ticketId);
    } else invalidate(s, current);
    if (r.action === "gate") {
      gate(
        r.operation === "cleanup" ? { ...s, snapshot: current } : s,
        r.operation,
        r,
      );
      return s;
    }
    apply(s, r);
    s.revision += 1;
    await persist(p, s);
    return s;
  });
}

async function cli() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    requireThat(Buffer.byteLength(input) <= JOURNAL_LIMIT, "request too large");
  }
  const request = JSON.parse(input);
  if (
    ![
      "prepare_cleanup",
      "cleanup_status",
      "cleanup_confirm",
      "cleanup_retry",
      "adopt_cleanup",
    ].includes(request.action)
  )
    requireThat(Buffer.byteLength(input) <= LIMIT, "request too large");
  const result = await ticketState(request);
  process.stdout.write(`${JSON.stringify({ result })}\n`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  cli().catch((error) => {
    process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  });
}
