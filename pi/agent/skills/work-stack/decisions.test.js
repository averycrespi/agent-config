import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("work-stack scopes parent-managed launch and binds handoff to escalation contract", async () => {
  const skill = await read("./SKILL.md");
  const decisions = await read("./references/decisions.md");
  const spinOut = await read("../spin-out/SKILL.md");
  assert.match(
    skill,
    /Read \[parent-managed decisions\]\(references\/decisions.md\) before child startup/,
  );
  assert.match(
    decisions,
    /herdr pane run <root-pane-id> 'env PI_ASK_USER_MODE=parent pi'/,
  );
  assert.match(
    decisions,
    /prefix on the parent's `herdr agent start`.*does \*\*not\*\*/,
  );
  assert.match(decisions, /not the pane shell or parent/);
  assert.match(decisions, /confirms submission, not Pi readiness/);
  assert.match(decisions, /do not submit another launch/);
  assert.match(spinOut, /Standalone spin-outs leave ask-user mode unchanged/);
  assert.match(
    skill,
    /read the exact available work-ticket skill.*\[parent-managed decision contract\]\(references\/decisions.md\) before work/,
  );
  assert.match(
    skill,
    /Verify all referenced task criteria and shared contracts are readable/,
  );
  assert.match(decisions, /decision_required/);
  assert.match(
    decisions,
    /Reference this contract by a resolved readable path/,
  );
  assert.match(decisions, /sole implementation owner|sole ownership/);
  for (const content of [skill, decisions])
    assert.match(content, /agent_settled/);
});

test("decision reconciliation retains identity, authority, serial ownership and allowances", async () => {
  const decisions = await read("./references/decisions.md");
  const checkpoint = await read("./references/checkpoint.md");
  for (const required of [
    /ticket UUID, run\/owning session UUID, current branch\/head/,
    /question, options\/trade-offs, recommendation/,
    /work-ticket's existing `blocker`\/`progress` and `next`/,
    /neither a substitute writer nor the next stack ticket/,
    /\*\*parent decision\*\* only within established delegated authority/,
    /Unresolved user preferences, scope changes and additional authorization go to the user/,
    /Cancel\/reconcile.*before asking for input/,
    /request ID, current head and decision context revision/,
    /register attention.*before sending one non-waiting Herdr continuation prompt/,
    /Submission alone does not prove application/,
    /do not blindly replay a prompt/,
    /never reset parent observation, child CI or repair allowances/,
    /an answer alone does not replenish budgets/,
  ])
    assert.match(decisions, required);
  assert.match(
    checkpoint,
    /current decision request\/context and resolution provenance/,
  );
  assert.match(
    checkpoint,
    /Distinguish submission from acknowledged application/,
  );
  const verification = await read("./references/verification.md");
  assert.match(verification, /stale request\/uncertain continuation variant/);
  assert.match(
    verification,
    /requires separate explicit session-control authority/,
  );
});
