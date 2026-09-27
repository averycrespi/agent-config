import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistIndex, readIndex } from "./record.js";
import { complete } from "./state.ts";
import { launchWorker, preflightWorker } from "./launcher.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const clone = (x: any) => JSON.parse(JSON.stringify(x));
function model(options: any = {}) {
  const repo = "/home/user/project";
  const checkout = "/home/user/worktrees/project/avery-example";
  const base = "a".repeat(40);
  const session = "00000000-0000-4000-8000-000000000001";
  const transcript = `/sessions/time_${session}.jsonl`;
  const brief: any = {
    kind: "implementation",
    coordinate: true,
    workspaceLabel: "Example",
    extensionPaths: ["/source/coordinate.ts", "/source/mailbox.ts"],
    repo,
    checkout,
    base,
    branch: "avery/example",
    assignmentId: "example",
    revision: 1,
    runId: "run-1",
    agent: "example",
    task: "Read the brief; literal $(touch NEVER) ' ; no shell interpretation",
    coordinator: "parent-session",
    ownerDigest: hash("Owner parent-session"),
    mailbox: "example-inbox",
    checkpoint: "/private/checkpoint.json",
    references: ["/references/decisions.md"],
    bounds: { startMs: 30000, confirmMs: 15000, deadline: 1000000 },
  };
  Object.assign(brief, options.brief);
  const path = "/git/pi-repo-coordination/example.md";
  let values: any = {
    "Owner and authority": "Owner parent-session",
    Assignments: JSON.stringify([
      {
        assignmentId: "example",
        revision: 1,
        runId: "run-1",
        launchId: "launch-1",
        launchBrief: brief,
      },
      { assignmentId: "unrelated", note: "preserve" },
    ]),
    Next: "Coordinator owns acceptance",
  };
  if (options.duplicateAssignment) {
    const rows = JSON.parse(values.Assignments);
    rows.push({ ...rows[0], launchId: "another-launch" });
    values.Assignments = JSON.stringify(rows);
  }
  let clock = 100;
  let created = false;
  let started = false;
  let prompted = false;
  let writes = 0;
  const effects: string[] = [];
  const commands: any[] = [];
  const files = new Map<string, string>([
    ["/references/decisions.md", "reporting contract"],
    ["/source/coordinate.ts", "trusted coordinate"],
    ["/source/mailbox.ts", "trusted mailbox"],
  ]);
  const row = () => JSON.parse(values.Assignments)[0];
  const snapshot = () => ({
    id: "example",
    path,
    values: clone(values),
    digest: hash(JSON.stringify(values)),
  });
  const response = (type: string, data: any = {}) =>
    JSON.stringify({ result: { type, ...data } });
  const pane = () => ({
    pane_id: "w2:p1",
    workspace_id: "w2",
    terminal_id: "term-2",
    cwd: brief.checkout,
  });
  const io: any = {
    env: { HERDR_ENV: "1", PI_SESSION_ID: "parent-session" },
    home: "/home/user",
    now: () => clock,
    readIndex: async () => snapshot(),
    updateIndex: async (r: any) => {
      writes++;
      if (options.expireCoverageAtWrite === writes) clock = 999100;
      if (options.failWrite === writes) throw Error("persistence failure");
      assert.equal(r.expected, snapshot().digest);
      values = { ...values, ...r.changes };
      if (options.afterWrite === writes)
        throw Error("uncertain persisted write");
      return {
        confirmed: !options.badReceipt,
        id: r.id,
        path,
        expected: r.expected,
        attemptId: r.attemptId,
        digest: snapshot().digest,
      };
    },
    exists: async (p: string) =>
      files.has(p) ||
      (p === brief.checkout && (created || options.pathCollision)),
    real: async (p: string) => (options.symlink ? "/elsewhere" : p),
    ignoreAtBase: async () => {
      if (options.unignored) throw Error("not ignored at selected base");
    },
    read: async (p: string) => {
      if (!files.has(p)) throw Error("missing file");
      return files.get(p);
    },
    handoff: async (p: string, body: string) => {
      assert.equal(row().launch.intent.effect, "handoff");
      effects.push("handoff");
      if (options.interrupt === "handoff") throw Error("interrupted");
      assert.ok(!files.has(p));
      files.set(p, body);
    },
    exec: async (file: string, a: string[]) => {
      commands.push([file, a]);
      if (file === "ps") return "Mon Jan 1 00:00:00 2026";
      if (file === "git") {
        const cmd = a[2];
        if (cmd === "rev-parse")
          return a.includes("--show-toplevel")
            ? repo
            : options.wrongBase
              ? "b".repeat(40)
              : base;
        if (cmd === "check-ref-format") return "";
        if (cmd === "branch") return brief.branch;
        if (cmd === "for-each-ref")
          return options.branchCollision
            ? "refs/remotes/origin/avery/example"
            : "";
        if (cmd === "check-ignore") {
          if (options.unignored) throw Error("not ignored");
          return "";
        }
        throw Error(`unexpected git ${cmd}`);
      }
      assert.equal(file, "herdr");
      const [group, action] = a;
      if (options.malformed === `${group}/${action}`) return "{}";
      if (action === "create" || action === "start" || action === "prompt") {
        const effect = action;
        assert.equal(row().launch.intent.effect, effect);
        effects.push(effect);
        if (options.interrupt === effect) throw Error("uncertain effect");
      }
      if (group === "worktree" && action === "list")
        return response("worktree_list", {
          source: { repo_root: repo },
          worktrees: [{ path: repo }],
        });
      if (group === "workspace" && action === "list")
        return response("workspace_list", {
          workspaces: [
            { workspace_id: "w1", focused: !options.focusChanged || !created },
            ...(created
              ? [{ workspace_id: "w2", focused: Boolean(options.focusChanged) }]
              : []),
          ],
        });
      if (group === "agent" && action === "list")
        return response("agent_list", {
          agents: options.agentCollision ? [{ name: "example" }] : [],
        });
      if (action === "create") {
        created = true;
        assert.ok(a.includes("--no-focus"));
        return response("worktree_created", {
          workspace: { workspace_id: "w2" },
        });
      }
      if (group === "pane" && action === "list")
        return response("pane_list", { panes: [pane()] });
      if (group === "agent" && action === "start") {
        started = true;
        assert.deepEqual(a.slice(2), [
          "example",
          "--kind",
          "pi",
          "--pane",
          "w2:p1",
          "--timeout",
          "30000",
          ...(brief.coordinate
            ? [
                "--",
                ...brief.extensionPaths.flatMap((p: string) => [
                  "--extension",
                  p,
                ]),
              ]
            : []),
        ]);
        return response("agent_started");
      }
      if (group === "agent" && action === "get") {
        assert.ok(started);
        return response("agent_info", {
          agent: {
            ...pane(),
            agent: "pi",
            name: "example",
            state_change_seq: prompted ? 2 : 1,
            agent_status: prompted && options.blocked ? "blocked" : "done",
            agent_session: {
              agent: "pi",
              kind: "path",
              value: options.changedIdentity
                ? "/sessions/time_00000000-0000-4000-8000-000000000002.jsonl"
                : transcript,
            },
          },
        });
      }
      if (group === "pane" && action === "process-info")
        return response("pane_process_info", {
          process_info: {
            pane_id: "w2:p1",
            foreground_process_group_id: 42,
            foreground_processes: [
              { pid: 42, name: "pi", cwd: brief.checkout },
            ],
          },
        });
      if (group === "agent" && action === "prompt") {
        prompted = true;
        if (!options.noTranscript)
          files.set(
            transcript,
            [
              { type: "session", id: session, cwd: brief.checkout },
              {
                type: "message",
                id: "submitted",
                message: {
                  role: "user",
                  content: options.wrongTask ? "unrelated prompt" : a[3],
                },
              },
              ...(options.noActivity
                ? []
                : [
                    {
                      type: "message",
                      id: "activity",
                      message: {
                        role: "assistant",
                        content: [
                          {
                            type: "toolCall",
                            name: "read",
                            arguments: { path: row().launch.handoff },
                          },
                        ],
                      },
                    },
                  ]),
            ]
              .map(JSON.stringify as any)
              .join("\n"),
          );
        if (options.uncertainPrompt)
          throw Error("lost response after submission");
        return response("agent_prompted");
      }
      if (group === "agent" && action === "wait") {
        if (options.waitTimeout) throw Error("timeout");
        return response("agent_waited");
      }
      throw Error(`unexpected command ${a.join(" ")}`);
    },
  };
  return {
    io,
    row,
    effects,
    commands,
    files,
    options,
    brief,
    writes: () => writes,
    request: { repo, indexId: "example", launchId: "launch-1" },
    expire: () => {
      clock = 1000001;
    },
    cover: () => {
      io.coverageCheck = async () => {
        if (clock >= 999000) throw Error("supervision expired");
        return { id: "observer-1" };
      };
    },
  };
}

