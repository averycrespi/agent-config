import assert from "node:assert/strict";
import test from "node:test";
import {
  updateObservation,
  allowance,
  observationState,
} from "./observation-state.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("durable parent mutations reject wrong ownership without changing bytes and explicit claim preserves usage", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "parent-accounting-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["-C", cwd, "init", "-q"], { stdio: "pipe" });
  const call = (r) => observationState({ cwd, ...identity, ...r });
  const created = await call({
    action: "init",
    authority: "User requests serial stack",
  });
  const before = await readFile(created.file);
  await assert.rejects(call({ action: "prepare", owner: "wrong" }), /mismatch/);
  assert.deepEqual(await readFile(created.file), before);
  await assert.rejects(
    call({ action: "init", authority: "Do not reset" }),
    /exists/,
  );
  assert.deepEqual(await readFile(created.file), before);
  const prepared = await call({ action: "prepare" });
  await call({
    action: "recover",
    inactive: true,
    reference: "Original owner and registration proven inactive",
  });
  await call({
    action: "claim",
    owner: "new-parent",
    previousOwner: identity.owner,
    previousIncarnation: identity.incarnation,
    authority: "User resumes with new parent",
    reference: "Old parent proven absent",
  });
  const resumed = await call({ action: "status" });
  assert.equal(resumed.state.owner, "new-parent");
  assert.equal(
    resumed.allowance.wakesRemaining,
    prepared.allowance.wakesRemaining,
  );
  assert.equal(resumed.allowance.unresolved.length, 1);
});

const identity = {
  stackId: "example-stack",
  childId: "child-a",
  owner: "parent-one",
  incarnation: "incarnation-one",
};
const init = () =>
  updateObservation(
    null,
    {
      ...identity,
      action: "init",
      authority: "User requests ordered local stack",
    },
    0,
  );
const update = (s, r, now = 0) =>
  updateObservation(s, { ...identity, ...r }, now);
const receipt = (s, extra = {}) => ({
  id: "host-job",
  createdAt: 1000,
  deadline: 7201000,
  cycleMs: s.watcher.cycleMs,
  recurring: false,
  maxWakes: 1,
  status: "active",
  wakes: 0,
  inFlight: false,
  outcomeUnknown: false,
  ...extra,
});
test("parent clock starts at first registration, receipts are idempotent and child state is absent", () => {
  let s = update(init(), { action: "prepare" });
  const r = receipt(s);
  s = update(
    s,
    { action: "attach", receipt: r, reference: "Exact child registration" },
    1000,
  );
  assert.equal(s.deadline, 7201000);
  s = update(
    s,
    {
      action: "reconcile",
      receipt: {
        ...r,
        status: "finished",
        wakes: 1,
        lastAttention: { disposition: "handed_to_pi" },
      },
      reference: "Exact host receipt",
    },
    1501000,
  );
  const before = structuredClone(s);
  s = update(
    s,
    {
      action: "reconcile",
      receipt: {
        ...r,
        status: "finished",
        wakes: 1,
        lastAttention: { disposition: "handed_to_pi" },
      },
      reference: "Exact host receipt",
    },
    1501000,
  );
  assert.deepEqual(s, before);
  assert.equal(allowance(s, 1501000).wakesRemaining, 29);
  assert.equal(s.repairs, undefined);
  assert.throws(
    () => update(s, { action: "prepare" }, 7201000),
    /exhausted; child authority is unchanged/,
  );
  const addition = {
    action: "extend",
    id: "extra-hour",
    authority: "User adds one hour",
    reference: "Instruction reference",
    additionalMs: 3600000,
  };
  s = update(s, addition, 7201000);
  s = update(s, addition, 7201000);
  assert.equal(s.deadline, 10801000);
  assert.equal(allowance(s, 7201000).wakesRemaining, 29);
});
test("unknown registration/handoff blocks replacement and recovery preserves charged reservation", () => {
  let s = update(init(), { action: "prepare" });
  assert.throws(() => update(s, { action: "prepare" }), /reconcile/);
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      updateObservation(
        s,
        {
          ...identity,
          owner: "other",
          action: "recover",
          inactive: true,
          reference: "absence",
        },
        10,
      ),
    /mismatch/,
  );
  assert.equal(JSON.stringify(s), before);
  const attemptId = s.watcher.id;
  s = update(
    s,
    {
      action: "recover",
      inactive: true,
      reference: "Original owner proved inactive; receipt unavailable",
    },
    1000,
  );
  assert.equal(s.deadline, 7200000);
  assert.equal(allowance(s, 1000).wakesRemaining, 29);
  assert.throws(
    () => update(s, { action: "prepare" }, 1000),
    /uncertain handoff/,
  );
  s = update(
    s,
    {
      action: "resolve",
      attemptId,
      reference: "Originating history and owner reconciled; no replay",
    },
    1000,
  );
  assert.equal(allowance(s, 1000).wakesRemaining, 29);
});
