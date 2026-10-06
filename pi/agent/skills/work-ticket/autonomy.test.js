import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Written-contract regressions only; decision scenarios require model exercises.
test("outcome authority includes prerequisite fixes without expanding consequential boundaries", async () => {
  const global = await read("../../AGENTS.md");
  const ticket = await read("./SKILL.md");
  assert.match(global, /pre-existing delivery blockers/);
  assert.match(
    global,
    /narrow dependency security patches with necessary lockfile updates/,
  );
  assert.match(global, /exclude unrelated cleanup and broad upgrades/);
  assert.match(
    global,
    /Ask before materially changing product intent, compatibility, security\/trust/,
  );
  assert.match(
    global,
    /24 hours per task, or 72 hours for an explicitly requested multi-ticket stack/,
  );
  assert.match(global, /new defaults do not silently migrate existing work/);
  assert.match(ticket, /no fresh human reply is needed/);
  assert.match(
    ticket,
    /global\/system installation, deployment and live-session changes still need their own authority/,
  );
});

test("scanner triage distinguishes proof from ambiguous secrets and missing coverage", async () => {
  const policy = await read("./references/publication.md");
  assert.match(
    policy,
    /false positive may receive an exact documented disposition without user approval/,
  );
  assert.match(
    policy,
    /digest recomputed from the referenced nonsecret source/,
  );
  assert.match(policy, /Do not broadly suppress a rule\/path/);
  assert.match(policy, /scanner error\/missing coverage as a false positive/);
  assert.match(
    policy,
    /Actual or unresolved findings and missing\/failed safety qualification block/,
  );
});

test("diagnostic CI recovery does not require proven root cause or permit replay", async () => {
  const policy = await read("./references/publication.md");
  assert.match(
    policy,
    /one justified diagnostic rerun of a failed test-only job/,
  );
  assert.match(policy, /confirming the original run settled/);
  assert.match(policy, /root cause is not required before that experiment/);
  assert.match(
    policy,
    /uncertain rerun dispatch must be reconciled, never replayed/,
  );
  assert.match(policy, /new run IDs alone do not create new failure episodes/);
  assert.match(
    policy,
    /deployment\/non-test effects and unrelated changes still require applicable authority/,
  );
  assert.doesNotMatch(
    policy,
    /Infrastructure\/permission\/secret\/unrelated failures block unless separately authorized/,
  );
});

test("delegated soft additions inherit authority rather than inventing human approval", async () => {
  const decisions = await read("../spawn-agent/references/decisions.md");
  const helper = await read("./references/helper.md");
  const recovery = await read("./references/recovery.md");
  assert.match(
    decisions,
    /coordinator may resolve an in-envelope question without a new human reply/,
  );
  assert.match(decisions, /rather than manufacturing human approval/);
  assert.match(
    helper,
    /finite soft allowance addition under the task's existing autonomy authority/,
  );
  assert.match(
    helper,
    /does not enforce the deadline or cumulative wake ceiling|ceilings are not enforced by this helper/,
  );
  assert.match(recovery, /hard ceilings require explicit user extensions/);
  assert.match(
    recovery,
    /Recovery itself supplies neither new authority nor a fresh deadline/,
  );
});