async function setup(_t: unknown, options: any = {}) {
  const m = model(options);
  const call = (phase: "prepare" | "submit" = "prepare") =>
    launchWorker({ ...m.request, phase }, m.io);
  return { m, call };
}

test("private launcher prepares without prompt then submits once with actual coverage", async (t) => {
  const { m, call } = await setup(t);
  assert.equal((await call("prepare")).status, "prepared");
  assert.deepEqual(m.effects, ["create", "handoff", "start"]);
  assert.match(m.files.get(m.row().launch.handoff)!, /field launchBrief.task/);
  assert.doesNotMatch(m.files.get(m.row().launch.handoff)!, /touch NEVER/);
  assert.match(m.row().launchBrief.task, /literal \$\(touch NEVER\)/);
  assert.ok(
    !m.commands.some(([, args]) =>
      args.some((s: string) => s.includes("touch NEVER")),
    ),
  );
  const writes = m.writes();
  assert.equal((await call()).status, "prepared");
  assert.equal(m.writes(), writes);
  m.cover();
  assert.equal((await call("submit")).status, "execution-confirmed");
  assert.deepEqual(m.effects, ["create", "handoff", "start", "prompt"]);
  assert.equal(m.row().reporting, undefined);
  assert.equal(m.row().launch.receipts, undefined);
  assert.equal(m.row().launch.prompt, undefined);
  m.expire();
  assert.equal((await call("submit")).status, "execution-confirmed");
  assert.equal(m.effects.filter((s) => s === "prompt").length, 1);
});

