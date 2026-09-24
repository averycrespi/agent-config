#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { readIndex, updateIndex } from "./index.js";

const hash = (x) => createHash("sha256").update(x).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const text = (x, label, max = 4096) => {
  if (
    typeof x !== "string" ||
    !x.trim() ||
    x.length > max ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/.test(x)
  )
    fail(`invalid ${label}`);
  return x;
};
const id = (x) =>
  /^[a-zA-Z0-9_-]{1,80}$/.test(text(x, "identity", 80)) ||
  fail("invalid identity");
const absolute = (x) => {
  text(x, "path", 1024);
  if (!x.startsWith("/") || resolve(x) !== x || /[\r\n]/.test(x))
    fail("unsafe path");
  return x;
};
const positive = (x, max) => Number.isSafeInteger(x) && x > 0 && x <= max;
const runFile = promisify(execFile);

// This host helper is a finite CLI recipe, not a worker runtime or supervisor.
export const host = {
  now: () => Date.now(),
  home: homedir(),
  env: process.env,
  readIndex,
  updateIndex,
  async exec(file, args, timeout = 10000) {
    return (
      await runFile(file, args, {
        encoding: "utf8",
        timeout,
        maxBuffer: 2 * 1024 * 1024,
      })
    ).stdout.trim();
  },
  async read(path, limit = 2 * 1024 * 1024) {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || s.size > limit)
      fail("unsafe or oversized file");
    return readFile(path, "utf8");
  },
  async exists(path) {
    try {
      await lstat(path);
      return true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      return false;
    }
  },
  async real(path) {
    return realpath(path);
  },
  async handoff(path, content, repo) {
    const dir = dirname(path);
    await mkdir(dir, { mode: 0o700 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    if ((await realpath(dir)) !== dir || !(await lstat(dir)).isDirectory())
      fail("unsafe handoff directory");
    // Require existing ignore coverage: do not modify shared Git excludes concurrently.
    await host.exec("git", ["-C", repo, "check-ignore", "-q", path]);
    const f = await open(path, "wx", 0o600);
    try {
      await f.writeFile(content);
      await f.sync();
    } finally {
      await f.close();
    }
    if ((await host.read(path)) !== content) fail("handoff readback mismatch");
  },
};

function briefCheck(b, now) {
  if (!b || !["implementation", "research"].includes(b.kind))
    fail("invalid brief kind");
  for (const key of ["assignmentId", "runId", "agent"]) id(b[key]);
  if (
    !/^[a-z][a-z0-9_-]{0,31}$/.test(b.agent) ||
    !positive(b.revision, 1000000)
  )
    fail("invalid assignment identity");
  absolute(b.repo);
  absolute(b.checkout);
  absolute(b.checkpoint);
  if (!/^[a-f0-9]{40}$/.test(b.base)) fail("immutable base SHA required");
  for (const key of [
    "task",
    "acceptance",
    "constraints",
    "executionAuthority",
    "publicationAuthority",
    "launchAuthority",
    "coordinator",
    "reportingInstructions",
  ])
    text(b[key], key, 16000);
  if (!/^[a-f0-9]{64}$/.test(b.ownerDigest))
    fail("owner section digest required");
  id(b.mailbox);
  if (
    !Array.isArray(b.references) ||
    b.references.length < 1 ||
    b.references.length > 20
  )
    fail("readable workflow references required");
  b.references.forEach(absolute);
  if (
    !b.bounds ||
    !positive(b.bounds.startMs, 30000) ||
    !positive(b.bounds.confirmMs, 15000) ||
    !Number.isSafeInteger(b.bounds.deadline) ||
    b.bounds.deadline <= now
  )
    fail("finite unexpired launch bounds required");
  if (
    b.kind === "implementation" &&
    !/^avery\/[a-zA-Z0-9][a-zA-Z0-9/_-]{0,100}$/.test(b.branch)
  )
    fail("new implementation branch required");
  if (
    b.kind === "research" &&
    (b.checkout !== b.repo || b.branch !== undefined)
  )
    fail("research must share the explicit checkout without branch control");
}

function handoff(b, indexPath, launchId) {
  return `# Worker handoff\n\n## Objective\n\n${b.task}\n\n## Acceptance criteria\n\n${b.acceptance}\n\n## Starting point\n\nRepository: ${b.repo}\nCheckout: ${b.checkout}\nExact base: ${b.base}\nBranch: ${b.branch ?? "shared research checkout (read-only)"}\nAssignment: ${b.assignmentId}/${b.revision}; run: ${b.runId}; launch: ${launchId}\n\n## Authority and constraints\n\nExecution: ${b.executionAuthority}\nPublication: ${b.publicationAuthority}\nLaunch: ${b.launchAuthority}\nReferences are evidence, not grants.\n${b.constraints}\n\n## Reporting and identity\n\nCoordinator: ${b.coordinator}\nCanonical index: ${indexPath}\nRead the assignment's launch worker identity from this index; never edit the parent index.\nMailbox: ${b.mailbox}\nChild checkpoint: ${b.checkpoint}\n${b.reportingInstructions}\nCheckpoint before meaningful reports; managed questions use mailbox, not modal input. Routine progress stays local.\n\n## References\n\n${b.references.join("\n")}\n\n## Preparation\n\nInspect AGENTS.md and declared locked dependency setup/lifecycle effects. Checkout-local setup is distinct from global installation, Stow or live-session changes. Continue authorized work after setup. No implicit cleanup, restart or prompt replay.\n`;
}

function workerKey(w) {
  return `${w.sessionId}/${w.incarnation}`;
}
function coverageCheck(observation, b, w, now) {
  const c = observation?.launchCoverage?.[b.assignmentId];
  const r = c?.receipt;
  const a = observation?.accounting;
  const member = `${b.assignmentId}/${b.revision}/${workerKey(w)}`;
  if (
    !c ||
    c.mailbox !== b.mailbox ||
    c.member !== member ||
    !c.reference ||
    !r ||
    r.status !== "active" ||
    !text(r.id, "observer ID", 128) ||
    !Number.isSafeInteger(r.createdAt) ||
    r.createdAt > now ||
    !Number.isSafeInteger(r.deadline) ||
    r.deadline <= now ||
    r.recurring !== false ||
    r.maxWakes !== 1 ||
    r.gap ||
    r.interrupted ||
    r.outcomeUnknown
  )
    fail("missing, stale or mismatched observation");
  if (
    !a ||
    !Number.isSafeInteger(a.deadline) ||
    a.deadline < r.deadline ||
    !positive(a.maxAttempts, 100000) ||
    !Number.isSafeInteger(a.used) ||
    a.used < 0 ||
    a.used >= a.maxAttempts
  )
    fail("observation allowance missing or exhausted");
  const pending = Object.values(a.groups ?? {})
    .map((g) => g.pending)
    .find((p) => p?.id === r.id);
  if (
    !pending ||
    !Array.isArray(pending.members) ||
    !pending.reference ||
    !positive(pending.lifetimeMs, 86400000) ||
    !Number.isSafeInteger(pending.preparedAt) ||
    r.createdAt < pending.preparedAt ||
    r.deadline - r.createdAt > pending.lifetimeMs
  )
    fail("observer not attached within original reservation");
  if (
    !Array.isArray(r.coverage) ||
    !r.coverage.some(
      (x) =>
        x.mailbox === b.mailbox &&
        Number.isSafeInteger(x.startedAt) &&
        x.startedAt <= now,
    )
  )
    fail("inbox coverage missing");
  return c;
}

export async function launchWorker(
  { phase, repo, indexId, launchId },
  io = host,
) {
  absolute(repo);
  id(indexId);
  id(launchId);
  if (!["prepare", "submit"].includes(phase)) fail("invalid phase");
  if (io.env.HERDR_ENV !== "1") fail("Herdr required");
  let current = await io.readIndex(repo, indexId);
  if (!current.values) fail("existing coordination index required");
  let rows = JSON.parse(current.values.Assignments);
  if (!Array.isArray(rows))
    fail("Assignments JSON array required; reconcile format explicitly");
  const matches = rows.filter((r) => r.launchId === launchId);
  if (matches.length !== 1) fail("unique preassigned launch required");
  let row = matches[0];
  if (
    rows.filter(
      (r) => r.assignmentId === row.assignmentId && r.revision === row.revision,
    ).length !== 1
  )
    fail("duplicate assignment identity; reconcile ownership before launch");
  const b = row.launchBrief;
  if (
    !b ||
    row.assignmentId !== b.assignmentId ||
    row.revision !== b.revision ||
    row.runId !== b.runId ||
    b.repo !== repo ||
    hash(current.values["Owner and authority"]) !== b.ownerDigest
  )
    fail("assignment/owner conflict");
  const fingerprint = hash(JSON.stringify(b));
  let state = row.launch;
  if (state && state.briefDigest !== fingerprint)
    fail("brief changed; reconcile original launch");
  const result = () => ({
    launchId,
    status: state?.status ?? "blocked",
    index: current.path,
    worker: state?.worker ?? null,
    handoff: state?.handoff ?? null,
    next: state?.next ?? "Coordinator: reconcile preflight",
    effect: state?.intent?.effect ?? null,
  });
  // Inspection is effect-free even after deadline expiry. No resumption of partial effects.
  if (state && (phase === "prepare" || state.status !== "prepared"))
    return result();
  briefCheck(b, io.now());
  if (io.env.PI_SESSION_ID !== b.coordinator)
    fail("sole coordinator session required");
  const phaseDeadline = Math.min(b.bounds.deadline, io.now() + 100000);
  const budget = () => {
    const left = phaseDeadline - io.now();
    if (left < 1000) fail("launch deadline exhausted");
    return left;
  };
  const exec = (file, args, timeout = 10000) =>
    io.exec(file, args, Math.min(timeout, budget()));
  const git = (cwd, ...args) => exec("git", ["-C", cwd, ...args]);
  const herdr = async (...args) => {
    const raw = await exec(
      "herdr",
      args,
      args[1] === "start"
        ? b.bounds.startMs + 2000
        : args[1] === "wait"
          ? b.bounds.confirmMs + 2000
          : 10000,
    );
    const envelope = JSON.parse(raw);
    if (
      envelope.error ||
      !envelope.result ||
      typeof envelope.result.type !== "string"
    )
      fail("malformed Herdr response");
    return envelope.result;
  };
  const save = async () => {
    const attemptId = randomUUID();
    state.persistenceAttempt = attemptId;
    const changed = rows.map((r) =>
      r === row ? { ...row, launch: state } : r,
    );
    const receipt = await io.updateIndex({
      cwd: repo,
      id: indexId,
      expected: current.digest,
      attemptId,
      changes: { Assignments: JSON.stringify(changed) },
    });
    if (
      !receipt.confirmed ||
      receipt.attemptId !== attemptId ||
      receipt.id !== indexId ||
      receipt.path !== current.path ||
      receipt.expected !== current.digest
    )
      fail("unconfirmed persistence");
    const readback = await io.readIndex(repo, indexId);
    if (
      readback.digest !== receipt.digest ||
      readback.values.Assignments !== JSON.stringify(changed)
    )
      fail("persistence readback mismatch");
    current = readback;
    rows = changed;
    row = rows.find((r) => r.launchId === launchId);
  };
  const intent = async (effect) => {
    budget();
    state.status = effect === "prompt" ? "submitted-unconfirmed" : "blocked";
    state.intent = { effect, attemptId: randomUUID(), at: io.now() };
    state.next = `Coordinator: reconcile ${effect} intent and existing resources; never replay`;
    await save();
  };
  const receipt = async (effect, value) => {
    state.receipts.push({ effect, value });
    state.intent = null;
    await save();
  };
  const identity = async () => {
    const a = (await herdr("agent", "get", b.agent)).agent;
    const p = (
      await herdr("pane", "process-info", "--pane", state.resources.pane)
    ).process_info;
    if (
      !a ||
      a.agent !== "pi" ||
      a.name !== b.agent ||
      a.pane_id !== state.resources.pane ||
      a.workspace_id !== state.resources.workspace ||
      a.terminal_id !== state.resources.terminal ||
      a.cwd !== b.checkout ||
      !Number.isSafeInteger(a.state_change_seq) ||
      a.agent_session?.kind !== "path" ||
      a.agent_session.agent !== "pi" ||
      p?.pane_id !== a.pane_id
    )
      fail("worker occupant mismatch");
    const procs = p.foreground_processes;
    if (
      !Array.isArray(procs) ||
      procs.length !== 1 ||
      procs[0].name !== "pi" ||
      procs[0].cwd !== b.checkout ||
      !positive(procs[0].pid, 2147483647) ||
      p.foreground_process_group_id !== procs[0].pid
    )
      fail("worker process mismatch");
    const start = await exec("ps", [
      "-p",
      String(procs[0].pid),
      "-o",
      "lstart=",
    ]);
    text(start, "process start", 100);
    const path = absolute(a.agent_session.value);
    const sessionId =
      /_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/.exec(
        path,
      )?.[1];
    if (!sessionId) fail("unrecognized Pi session reference");
    // Pi buffers new sessions until the first assistant message. Herdr's exact
    // reported session path is available earlier; absence never proves delivery.
    const entries = (await io.exists(path))
      ? (await io.read(path))
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s))
      : [];
    const header = entries[0];
    if (
      header &&
      (header.type !== "session" ||
        header.id !== sessionId ||
        header.cwd !== b.checkout)
    )
      fail("session header mismatch");
    return {
      sessionId,
      incarnation: `${a.pane_id}/${a.terminal_id}/pid${procs[0].pid}/start${start}`,
      pane: a.pane_id,
      workspace: a.workspace_id,
      terminal: a.terminal_id,
      transcript: path,
      seq: a.state_change_seq,
      status: a.agent_status,
      entries,
    };
  };
  const stable = (a, w) =>
    [
      "sessionId",
      "incarnation",
      "pane",
      "workspace",
      "terminal",
      "transcript",
    ].every((k) => a[k] === w[k]);
  try {
    if (phase === "prepare") {
      if (
        (await io.real(repo)) !== repo ||
        (await git(repo, "rev-parse", "--show-toplevel")) !== repo ||
        (await git(repo, "rev-parse", "--verify", `${b.base}^{commit}`)) !==
          b.base
      )
        fail("repository/base mismatch");
      for (const path of b.references) await io.read(path);
      const listed = await herdr("worktree", "list", "--cwd", repo);
      if (
        !listed.source?.repo_root ||
        !Array.isArray(listed.worktrees) ||
        !listed.worktrees.some((w) => w.path === repo)
      )
        fail("malformed worktree inventory");
      const spaces = (await herdr("workspace", "list")).workspaces;
      const agents = (await herdr("agent", "list")).agents;
      if (
        !Array.isArray(spaces) ||
        spaces.filter((w) => w.focused).length !== 1 ||
        !Array.isArray(agents) ||
        agents.some((a) => a.name === b.agent)
      )
        fail("workspace/agent collision or malformed inventory");
      if (b.kind === "implementation") {
        const slug = (s) =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        if (
          b.checkout !==
          join(
            io.home,
            "worktrees",
            slug(basename(listed.source.repo_root)),
            slug(b.branch),
          )
        )
          fail("noncanonical checkout path");
        const refs = await git(
          repo,
          "for-each-ref",
          "--format=%(refname)",
          "refs/heads",
          "refs/remotes",
        );
        if (
          refs
            .split("\n")
            .some(
              (r) =>
                r === `refs/heads/${b.branch}` ||
                (r.startsWith("refs/remotes/") && r.endsWith(`/${b.branch}`)),
            ) ||
          (await io.exists(b.checkout)) ||
          listed.worktrees.some(
            (w) => w.path === b.checkout || w.branch === b.branch,
          )
        )
          fail("branch/path collision");
      } else if ((await git(repo, "rev-parse", "HEAD")) !== b.base)
        fail("research checkout base mismatch");
      // Ignore coverage must already exist at the base. No mutation of shared excludes.
      await git(
        repo,
        "check-ignore",
        "-q",
        join(repo, ".handoffs", `launch-${launchId}.md`),
      );
      if (
        await io.exists(join(b.checkout, ".handoffs", `launch-${launchId}.md`))
      )
        fail("handoff collision");
      state = {
        briefDigest: fingerprint,
        status: "blocked",
        resources: null,
        worker: null,
        handoff: join(b.checkout, ".handoffs", `launch-${launchId}.md`),
        receipts: [],
        intent: null,
        next: "Coordinator: reconcile launch",
        focus: spaces.find((w) => w.focused).workspace_id,
        bounds: b.bounds,
      };
      await intent("create");
      const created =
        b.kind === "implementation"
          ? await herdr(
              "worktree",
              "create",
              "--cwd",
              listed.source.repo_root,
              "--branch",
              b.branch,
              "--base",
              b.base,
              "--path",
              b.checkout,
              "--no-focus",
            )
          : await herdr(
              "workspace",
              "create",
              "--cwd",
              b.checkout,
              "--no-focus",
            );
      await receipt("create", created);
      const workspace = created.workspace;
      const workspaceId = workspace?.workspace_id;
      if (
        typeof workspaceId !== "string" ||
        spaces.some((s) => s.workspace_id === workspaceId)
      )
        fail("invalid created workspace");
      const panes = (await herdr("pane", "list", "--workspace", workspaceId))
        .panes;
      if (
        !Array.isArray(panes) ||
        panes.length !== 1 ||
        panes[0].workspace_id !== workspaceId ||
        panes[0].cwd !== b.checkout ||
        panes[0].agent ||
        typeof panes[0].pane_id !== "string" ||
        typeof panes[0].terminal_id !== "string"
      )
        fail("invalid created shell pane");
      state.resources = {
        workspace: workspaceId,
        pane: panes[0].pane_id,
        terminal: panes[0].terminal_id,
      };
      await save();
      if (
        (await io.real(b.checkout)) !== b.checkout ||
        (await git(b.checkout, "rev-parse", "HEAD")) !== b.base ||
        (b.kind === "implementation" &&
          (await git(b.checkout, "branch", "--show-current")) !== b.branch)
      )
        fail("created checkout mismatch");
      await intent("handoff");
      const content = handoff(b, current.path, launchId);
      await io.handoff(state.handoff, content, b.checkout);
      await receipt("handoff", { path: state.handoff, digest: hash(content) });
      await intent("start");
      const started = await herdr(
        "agent",
        "start",
        b.agent,
        "--kind",
        "pi",
        "--pane",
        state.resources.pane,
        "--timeout",
        String(b.bounds.startMs),
      );
      await receipt("start", started);
      const w = await identity();
      if (
        !["idle", "done"].includes(w.status) ||
        w.entries.some((e) => e.message?.role === "user")
      )
        fail("new worker not unprompted and ready");
      const { entries, ...worker } = w;
      state.worker = worker;
      state.baselineEntries = entries.length;
      const afterSpaces = (await herdr("workspace", "list")).workspaces;
      if (
        !Array.isArray(afterSpaces) ||
        afterSpaces.find((s) => s.focused)?.workspace_id !== state.focus ||
        afterSpaces.find((s) => s.workspace_id === state.resources.workspace)
          ?.focused !== false
      )
        fail("focus changed; do not restore without authority");
      state.status = "prepared";
      state.next =
        "Coordinator: persist reporting and attach shared inbox coverage, then submit";
      await save();
    } else {
      if (!state) fail("prepare required before submit");
      const reporting = row.reporting;
      if (
        !reporting ||
        reporting.mailbox !== b.mailbox ||
        reporting.checkpoint !== b.checkpoint ||
        reporting.coordinator !== b.coordinator ||
        reporting.index !== current.path ||
        reporting.handoff !== state.handoff ||
        reporting.member !==
          `${b.assignmentId}/${b.revision}/${workerKey(state.worker)}`
      )
        fail("persisted reporting mismatch");
      const coverage = coverageCheck(
        JSON.parse(current.values.Observation),
        b,
        state.worker,
        io.now(),
      );
      const w = await identity();
      if (
        !stable(w, state.worker) ||
        w.seq !== state.worker.seq ||
        !["idle", "done"].includes(w.status) ||
        w.entries.length !== state.baselineEntries
      )
        fail("worker changed since prepare");
      if (
        hash(await io.read(state.handoff)) !==
        state.receipts.find((r) => r.effect === "handoff").value.digest
      )
        fail("handoff changed");
      if (
        (await git(b.checkout, "rev-parse", "HEAD")) !== b.base ||
        (b.kind === "implementation" &&
          (await git(b.checkout, "branch", "--show-current")) !== b.branch)
      )
        fail("checkout changed since prepare");
      state.coverage = coverage;
      state.prompt = `Read ${state.handoff} completely, then execute that managed assignment within its authority and reporting contract.`;
      state.baselineSeq = w.seq;
      await intent("prompt");
      coverageCheck(
        JSON.parse(current.values.Observation),
        b,
        state.worker,
        io.now(),
      );
      const prompted = await herdr("agent", "prompt", b.agent, state.prompt);
      await receipt("prompt", prompted);
      // One bounded activity wait; timeout is not evidence of non-delivery.
      try {
        state.wait = await herdr(
          "agent",
          "wait",
          b.agent,
          "--until",
          "blocked",
          "--until",
          "done",
          "--timeout",
          String(b.bounds.confirmMs),
        );
      } catch {
        state.wait = { outcome: "unconfirmed" };
      }
      const after = await identity();
      if (!stable(after, state.worker))
        fail("post-submission worker identity changed");
      const fresh = after.entries.slice(state.baselineEntries);
      const submitted = fresh.findIndex(
        (e) =>
          e.message?.role === "user" &&
          (typeof e.message.content === "string"
            ? e.message.content
            : e.message.content
                ?.filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("")) === state.prompt,
      );
      const activity =
        submitted >= 0 &&
        ((after.status === "working" && after.seq > w.seq) ||
          fresh
            .slice(submitted + 1)
            .some(
              (e) =>
                e.message?.role === "assistant" &&
                !["error", "aborted"].includes(e.message.stopReason) &&
                Array.isArray(e.message.content) &&
                e.message.content.some(
                  (c) =>
                    c.type === "toolCall" ||
                    (c.type === "text" && c.text.trim()),
                ),
            ));
      state.status =
        after.status === "blocked"
          ? "blocked"
          : activity
            ? "execution-confirmed"
            : "submitted-unconfirmed";
      state.execution = {
        submittedEntry: submitted < 0 ? null : fresh[submitted].id,
        activity,
        seq: after.seq,
        status: after.status,
        transcript: after.transcript,
      };
      state.next =
        state.status === "execution-confirmed"
          ? "Coordinator: supervise existing worker; assignment not accepted"
          : "Coordinator: reconcile existing submission; never resend or restart";
      await save();
    }
    return result();
  } catch (error) {
    // Never perform another write after a failed/uncertain persistence operation.
    // The last confirmed intent and raw receipts remain the reconciliation source.
    return {
      ...result(),
      status:
        state?.status === "submitted-unconfirmed"
          ? "submitted-unconfirmed"
          : state
            ? "failed"
            : "blocked",
      reason: String(error.message).slice(0, 200),
      next: "Coordinator: inspect canonical index and actual resources; no automatic replay",
    };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  const [phase, repo, indexId, launchId] = process.argv.slice(2);
  try {
    console.log(
      JSON.stringify(await launchWorker({ phase, repo, indexId, launchId })),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        launchId,
        status: "blocked",
        reason: String(e.message).slice(0, 200),
        next: "Coordinator: reconcile input and existing index",
      }),
    );
  }
}
