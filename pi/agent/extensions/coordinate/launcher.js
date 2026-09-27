import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readIndex, updateIndex } from "./record.js";

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

// Private finite launcher. No scheduling, CLI, or recovery replay.
export const host = {
  now: () => Date.now(),
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
  async ignoreAtBase(repo, base, launchId) {
    const git = (...args) => host.exec("git", ["-C", repo, ...args]);
    const common = await git(
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    );
    const entries = await git("ls-tree", base, "--", ".gitignore", ".handoffs");
    // Handoffs must be private/untracked, not inherited task artifacts or symlinks.
    if (entries.split("\n").some((line) => line.endsWith("\t.handoffs")))
      fail("selected base contains tracked .handoffs; choose a safe base");
    const ignore = entries
      .split("\n")
      .find((line) => line.endsWith("\t.gitignore"));
    if (
      ignore &&
      !/^100(?:644|755) blob [a-f0-9]{40}\t.gitignore$/.test(ignore)
    )
      fail("unsafe selected-base .gitignore");
    const root = await mkdtemp(join(tmpdir(), "coordinate-ignore-"));
    try {
      if (ignore)
        await writeFile(
          join(root, ".gitignore"),
          // Ignore patterns are byte-sensitive; the command helper trims text.
          (
            await runFile("git", ["-C", repo, "show", `${base}:.gitignore`], {
              encoding: null,
              timeout: 10000,
              maxBuffer: 2 * 1024 * 1024,
            })
          ).stdout,
          { mode: 0o600 },
        );
      // Ask Git, not a reimplementation of gitignore precedence. The scratch tree
      // has only the selected root rules; shared info/exclude/global rules remain.
      await host.exec("git", [
        "--git-dir",
        common,
        "--work-tree",
        root,
        "-C",
        root,
        "check-ignore",
        "--no-index",
        "-q",
        "--",
        `.handoffs/launch-${launchId}.md`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
  if (!b || b.kind !== "implementation" || b.coordinate !== true)
    fail("Coordinate implementation brief required");
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
  for (const key of ["task", "coordinator"]) text(b[key], key, 16000);
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
    typeof b.branch !== "string" ||
    b.branch.length > 200 ||
    /[\s\u0000-\u001f]/.test(b.branch) ||
    b.branch.startsWith("-")
  )
    fail("new implementation branch required");
}

function handoff(b, indexPath, launchId) {
  return `# Worker handoff\n\n## Task and authority\n\nRead the issued brief in ${indexPath}: assignment ${b.assignmentId}/${b.revision}, field launchBrief.task. That is the task, scope and restrictions; this handoff does not duplicate it. Read only your assignment and never edit the coordinator record.\n\n## Starting point\n\nRepository: ${b.repo}\nCheckout: ${b.checkout}\nExact base: ${b.base}\nBranch: ${b.branch}\nAssignment: ${b.assignmentId}/${b.revision}; run: ${b.runId}; launch: ${launchId}\n\n## Reporting\n\nCoordinator: ${b.coordinator}\nRecord: ${indexPath}\nRead your worker identity here; never edit the parent's record.\nMailbox: ${b.mailbox}\nCheckpoint: ${b.checkpoint}\nUse ordinary mailbox send for questions/results. Include assignment/revision, session identity and evidence references. Preserve execution evidence before reporting; results identify exact revision and release/no further writes. No automatic resend. ACK is not acceptance. Follow repository instructions and the supplied scope; enabling coordination grants no extra authority. No nested persistent workers, automatic cleanup, restart or replay.\n\n## Role guidance\n\n${b.references.join("\n")}\n`;
}

// Read-only deterministic checks shared by admission and immediate pre-effect revalidation.
export async function preflightWorker(
  { brief: b, launchId },
  io = host,
  commands,
) {
  briefCheck(b, io.now());
  id(launchId);
  const repo = b.repo;
  const deadline = Math.min(b.bounds.deadline, io.now() + 100000);
  const exec = (file, args) => {
    const left = deadline - io.now();
    if (left < 1000) fail("preflight deadline exhausted");
    return io.exec(file, args, Math.min(10000, left));
  };
  const git =
    commands?.git ?? ((cwd, ...args) => exec("git", ["-C", cwd, ...args]));
  const herdr =
    commands?.herdr ??
    (async (...args) => {
      const envelope = JSON.parse(await exec("herdr", args));
      if (
        envelope.error ||
        !envelope.result ||
        typeof envelope.result.type !== "string"
      )
        fail("malformed Herdr response");
      return envelope.result;
    });
  if (
    (await io.real(repo)) !== repo ||
    (await git(repo, "rev-parse", "--show-toplevel")) !== repo ||
    (await git(repo, "rev-parse", "--verify", `${b.base}^{commit}`)) !== b.base
  )
    fail("repository/base mismatch");
  for (const path of b.references) await io.read(path);
  if (b.coordinate === true) {
    if (!Array.isArray(b.extensionPaths) || b.extensionPaths.length !== 2)
      fail("Coordinate and Mailbox source required");
    for (const path of b.extensionPaths) {
      absolute(path);
      await io.read(path);
    }
  }
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
    await git(repo, "check-ref-format", "--branch", b.branch);
    if (b.coordinate === true) text(b.workspaceLabel, "workspace label", 100);
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
  }
  await io.ignoreAtBase(repo, b.base, launchId);
  if (await io.exists(join(b.checkout, ".handoffs", `launch-${launchId}.md`)))
    fail("handoff collision");
  return { listed, spaces };
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
    resources: state?.resources ?? null,
    execution: state?.execution ?? null,
    wait: state?.wait
      ? { outcome: state.wait.outcome ?? "observed", reference: current.path }
      : null,
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
    // Retain only the fact needed for the next step, not raw Herdr envelopes.
    if (effect === "create")
      state.resources = { workspace: value.workspace?.workspace_id };
    if (effect === "handoff") state.handoffDigest = value.digest;
    state.lastEffect = effect;
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
      const { listed, spaces } = await preflightWorker(
        { brief: b, launchId },
        io,
        { git, herdr },
      );
      state = {
        briefDigest: fingerprint,
        status: "blocked",
        resources: null,
        worker: null,
        handoff: join(b.checkout, ".handoffs", `launch-${launchId}.md`),
        intent: null,
        next: "Coordinator: reconcile launch",
        focus: spaces.find((w) => w.focused).workspace_id,
        bounds: b.bounds,
      };
      await intent("create");
      const created = await herdr(
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
        "--label",
        b.workspaceLabel,
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
        (b.coordinate === true &&
          (await git(
            b.checkout,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          )) !==
            (await git(
              repo,
              "rev-parse",
              "--path-format=absolute",
              "--git-common-dir",
            ))) ||
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
        ...(b.coordinate === true
          ? ["--", ...b.extensionPaths.flatMap((path) => ["--extension", path])]
          : []),
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
      state.next = "Establish child binding before task submission";
      await save();
    } else {
      if (!state) fail("prepare required before submit");
      const checkCoverage = io.coverageCheck;
      if (typeof checkCoverage !== "function")
        fail("Coordinate coverage integration unavailable");
      await checkCoverage(undefined, b, state.worker, io.now());
      const w = await identity();
      if (
        !stable(w, state.worker) ||
        w.seq !== state.worker.seq ||
        !["idle", "done"].includes(w.status) ||
        w.entries.length !== state.baselineEntries
      )
        fail("worker changed since prepare");
      if (hash(await io.read(state.handoff)) !== state.handoffDigest)
        fail("handoff changed");
      if (
        (await git(b.checkout, "rev-parse", "HEAD")) !== b.base ||
        (b.coordinate === true &&
          (await git(
            b.checkout,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          )) !==
            (await git(
              repo,
              "rev-parse",
              "--path-format=absolute",
              "--git-common-dir",
            ))) ||
        (b.kind === "implementation" &&
          (await git(b.checkout, "branch", "--show-current")) !== b.branch)
      )
        fail("checkout changed since prepare");
      const prompt = `Read ${state.handoff} completely, then execute that managed assignment within its authority and reporting contract.`;
      state.baselineSeq = w.seq;
      await intent("prompt");
      await checkCoverage(undefined, b, state.worker, io.now());
      const prompted = await herdr("agent", "prompt", b.agent, prompt);
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
                .join("")) === prompt,
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
      // A question can block the worker without undoing verified task execution.
      // Keep its observed disposition separately from the launch evidence.
      state.status = activity ? "execution-confirmed" : "submitted-unconfirmed";
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
    // The last confirmed intent and retained evidence remain the reconciliation source.
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