for (const options of [
  { duplicateAssignment: true },
  { pathCollision: true },
  { branchCollision: true },
  { agentCollision: true },
  { symlink: true },
  { wrongBase: true },
  { unignored: true },
  { malformed: "worktree/list" },
  { brief: { task: "" } },
  { brief: { base: "main" } },
  { brief: { checkout: "/tmp/../unsafe" } },
]) {
  test(`reject preflight without effects ${JSON.stringify(options)}`, async (t) => {
    const { m, call } = await setup(t, options);
    // Validation before the host try boundary may reject the provider call itself.
    try {
      assert.notEqual((await call()).status, "prepared");
    } catch (e) {
      assert.ok(e instanceof Error);
    }
    assert.deepEqual(m.effects, []);
    assert.equal(m.writes(), 0);
  });
}
for (const effect of ["create", "handoff", "start", "prompt"]) {
  test(`interruption at ${effect} retains intent and never repeats effects`, async (t) => {
    const options: any = {};
    const { m, call } = await setup(t, options);
    if (effect === "prompt") {
      await call();
      m.cover();
    }
    options.interrupt = effect;
    const phase = effect === "prompt" ? "submit" : "prepare";
    assert.notEqual((await call(phase)).status, "execution-confirmed");
    const effects = [...m.effects];
    const writes = m.writes();
    await call(phase);
    assert.deepEqual(m.effects, effects);
    assert.equal(m.writes(), writes);
    assert.equal(m.row().launch.intent.effect, effect);
  });
}
for (const options of [
  { failWrite: 1 },
  { afterWrite: 1 },
  { badReceipt: true },
  { failWrite: 2 },
  { afterWrite: 2 },
  { malformed: "pane/list" },
  { focusChanged: true },
]) {
  test(`persistence or resource failure halts later effects ${JSON.stringify(options)}`, async (t) => {
    const { m, call } = await setup(t, options);
    assert.notEqual((await call()).status, "prepared");
    if (m.row().launch) {
      const n = m.effects.length;
      await call();
      assert.equal(m.effects.length, n);
    }
    assert.ok(!m.effects.includes("prompt"));
  });
}
test("submit requires coverage and never bypasses a failed inspection", async (t) => {
  const { m, call } = await setup(t);
  await call();
  assert.notEqual((await call("submit")).status, "execution-confirmed");
  assert.ok(!m.effects.includes("prompt"));
});
for (const options of [
  { noTranscript: true },
  { wrongTask: true },
  { noActivity: true },
  { uncertainPrompt: true },
  { blocked: true },
  { blocked: true, noActivity: true },
  { waitTimeout: true },
]) {
  test(`execution evidence is task correlated ${JSON.stringify(options)}`, async (t) => {
    const { m, call } = await setup(t, options);
    await call();
    m.cover();
    const r = await call("submit");
    assert.equal(
      r.status,
      (options.blocked && !options.noActivity) || options.waitTimeout
        ? "execution-confirmed"
        : "submitted-unconfirmed",
    );
    await call("submit");
    assert.equal(m.effects.filter((s) => s === "prompt").length, 1);
  });
}
test("verified blocked worker remains explicitly acceptable without prompt replay", async (t) => {
  const { m, call } = await setup(t, { blocked: true });
  await call();
  m.cover();
  const launched = await call("submit");
  assert.equal(launched.status, "execution-confirmed");
  assert.equal(launched.execution?.status, "blocked");
  assert.equal(launched.execution?.submittedEntry, "submitted");
  assert.equal(launched.execution?.activity, true);
  const cwd = await mkdtemp(join(tmpdir(), "coordinate-blocked-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", cwd]);
  await persistIndex({
    cwd,
    id: "example",
    expected: null,
    attemptId: "fixture",
    values: {
      "Owner and authority": "fixture",
      Assignments: JSON.stringify([m.row()]),
      Next: "inspect evidence",
    },
  });
  const index = await readIndex(cwd, "example");
  assert.equal(JSON.parse(index.values!.Assignments)[0].acceptance, undefined);
  const accepted = await complete(cwd, index, {
    assignmentId: "example",
    revision: 1,
    head: "b".repeat(40),
    resultRevision: "result-1",
    evidence: "/verified-result",
    release: "/explicit-release",
    furtherWrites: false,
  });
  assert.equal(
    JSON.parse(accepted.values!.Assignments)[0].acceptance.head,
    "b".repeat(40),
  );
  await call("submit");
  assert.equal(m.effects.filter((s) => s === "prompt").length, 1);
});

