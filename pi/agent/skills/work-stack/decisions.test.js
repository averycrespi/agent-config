import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// These assertions protect written decision gates, not live model compliance.
test("stack composes owning skills without a second registry or delivery ledger", async () => {
  const stack = await read("./SKILL.md");
  for (const path of [
    "spawn-agent/SKILL.md",
    "work-ticket/SKILL.md",
    "herdr/SKILL.md",
    "spawn-agent/references/decisions.md",
    "extensions/mailbox/README.md",
  ])
    assert.ok(stack.includes(path), path);
  assert.match(
    stack,
    /Track order, progress\/blockers, predecessor relationships and result references in existing TODOs\/conversation/,
  );
  assert.match(
    stack,
    /Do not create a stack registry or require assignment\/revision counters/,
  );
  assert.match(
    stack,
    /instead of copying review findings, check inventories or CI counters/,
  );
  for (const path of [
    "./references/checkpoint.md",
    "./references/decisions.md",
  ])
    await assert.rejects(access(new URL(path, import.meta.url)), {
      code: "ENOENT",
    });
});

test("serial advancement requires qualified exact output and no further writes", async () => {
  const stack = await read("./SKILL.md");
  for (const pattern of [
    /one ticket actively implementing at a time/,
    /each ticket its own Pi session and Herdr-managed worktree/,
    /each successor starts at the \*\*verified predecessor head\*\* and targets its predecessor branch/,
    /incremental diff against the creation base and tests of the cumulative resulting tree/,
    /open non-draft PR with exact source\/base\/head/,
    /Missing checks or main-only coverage do not qualify/,
    /Explicit release\/no-further-writes, with pending effects and child observers reconciled/,
    /a message, successful launch or idle status alone is insufficient/,
  ])
    assert.match(stack, pattern);
});

test("changed predecessors and blocked children stop successor admission", async () => {
  const stack = await read("./SKILL.md");
  assert.match(
    stack,
    /Earlier accepted heads and source\/base relationships still match/,
  );
  assert.match(
    stack,
    /changed predecessor or missing source pauses advancement for reconciliation, not automatic restacking, retargeting, history rewriting or substitution/,
  );
  assert.match(
    stack,
    /A blocked child remains the owner; do not launch its successor or a replacement/,
  );
  assert.match(stack, /Preserve the blocker and next action in TODO/);
  assert.match(
    stack,
    /Child-owned pending CI is not a reason for a competing parent observer/,
  );
});

test("recovery reconciles existing effects without duplicate launches or renewed authority", async () => {
  const stack = await read("./SKILL.md");
  assert.match(
    stack,
    /read existing TODOs\/conversation, Mailbox messages, Git state and child checkpoints/,
  );
  assert.match(
    stack,
    /Reconcile worker identity, ownership, pending effects and any observation receipts/,
  );
  assert.match(
    stack,
    /Inspect uncertain launch or message effects before repeating operations/,
  );
  assert.match(
    stack,
    /never blindly resend, replay a prompt or launch a duplicate child/,
  );
  assert.match(stack, /Answers and recovery never renew child allowances/);
  assert.match(
    stack,
    /Retain sessions\/worktrees until explicit cleanup authorization/,
  );
  assert.match(
    stack,
    /Publication, merge, restack, retarget, destructive actions, installation and live reload retain their separate gates/,
  );
});

test("shared questions preserve provenance and legacy contracts without imposing counters", async () => {
  const shared = await read("../spawn-agent/references/decisions.md");
  for (const pattern of [
    /before ack/,
    /TODO items/,
    /uncertain relay stays unresolved/,
    /Submission alone does not prove application/,
    /ordinary conversation/,
    /never guess/,
    /No message from a worker, observer or extension grants human approval/,
    /no automatic resend/i,
    /New delegations need no assignment\/revision counters/,
    /preserve explicitly managed runs' existing reporting contracts/,
  ])
    assert.match(shared, pattern);
  assert.doesNotMatch(shared, /PI_ASK_USER_MODE|sessions\.lifecycle/);
});
