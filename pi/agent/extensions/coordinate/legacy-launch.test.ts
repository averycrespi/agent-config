import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { savedFixture } from "../script/saved-fixture.ts";
import { registerScriptProvider } from "../script/api.ts";
import {
  launchWorker,
  preflightWorker,
} from "../../skills/coordinate-repo/scripts/launch-worker.js";

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
    repo,
    checkout,
    base,
    branch: "avery/example",
    assignmentId: "example",
    revision: 1,
    runId: "run-1",
    agent: "example",
    task: "Read the brief; literal $(touch NEVER) ' ; no shell interpretation",
    acceptance: "Report the observed file count",
    constraints: "Read only. No cleanup or publication.",
    executionAuthority: "user message 1",
    publicationAuthority: "none; no publication",
    launchAuthority: "user message 1",
    coordinator: "parent-session",
    ownerDigest: hash("Owner parent-session"),
    mailbox: "example-inbox",
    checkpoint: "/private/checkpoint.json",
    reportingInstructions:
      "Read shared reporting reference and checkpoint before mailbox result.",
    references: ["/references/decisions.md"],
    bounds: { startMs: 30000, confirmMs: 15000, deadline: 1000000 },
  };
  if (options.research) {
    brief.kind = "research";
    brief.checkout = repo;
    delete brief.branch;
  }
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
    cover: (change: (o: any) => void = () => {}) => {
      const rows = JSON.parse(values.Assignments),
        r = rows[0],
        w = r.launch.worker;
      const member = `example/1/${w.sessionId}/${w.incarnation}`;
      r.reporting = {
        mailbox: brief.mailbox,
        checkpoint: brief.checkpoint,
        coordinator: brief.coordinator,
        index: path,
        handoff: r.launch.handoff,
        member,
      };
      values.Assignments = JSON.stringify(rows);
      const observation: any = {
        accounting: {
          deadline: 999999,
          maxAttempts: 4,
          used: 1,
          groups: {
            mailbox: {
              pending: {
                id: "observer-1",
                members: ["historical-member"],
                reference: "original reservation",
                preparedAt: 50,
                lifetimeMs: 999900,
              },
            },
          },
        },
        launchCoverage: {
          example: {
            member,
            mailbox: brief.mailbox,
            reference: "host receipt call",
            receipt: {
              id: "observer-1",
              status: "active",
              createdAt: 60,
              deadline: 999000,
              recurring: false,
              maxWakes: 1,
              coverage: [{ mailbox: brief.mailbox, startedAt: 60 }],
            },
          },
        },
      };
      change(observation);
      values.Observation = JSON.stringify(observation);
    },
  };
}

async function setup(t: any, options: any = {}) {
  const h = await savedFixture(t);
  await h.config({ allowedProviders: ["builtins"] });
  await copyFile(
    resolve(
      import.meta.dirname,
      "../../skills/coordinate-repo/scripts/legacy-launch-definition.js",
    ),
    join(h.store, "launch-worker.js"),
  );
  const m = model(options);
  const dispose = registerScriptProvider(h.pi, {
    namespace: "builtins",
    available: () => true,
    methods: {
      bash: {
        description: "Controlled shell boundary",
        inputSchema: {
          type: "array",
          items: [{ type: "object" }],
          minItems: 1,
          maxItems: 1,
        },
        handler: async (args) => {
          const command = (args[0] as any).command;
          assert.ok(!command.includes(m.brief.task));
          const phase = command.includes("'prepare'") ? "prepare" : "submit";
          const result = await launchWorker({ ...m.request, phase }, m.io);
          return {
            value: {
              content: [{ type: "text", text: JSON.stringify(result) }],
            },
          };
        },
      },
    },
  });
  t.after(dispose);
  const call = async (phase = "prepare", background = false) => {
    const terminal = background ? h.terminal() : null;
    const r = await h.call({
      action: "run",
      name: "launch-worker",
      providers: ["builtins"],
      args: {
        phase,
        repo: m.request.repo,
        index_id: "example",
        launch_id: "launch-1",
        helper_path: "/trusted/launch-worker.js",
      },
      ...(background ? { execution: "background" } : {}),
    });
    if (terminal) {
      await terminal;
      const record = h.service.inspect("script", r.details.records[0].id);
      assert.equal(record.status, "success");
      return JSON.parse((record.result as any).json);
    }
    assert.equal(r.details.status, "success");
    const framed = r.content.find((x: any) =>
      x.text?.includes('"launchId"'),
    ).text;
    return JSON.parse(
      framed.slice(framed.indexOf("{"), framed.lastIndexOf("}") + 1),
    );
  };
  return { h, m, call };
}

test("actual saved definition prepares without prompt then submits with shared coverage and automatic notifications", async (t) => {
  const { h, m, call } = await setup(t);
  assert.equal((await call("prepare", true)).status, "prepared");
  assert.deepEqual(m.effects, ["create", "handoff", "start"]);
  assert.match(
    m.files.get(m.row().launch.handoff)!,
    /literal \$\(touch NEVER\)/,
  );
  const writes = m.writes();
  assert.equal((await call()).status, "prepared");
  assert.equal(m.writes(), writes);
  m.cover();
  assert.equal((await call("submit", true)).status, "execution-confirmed");
  assert.deepEqual(m.effects, ["create", "handoff", "start", "prompt"]);
  assert.equal(h.messages.length, 2);
  m.expire();
  assert.equal((await call("submit")).status, "execution-confirmed");
  assert.equal(m.effects.filter((s) => s === "prompt").length, 1);
});

test("legacy-only research recovery gets a separate unfocused workspace without branch/worktree creation", async (t) => {
  const { m, call } = await setup(t, { research: true });
  assert.equal((await call()).status, "prepared");
  assert.ok(
    m.commands.some(
      ([f, a]) =>
        f === "herdr" &&
        a[0] === "workspace" &&
        a[1] === "create" &&
        a.includes("--no-focus"),
    ),
  );
  assert.ok(
    !m.commands.some(([, a]) => a[0] === "worktree" && a[1] === "create"),
  );
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
      assert.match(String(e), /failed|success/);
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
for (const defect of [
  "missing",
  "expired",
  "member",
  "allowance",
  "reservation",
  "receipt",
]) {
  test(`submit refuses ${defect} observation`, async (t) => {
    const { m, call } = await setup(t);
    await call();
    if (defect !== "missing")
      m.cover((o) => {
        if (defect === "expired") o.launchCoverage.example.receipt.deadline = 1;
        if (defect === "member") o.launchCoverage.example.member = "different";
        if (defect === "allowance") o.accounting.used = 4;
        if (defect === "reservation")
          o.accounting.groups.mailbox.pending.id = "different";
        if (defect === "receipt")
          o.launchCoverage.example.receipt.status = "finished";
      });
    assert.notEqual((await call("submit")).status, "execution-confirmed");
    assert.ok(!m.effects.includes("prompt"));
  });
}
for (const options of [
  { noTranscript: true },
  { wrongTask: true },
  { noActivity: true },
  { uncertainPrompt: true },
  { blocked: true },
  { waitTimeout: true },
]) {
  test(`execution evidence is task correlated ${JSON.stringify(options)}`, async (t) => {
    const { m, call } = await setup(t, options);
    await call();
    m.cover();
    const r = await call("submit");
    assert.equal(
      r.status,
      options.blocked
        ? "blocked"
        : options.waitTimeout
          ? "execution-confirmed"
          : "submitted-unconfirmed",
    );
    await call("submit");
    assert.equal(m.effects.filter((s) => s === "prompt").length, 1);
  });
}
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
  m.cover();
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