test("coverage expiry during persistence prevents prompt without replay", async (t) => {
  const { m, call } = await setup(t, { expireCoverageAtWrite: 9 });
  await call();
  m.cover();
  assert.equal((await call("submit")).status, "submitted-unconfirmed");
  assert.ok(!m.effects.includes("prompt"));
  await call("submit");
  assert.ok(!m.effects.includes("prompt"));
});
test("changed checkout after prepare never receives task", async (t) => {
  const options: any = {};
  const { m, call } = await setup(t, options);
  await call();
  m.cover();
  options.wrongBase = true;
  assert.notEqual((await call("submit")).status, "execution-confirmed");
  assert.ok(!m.effects.includes("prompt"));
});
test("changed worker after prepare never receives task", async (t) => {
  const options: any = {};
  const { m, call } = await setup(t, options);
  await call();
  m.cover();
  options.changedIdentity = true;
  assert.notEqual((await call("submit")).status, "execution-confirmed");
  assert.ok(!m.effects.includes("prompt"));
});

test("Coordinate adapter preserves exact base, caller names/path, unfocused workspace and canonical handshake", async () => {
  const m = model({
    brief: {
      coordinate: true,
      branch: "feature/custom",
      checkout: "/custom/new-checkout",
      workspaceLabel: "Chosen label",
      extensionPaths: ["/source/coordinate.ts", "/source/mailbox.ts"],
    },
  });
  m.files.set("/source/coordinate.ts", "trusted coordinate");
  m.files.set("/source/mailbox.ts", "trusted mailbox");
  let coverageChecks = 0;
  m.io.coverageCheck = async () => {
    coverageChecks++;
    return { id: "actual-recurring" };
  };
  const prepared = await launchWorker({ ...m.request, phase: "prepare" }, m.io);
  assert.equal(prepared.status, "prepared");
  const create = m.commands.find(
    ([, a]) => a[0] === "worktree" && a[1] === "create",
  )[1];
  assert.deepEqual(
    create.slice(create.indexOf("--base"), create.indexOf("--base") + 2),
    ["--base", "a".repeat(40)],
  );
  assert.ok(
    create.includes("/custom/new-checkout") &&
      create.includes("Chosen label") &&
      create.includes("--no-focus"),
  );
  const start = m.commands.find(
    ([, a]) => a[0] === "agent" && a[1] === "start",
  )[1];
  assert.ok(
    start.includes("/source/coordinate.ts") &&
      start.includes("/source/mailbox.ts"),
  );
  assert.match(m.files.get(prepared.handoff!)!, /Assignment: example\/1/);
  const submitted = await launchWorker({ ...m.request, phase: "submit" }, m.io);
  assert.equal(submitted.status, "execution-confirmed");
  assert.equal(submitted.execution?.submittedEntry, "submitted");
  assert.equal(submitted.execution?.activity, true);
  assert.equal(submitted.execution?.transcript, submitted.worker?.transcript);
  assert.deepEqual(submitted.resources, {
    workspace: "w2",
    pane: "w2:p1",
    terminal: "term-2",
  });
  assert.equal(submitted.wait?.reference, submitted.index);
  assert.equal(coverageChecks, 2);
  assert.equal(m.effects.filter((x) => x === "prompt").length, 1);
  await launchWorker({ ...m.request, phase: "submit" }, m.io);
  assert.equal(m.effects.filter((x) => x === "prompt").length, 1);
});

for (const options of [
  { pathCollision: true },
  { branchCollision: true },
  { unignored: true },
  { brief: { references: ["/missing-source"] } },
]) {
  test(`shared deterministic preflight writes nothing: ${JSON.stringify(options)}`, async () => {
    const m = model(options);
    await assert.rejects(
      preflightWorker({ brief: m.brief, launchId: "launch-1" }, m.io),
    );
    assert.equal(m.writes(), 0);
    assert.deepEqual(m.effects, []);
  });
}
