import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import coordinate, { REMINDER } from "./index.ts";
import { bind, load, patch, complete } from "./state.ts";
import { coverage, spawn } from "./launch.ts";
import { host } from "./launcher.js";
import { registerScriptProvider } from "../script/api.ts";
import { mailboxSupervision } from "../mailbox/api.ts";

const session = "00000000-0000-4000-8000-000000000001";
async function fixture(t: TestContext) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "coordinate-test-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", cwd]);
  const hooks = new Map<string, any>(),
    commands = new Map<string, any>();
  const entries: unknown[] = [];
  let tool: any;
  const pi: any = {
    events: createEventBus(),
    on: (name: string, fn: any) => hooks.set(name, fn),
    registerCommand: (name: string, value: any) => commands.set(name, value),
    registerTool: (value: any) => {
      tool = value;
    },
    appendEntry: (...args: unknown[]) => entries.push(args),
  };
  const ctx: any = {
    cwd,
    hasUI: false,
    sessionManager: { getSessionId: () => session },
  };
  coordinate(pi);
  const call = (args: any) =>
    tool.execute("test", args, undefined, undefined, ctx);
  const enable = () => commands.get("coordinate-enable").handler("", ctx);
  const context = (messages: any[] = []) =>
    hooks.get("context")({ messages }, ctx);
  return {
    cwd,
    pi,
    ctx,
    hooks,
    commands,
    entries,
    tool,
    call,
    enable,
    context,
  };
}

test("unbound contexts and tool rejection have no persistence or injection, including outside Git", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.context(), undefined);
  await assert.rejects(f.call({ action: "status" }), /coordinate-enable/);
  assert.deepEqual(f.entries, []);
  assert.ok(
    !(await readdir(join(f.cwd, ".git"))).includes("pi-repo-coordination"),
  );
  f.ctx.cwd = tmpdir();
  assert.equal(await f.context(), undefined);
});

test("enable is user-only and idempotent; per-call reminder replaces only itself through compaction/reload", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const { index } = await load(f.cwd, session);
  const original = await readFile(index.path, "utf8");
  await f.enable();
  assert.equal(await readFile(index.path, "utf8"), original);
  const first = await f.context([
    {
      role: "custom",
      customType: "other",
      content: "preserve",
      display: false,
      timestamp: 1,
    },
  ]);
  const second = await f.context(first.messages);
  assert.equal(
    second.messages.filter((m: any) => m.customType === REMINDER).length,
    1,
  );
  assert.equal(second.messages[0].customType, "other");
  assert.match(second.messages[1].content, /ACK\/settlement is not acceptance/);
  assert.equal(
    (await f.context()).messages.length,
    1,
    "post-compaction empty context still gets role",
  );
  coordinate(f.pi);
  assert.equal(
    (await f.context()).messages.length,
    1,
    "reload restores external facts",
  );
  await assert.rejects(f.call({ action: "enable" }), /Unsupported/);
  assert.equal(await readFile(index.path, "utf8"), original);
});

test("status is read-only; external accepted facts survive tree history and fork cannot become owner", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const { index } = await load(f.cwd, session);
  const before = await readFile(index.path, "utf8");
  const status = await f.call({ action: "status" });
  assert.match(status.content[0].text, /outstanding/);
  assert.equal(await readFile(index.path, "utf8"), before);
  assert.deepEqual(await f.hooks.get("session_before_fork")({}, f.ctx), {
    cancel: true,
  });
  f.ctx.sessionManager.getSessionId = () =>
    "00000000-0000-4000-8000-000000000002";
  await assert.rejects(f.call({ action: "status" }), /disabled/);
  assert.equal(await f.context(), undefined);
});

test("bound child reminders persist without coordinator powers or role conversion", async (t) => {
  const f = await fixture(t);
  await bind(f.cwd, {
    version: 1,
    role: "child",
    active: true,
    sessionId: session,
    checkout: f.cwd,
    common: join(f.cwd, ".git"),
    mailbox: "project",
    authority: "scope",
    parentId: "coordinate-00000000-0000-4000-8000-000000000002",
    assignmentId: "task",
    revision: 1,
    brief: "/brief.md",
    checkpoint: "/checkpoint.json",
  });
  const r = await f.context();
  assert.match(r.messages[0].content, /Coordinate child/);
  assert.match(r.messages[0].content, /\/brief.md/);
  assert.match(r.messages[0].content, /no forced reporting turns/i);
  for (const action of ["status", "spawn", "complete"])
    await assert.rejects(f.call({ action }), /children/);
  await assert.rejects(f.enable(), /role conversion/);
});

