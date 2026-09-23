import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  lstat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIndex, replaceIndex, renderIndex } from "./scripts/index.js";
import { allowance, supervision } from "./scripts/supervision.js";
import {
  validateAnswer,
  validateCoordination,
} from "../spin-out/scripts/coordination.js";

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "coordination-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["-C", cwd, "init", "-q"]);
  return cwd;
}
const values = () => ({
  "Owner and authority":
    "repository example; owner session-a; delegated scope/instruction: /retained/agreement#1; exclusions: no publication",
  Assignments:
    "| ID/revision | Brief | Worker/checkpoint | Dependencies | Accepted result | Observed |\n| --- | --- | --- | --- | --- | --- |\n" +
    Array.from(
      { length: 5 },
      (_, i) =>
        `| task-${i}/1 | /brief-${i} | session-${i}/incarnation-${i}; /checkpoint-${i} | none | not accepted | working |`,
    ).join("\n"),
  Next: "coordinator: reconcile shared attention",
});
const receipt = (id, prepared, wakes = 1) => ({
  id,
  createdAt: prepared,
  deadline: 1000000,
  cycleMs: 1000000 - prepared,
  maxWakes: 1,
  recurring: false,
  wakes,
  status: "finished",
  inFlight: false,
  lastAttention: { disposition: "handed_to_pi" },
});

test("fixed-section index: no-change status/replacement writes nothing; conflicts and symlinks reject", async (t) => {
  const cwd = await fixture(t);
  assert.equal((await readIndex(cwd, "example")).text, null);
  await assert.rejects(lstat(join(cwd, ".git", "pi-repo-coordination")), {
    code: "ENOENT",
  });
  const first = await replaceIndex({
    cwd,
    id: "example",
    expected: null,
    values: values(),
  });
  const before = await lstat(first.path);
  for (let i = 0; i < 10; i++) {
    assert.equal((await readIndex(cwd, "example")).digest, first.digest);
    assert.equal(
      (
        await replaceIndex({
          cwd,
          id: "example",
          expected: first.digest,
          values: values(),
        })
      ).written,
      false,
    );
  }
  assert.equal((await lstat(first.path)).mtimeMs, before.mtimeMs);
  assert.equal(before.mode & 0o777, 0o600);
  await assert.rejects(
    replaceIndex({ cwd, id: "example", expected: null, values: values() }),
    /changed/,
  );
  await assert.rejects(
    replaceIndex({
      cwd,
      id: "example",
      expected: first.digest,
      values: { ...values(), Journal: "not allowed" },
    }),
    /sections/,
  );
  assert.equal((await readIndex(cwd, "example")).digest, first.digest);
  await symlink(
    first.path,
    join(cwd, ".git", "pi-repo-coordination", "alias.md"),
  );
  await assert.rejects(readIndex(cwd, "alias"), /unsafe/);
  assert.equal(
    execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
    }),
    "",
  );
});

