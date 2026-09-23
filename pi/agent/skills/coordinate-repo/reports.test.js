import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { MailboxStore } from "../../extensions/mailbox/store.ts";
import {
  incorporate,
  answerQuestion,
  relayIntent,
  wellness,
} from "./scripts/reports.js";
import { replaceIndex, readIndex } from "./scripts/index.js";

test("two pending questions, independent result and persist-before-ack replacement retain every obligation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "reports-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  const store = new MailboxStore(join(root, "mailboxes"));
  const owners = ["a", "b", "c"].map((id) => ({
    assignmentId: id,
    revision: 1,
    runId: `run-${id}`,
    sessionId: `session-${id}`,
    incarnation: `process-${id}`,
  }));
  for (const [i, owner] of owners.entries())
    store.send(
      "project",
      i < 2 ? "question" : "result",
      JSON.stringify({
        ...owner,
        reportId: `report-${i}`,
        requestId: `question-${i}`,
        contextRevision: 1,
        head: "a".repeat(40),
        checkpoint: `/checkpoint-${i}`,
        reference: `/report-${i}`,
      }),
    );
  const initial = { address: "project", reports: {}, questions: {} };
  const incorporated = incorporate(
    initial,
    store.list("project").messages,
    owners,
  );
  assert.equal(Object.keys(initial.reports).length, 0);
  const values = {
    "Owner and authority": "owner-a; /actual-authority",
    Mailbox: JSON.stringify(incorporated.state),
    Assignments:
      "c: evidence-qualified fixture result; no further writes; /release",
    Next: "human answers a/b; c accepted independently",
  };
  await replaceIndex({ cwd: root, id: "project", expected: null, values });
  // Simulate coordinator loss after persisted incorporation, before ack.
  assert.equal(store.list("project").pending, 3);
  const saved = await readIndex(root, "project");
  assert.match(await readFile(saved.path, "utf8"), /question-0/);
  const state = JSON.parse(
    saved.text.split("## Mailbox\n\n")[1].split("\n\n##")[0],
  );
  const repeated = incorporate(
    state,
    new MailboxStore(store.root).list("project").messages,
    owners,
  );
  assert.deepEqual(repeated.state, incorporated.state);
  store.ack("project", repeated.ack);
  assert.equal(store.list("project").pending, 0);
  assert.equal(Object.keys(repeated.state.questions).length, 2);
  assert.equal(repeated.state.questions["question-1"].status, "pending");
  const question = repeated.state.questions["question-0"];
  const answer = {
    ...question,
    answer: "A",
    provenance: "human",
    reference: "/human-entry-42",
    cancelled: false,
  };
  for (const patch of [
    { requestId: "question-1" },
    { contextRevision: 2 },
    { provenance: "worker" },
    { reference: "" },
    { cancelled: true },
  ])
    assert.throws(
      () =>
        answerQuestion(repeated.state, "question-0", { ...answer, ...patch }),
      /stale/,
    );
  const answered = answerQuestion(repeated.state, "question-0", answer);
  const intent = relayIntent(answered, "question-0", "/before-herdr-effect");
  const recovered = JSON.parse(JSON.stringify(intent));
  assert.equal(recovered.questions["question-0"].status, "relay-unknown");
  assert.equal(
    recovered.questions["question-0"].answer.reference,
    "/human-entry-42",
  );
  assert.throws(
    () => relayIntent(recovered, "question-0", "/retry"),
    /reconcile/,
  );
  const resolution = store.send(
    "project",
    "resolution",
    JSON.stringify({
      ...owners[0],
      reportId: "resolution-0",
      requestId: "question-0",
      contextRevision: 1,
      head: "b".repeat(40),
      questionHead: question.head,
      checkpoint: "/checkpoint-a",
      reference: "/application",
      answerReference: "/human-entry-42",
    }),
  );
  for (const patch of [
    { questionHead: "c".repeat(40) },
    { questionHead: undefined },
    { contextRevision: 2 },
    { answerReference: "/other-answer" },
  ]) {
    const stale = {
      ...resolution,
      message: JSON.stringify({ ...JSON.parse(resolution.message), ...patch }),
    };
    assert.throws(() => incorporate(recovered, [stale], owners), /unmatched/);
    assert.equal(recovered.questions["question-0"].status, "relay-unknown");
  }
  const resolved = incorporate(recovered, [resolution], owners);
  assert.equal(resolved.state.questions["question-0"].status, "resolved");
  assert.equal(resolved.state.questions["question-0"].head, question.head);
  assert.equal(
    resolved.state.questions["question-0"].applicationHead,
    "b".repeat(40),
  );
  assert.equal(resolved.state.questions["question-1"].status, "pending");
  assert.throws(
    () =>
      incorporate(
        recovered,
        [
          {
            ...resolution,
            message: resolution.message.replace("process-a", "wrong-process"),
          },
        ],
        owners,
      ),
    /unattributed/,
  );
  assert.equal(recovered.questions["question-0"].status, "relay-unknown");
});

test("wellness distinguishes quiet interval, healthy quiet, exited, stale and unknown workers", () => {
  const base = {
    now: 10000,
    quietSince: 0,
    quietMs: 5000,
    processAlive: true,
    checkpointAt: 9000,
    staleMs: 3000,
  };
  assert.equal(wellness(base), "healthy-quiet");
  assert.equal(wellness({ ...base, quietSince: 9000 }), "quiet-window");
  assert.equal(wellness({ ...base, processAlive: false }), "exited");
  assert.equal(wellness({ ...base, checkpointAt: 6000 }), "stale");
  assert.equal(wellness({ ...base, processAlive: null }), "unknown");
  assert.equal(wellness({ ...base, checkpointAt: null }), "unknown");
});