test("reported result alone does not accept; exact acceptance preserves reports and rejects conflicting revision", async (t) => {
  const f = await fixture(t);
  await f.enable();
  let { index } = await load(f.cwd, session);
  index = await patch(f.cwd, index, {
    Assignments: JSON.stringify([
      {
        assignmentId: "task",
        revision: 1,
        runId: "run",
        launchId: "launch",
        launchBrief: { checkout: "/child" },
        launch: { status: "execution-confirmed" },
        reported: { disposition: "green result", reference: "/report" },
      },
    ]),
  });
  const status = await f.call({ action: "status" });
  assert.match(status.content[0].text, /not accepted/);
  const data = {
    assignmentId: "task",
    revision: 1,
    head: "a".repeat(40),
    resultRevision: "result-1",
    evidence: "/evidence",
    release: "/release",
    furtherWrites: false,
  };
  await assert.rejects(
    complete(f.cwd, index, { ...data, furtherWrites: true }),
    /no-further-writes/,
  );
  await assert.rejects(
    complete(f.cwd, index, { ...data, revision: 2 }),
    /Exact launched/,
  );
  index = await complete(f.cwd, index, data);
  assert.match(index.values!.Assignments, /green result/);
  assert.equal((await complete(f.cwd, index, data)).digest, index.digest);
  await assert.rejects(
    complete(f.cwd, index, { ...data, head: "b".repeat(40) }),
    /differs/,
  );
  assert.match(
    (await f.call({ action: "status" })).content[0].text,
    /result-1/,
  );
});

test("disable refuses pending reports/assignments/control and never kills or removes resources", async (t) => {
  const f = await fixture(t);
  await f.enable();
  let pending = 1;
  f.pi.events.on("mailbox:inspect-v1", (q: any) => q.reply({ pending }));
  const disable = () => f.commands.get("coordinate-disable").handler("", f.ctx);
  await assert.rejects(disable(), /outstanding/);
  pending = 0;
  let { index } = await load(f.cwd, session);
  index = await patch(f.cwd, index, {
    "Unresolved control": "uncertain prompt",
  });
  await assert.rejects(disable(), /outstanding/);
  await patch(f.cwd, index, { "Unresolved control": null });
  await disable();
  assert.equal(await f.context(), undefined);
  await assert.rejects(f.call({ action: "status" }), /disabled/);
  await f.enable();
  assert.ok((await load(f.cwd, session)).binding?.active);
});

test("coverage requires actual recurring default recipe and healthy retained mailbox coverage; no registration", async (t) => {
  const f = await fixture(t);
  const receipt: any = {
    id: "job",
    status: "active",
    recurring: true,
    intervalMs: 30000,
    deadline: Date.now() + 100000,
    wakes: 0,
    maxWakes: 5,
    coverage: [{ mailbox: "project" }],
  };
  assert.throws(() => coverage(f.pi, "project", "job"), /supervision required/);
  let matches = true;
  f.pi.events.on("monitor:inspect-v1", (q: any) => {
    assert.equal(q.source, mailboxSupervision({ mailbox: "project" }).source);
    q.reply({ receipt, sourceMatches: matches });
  });
  assert.equal(coverage(f.pi, "project", "job").id, "job");
  matches = false;
  assert.throws(() => coverage(f.pi, "project", "job"));
  matches = true;
  receipt.gap = true;
  assert.throws(() => coverage(f.pi, "project", "job"));
  receipt.gap = false;
  receipt.status = "invalidated";
  assert.throws(() => coverage(f.pi, "project", "job"));
  assert.deepEqual(f.entries, []);
});