test("shared supervision reserves per job, accounts once and retains original deadline across replacement", () => {
  let state = allowance(1000000, 4);
  state = supervision(
    state,
    {
      action: "reserve",
      group: "group-a",
      members: ["a/1/s1/i1", "b/1/s2/i2", "c/1/s3/i3", "d/1/s4/i4"],
      reference: "/session#intent1",
    },
    1000,
  );
  state = supervision(
    state,
    {
      action: "reserve",
      group: "group-b",
      members: ["e/1/s5/i5"],
      reference: "/session#intent2",
    },
    1000,
  );
  assert.equal(state.used, 0);
  assert.throws(
    () =>
      supervision(
        state,
        {
          action: "reserve",
          group: "group-a",
          members: ["a"],
          reference: "again",
        },
        1100,
      ),
    /existing/,
  );
  state = supervision(
    state,
    { action: "attach", group: "group-a", receipt: receipt("one", 1000) },
    2000,
  );
  assert.throws(
    () =>
      supervision(
        state,
        { action: "attach", group: "group-b", receipt: receipt("one", 1000) },
        2000,
      ),
    /identity/,
  );
  assert.throws(
    () =>
      supervision(
        state,
        {
          action: "reconcile",
          group: "group-a",
          receipt: { ...receipt("one", 1000), deadline: 999999 },
          reference: "/tampered",
        },
        2000,
      ),
    /inactivity/,
  );
  assert.throws(
    () =>
      supervision(
        { ...state, groups: { bad: { pending: { members: [] } } } },
        { action: "reserve", group: "new" },
        2000,
      ),
    /corrupt/,
  );
  const operation = {
    action: "reconcile",
    group: "group-a",
    receipt: receipt("one", 1000),
    reference: "/session#receipt1",
  };
  state = supervision(state, operation, 2000);
  assert.equal(state.used, 1);
  assert.deepEqual(supervision(state, operation, 3000), state);
  assert.throws(
    () =>
      supervision(
        state,
        { ...operation, receipt: receipt("wrong", 1000) },
        3000,
      ),
    /match/,
  );
  assert.throws(
    () => supervision(state, { ...operation, group: "group-b" }, 3000),
    /inactivity/,
  );
  const recovered = JSON.parse(JSON.stringify(state));
  state = supervision(
    recovered,
    {
      action: "reserve",
      group: "group-a",
      members: ["c/1/s3/i3"],
      reference: "/session#intent3",
    },
    900000,
  );
  assert.equal(state.groups["group-a"].pending.cycleMs, 100000);
  assert.equal(state.deadline, 1000000);
  assert.equal(state.used, 1);
  assert.throws(
    () =>
      supervision(
        state,
        {
          action: "reserve",
          group: "group-c",
          members: ["new"],
          reference: "/intent",
        },
        1000000,
      ),
    /exhausted/,
  );
  assert.throws(
    () =>
      supervision(
        state,
        {
          action: "attach",
          group: "group-a",
          receipt: { ...receipt("new", 900000), maxWakes: 2 },
        },
        900100,
      ),
    /bounds/,
  );
});

test("two durable requests survive third result and handover; stale/ambiguous/cancelled answers reject", async (t) => {
  const cwd = await fixture(t);
  const pending = Array.from({ length: 2 }, (_, i) => ({
    status: "pending",
    assignmentId: `task-${i}`,
    revision: 1,
    runId: `run-${i}`,
    sessionId: `session-${i}`,
    incarnation: `incarnation-${i}`,
    requestId: `request-${i}`,
    contextRevision: 1,
    head: "a".repeat(40),
  }));
  for (let i = 0; i < pending.length; i++)
    await writeFile(join(cwd, `request-${i}.json`), JSON.stringify(pending[i]));
  const section = {
    assignmentId: "task-2",
    revision: 1,
    disposition: "result offered",
    pendingRef: "/evidence@head",
    nextActor: "coordinator",
    furtherWrites: false,
  };
  validateCoordination(section);
  assert.throws(
    () => validateCoordination({ ...section, pendingRef: null }),
    /invalid/,
  );
  const index = values();
  index.Assignments = index.Assignments.replace(
    "not accepted | working",
    "not accepted | decision needed: /request-0",
  ).replace(
    "not accepted | working",
    "not accepted | decision needed: /request-1",
  );
  // Evidence acceptance stays a human/model judgment; the fixture supplies already-qualified evidence.
  index.Assignments = index.Assignments.replace(
    "not accepted | working",
    "head aaaa, /evidence@head, /release | result accepted",
  );
  let saved = await replaceIndex({
    cwd,
    id: "scenario",
    expected: null,
    values: index,
  });
  const before = await Promise.all(
    pending.map((_, i) => readFile(join(cwd, `request-${i}.json`), "utf8")),
  );
  index["Owner and authority"] +=
    "; transfer to session-b: /actual-user-instruction#2, /former-release#3";
  saved = await replaceIndex({
    cwd,
    id: "scenario",
    expected: saved.digest,
    values: index,
  });
  assert.equal(saved.written, true);
  assert.deepEqual(
    await Promise.all(
      pending.map((_, i) => readFile(join(cwd, `request-${i}.json`), "utf8")),
    ),
    before,
  );
  const answer = {
    ...pending[0],
    cancelled: false,
    answer: "A",
    provenance: "human",
    reference: "/session#human-2",
  };
  assert.equal(validateAnswer(pending[0], answer), answer);
  for (const patch of [
    { requestId: "request-1" },
    { revision: 2 },
    { incarnation: "replacement" },
    { cancelled: true },
    { reference: "" },
    { provenance: "observer" },
  ])
    assert.throws(
      () => validateAnswer(pending[0], { ...answer, ...patch }),
      /stale/,
    );
  assert.throws(
    () => validateAnswer({ ...pending[0], status: "cancelled" }, answer),
    /unanswered/,
  );
});

test("matched bookkeeping measurements: fixed assignments, replacement wakes, control boundaries and referenced history", async (t) => {
  const cwd = await fixture(t);
  const index = values();
  let state = allowance(1000000, 40),
    writes = 0,
    expected = null;
  const save = async () => {
    const result = await replaceIndex({
      cwd,
      id: "measured",
      expected,
      values: index,
    });
    expected = result.digest;
    writes += Number(result.written);
  };
  await save();
  const sizes = [];
  for (let i = 0; i < 10; i++) {
    state = supervision(
      state,
      {
        action: "reserve",
        group: "shared",
        members: ["a/1/s/i", "b/1/t/j", "c/1/u/k", "d/1/v/l"],
        reference: `/session#intent-${i}`,
      },
      1000,
    );
    index.Observation = JSON.stringify(state);
    await save(); // before registration
    const r = receipt(`job-${i}`, 1000);
    state = supervision(
      state,
      { action: "attach", group: "shared", receipt: r },
      2000,
    );
    index.Observation = JSON.stringify(state);
    await save(); // confirmed registration
    state = supervision(
      state,
      {
        action: "reconcile",
        group: "shared",
        receipt: r,
        reference: `/session#receipt-${i}`,
      },
      2000,
    );
    index.Observation = JSON.stringify(state);
    await save(); // mandatory accounting
    sizes.push(Buffer.byteLength(renderIndex("measured", index)));
  }
  assert.equal(writes, 31);
  assert.equal(
    new Set(sizes).size,
    2,
    "only the numeric attempt width changes, no wake journal",
  );
  const before = writes;
  await readIndex(cwd, "measured"); // no-change status: one read, zero writes
  await save(); // defensive no-op also preserves bytes
  assert.equal(writes, before);
  index["Unresolved control"] =
    "continue task-a/request-a: answer /human#1; application unconfirmed";
  await save();
  delete index["Unresolved control"];
  index.Next =
    "task-a: same owner acknowledged /child#resolution; other requests pending";
  await save();
  assert.equal(writes, before + 2, "intent and confirmation stay separate");
  const childPaths = Array.from({ length: 5 }, (_, i) =>
    join(cwd, `child-${i}.json`),
  );
  for (let i = 0; i < 5; i++)
    await writeFile(
      childPaths[i],
      JSON.stringify({
        assignmentId: `task-${i}`,
        revision: 1,
        disposition:
          i < 2 ? "decision needed" : i === 2 ? "result offered" : "working",
        pendingRef: i < 2 ? `/request-${i}` : i === 2 ? "/evidence@head" : null,
        nextActor: i < 2 ? "human" : "coordinator",
        furtherWrites: i > 2,
      }),
    );
  const completedHistory = join(cwd, "completed-history.md");
  await writeFile(completedHistory, "old completed evidence\n".repeat(1000));
  index.Assignments += `\n| old/1 | /old-brief | old-owner; ${completedHistory} | none | old-head, /old-release | accepted |`;
  await save();
  let recoveryReads = 0;
  const recoveryIndex = await readIndex(cwd, "measured");
  recoveryReads++;
  assert.match(recoveryIndex.text, /old\/1/);
  const recoveredChildren = [];
  for (const path of childPaths) {
    recoveredChildren.push(JSON.parse(await readFile(path, "utf8")));
    recoveryReads++;
  }
  assert.equal(recoveryReads, 6);
  assert.equal(
    recoveredChildren.filter((c) => c.disposition === "decision needed").length,
    2,
  );
  t.diagnostic(
    JSON.stringify({
      recoveryFileReads: recoveryReads,
      recoveryLibraryCalls: 6,
      completedHistoryBytesNotLoaded: (await lstat(completedHistory)).size,
      recoveryCoordinatorWrites: 0,
      liveToolCalls: "not measured: fixture is not a model run",
    }),
  );
  assert.doesNotMatch(
    renderIndex("measured", index),
    /test inventory|CI budget|routine child progress/,
  );
  t.diagnostic(
    JSON.stringify({
      assignments: 5,
      wakes: 10,
      snapshotBytes: [sizes[0], sizes.at(-1)],
      initialWrites: 1,
      mandatoryObservationWrites: 30,
      statusReads: 1,
      statusWrites: 0,
      ordinaryProgressWrites: 0,
      controlWrites: 2,
      copiedChildInventories: 0,
      modelAuthoredArithmetic: 0,
      recoveryReads:
        "measured separately below; pending controls add required reads",
    }),
  );
});