test("spawn resolves caller HEAD once, discloses dirty files, and honors explicit predecessor without real Herdr effects", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const oldEnv = { ...process.env };
  process.env.PI_CODING_AGENT_DIR = f.cwd;
  process.env.HERDR_ENV = "1";
  delete process.env.SCRIPT_ALLOWED_PROVIDERS;
  t.after(() => {
    process.env = oldEnv;
  });
  await writeFile(
    join(f.cwd, "settings.json"),
    JSON.stringify({ "extension:script": { allowedProviders: ["mailbox"] } }),
  );
  const off = registerScriptProvider(f.pi, {
    namespace: "mailbox",
    available: () => true,
    methods: {
      list: {
        description: "Read fixture",
        inputSchema: { type: "array", maxItems: 0 },
        handler: async () => ({ value: null }),
      },
    },
  });
  t.after(off);
  f.pi.events.on("mailbox:inspect-v1", (q: any) => q.reply({ pending: 0 }));
  f.pi.events.on("monitor:inspect-v1", (q: any) =>
    q.reply({
      sourceMatches: true,
      receipt: {
        id: "job",
        status: "active",
        recurring: true,
        intervalMs: 30000,
        deadline: Date.now() + 100000,
        wakes: 0,
        maxWakes: 5,
        coverage: [{ mailbox: `coordinate-${session}` }],
      },
    }),
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", f.cwd, ...args], { encoding: "utf8" }).trim();
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "first",
  );
  const emptyBase = git("rev-parse", "HEAD");
  await writeFile(join(f.cwd, ".gitignore"), " /.handoffs/\n");
  git("add", ".gitignore");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "space-sensitive pattern",
  );
  const first = git("rev-parse", "HEAD");
  await writeFile(join(f.cwd, ".gitignore"), "/.handoffs/\n");
  git("add", ".gitignore");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "second",
  );
  const second = git("rev-parse", "HEAD");
  const original = host.exec;
  const herdr: string[][] = [];
  t.mock.method(
    host,
    "exec",
    async (file: string, args: string[], timeout?: number) => {
      if (file === "herdr") {
        herdr.push(args);
        if (args[1] === "create")
          return JSON.stringify({ error: "fixture uncertain create" });
        const data =
          args[0] === "worktree"
            ? { source: { repo_root: f.cwd }, worktrees: [{ path: f.cwd }] }
            : args[0] === "workspace"
              ? { workspaces: [{ workspace_id: "original", focused: true }] }
              : { agents: [] };
        return JSON.stringify({ result: { type: "fixture_read", ...data } });
      }
      return original(file, args, timeout);
    },
  );
  const attempt = async (changes: Record<string, unknown> = {}) => {
    const { index, binding } = await load(f.cwd, session);
    return spawn(f.pi, f.cwd, index, binding!, {
      assignmentId: "invalid",
      revision: 1,
      branch: "feature/invalid",
      path: "/unused/invalid",
      workspaceLabel: "Chosen",
      workerName: "invalid",
      brief: "Self-contained scoped task",
      checkpoint: "/unused/checkpoint.json",
      supervisionId: "job",
      ...changes,
    });
  };
  const snapshot = (await load(f.cwd, session)).index.text;
  // Caller HEAD ignores handoffs, but the explicit predecessor does not.
  git("check-ignore", "-q", ".handoffs/launch-invalid.md");
  await assert.rejects(attempt({ base: emptyBase }), /check-ignore/);
  assert.equal((await load(f.cwd, session)).index.text, snapshot);
  // The leading space at this base is significant and must survive git show.
  await assert.rejects(attempt({ base: first }), /check-ignore/);
  assert.equal((await load(f.cwd, session)).index.text, snapshot);
  await writeFile(join(f.cwd, ".git/info/exclude"), "/.handoffs/\n");
  await assert.rejects(attempt({ path: f.cwd }), /collision/);
  assert.equal((await load(f.cwd, session)).index.text, snapshot);
  git("branch", "feature/invalid");
  await assert.rejects(attempt(), /collision/);
  assert.equal((await load(f.cwd, session)).index.text, snapshot);
  assert.ok(!herdr.some((args) => args[1] === "create"));
  for (const [assignmentId, base, expected] of [
    ["default", undefined, second],
    ["explicit", first, first],
  ] as const) {
    const { index, binding } = await load(f.cwd, session);
    const result = await spawn(f.pi, f.cwd, index, binding!, {
      assignmentId,
      revision: 1,
      branch: `feature/${assignmentId}`,
      path: `/unused/${assignmentId}`,
      workspaceLabel: "Chosen",
      workerName: assignmentId,
      brief: "Self-contained scoped task",
      checkpoint: `/unused/${assignmentId}.json`,
      supervisionId: "job",
      base,
    });
    assert.equal(result.base, expected);
    assert.equal(result.excludedUncommittedChanges, true);
    assert.equal(result.status, "failed");
  }
  assert.equal(herdr.filter((args) => args[1] === "create").length, 2);
  assert.equal(git("rev-parse", "HEAD"), second);
});

test("selected-base ignore validation uses Git precedence and rejects inherited handoffs", async (t) => {
  const f = await fixture(t);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        f.cwd,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        ...args,
      ],
      { encoding: "utf8" },
    ).trim();
  await writeFile(join(f.cwd, ".git/info/exclude"), "/.handoffs/\n");
  await writeFile(join(f.cwd, ".gitignore"), "!/.handoffs/\n");
  git("add", ".gitignore");
  git("commit", "-qm", "negation");
  await assert.rejects(
    host.ignoreAtBase(f.cwd, git("rev-parse", "HEAD"), "example"),
    /check-ignore/,
  );
  await writeFile(join(f.cwd, ".gitignore"), "/.handoffs/\n");
  git("add", ".gitignore");
  git("commit", "-qm", "ignore");
  await host.ignoreAtBase(f.cwd, git("rev-parse", "HEAD"), "example");
  await mkdir(join(f.cwd, ".handoffs"));
  await writeFile(join(f.cwd, ".handoffs/old.md"), "fixture artifact");
  git("add", "-f", ".handoffs/old.md");
  git("commit", "-qm", "tracked handoff");
  await assert.rejects(
    host.ignoreAtBase(f.cwd, git("rev-parse", "HEAD"), "example"),
    /tracked .handoffs/,
  );
});
