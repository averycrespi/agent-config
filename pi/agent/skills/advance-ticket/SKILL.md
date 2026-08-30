---
name: advance-ticket
description: Use when advancing one prepared Plane ticket run through planning, implementation, verification, draft PR publication, independent review, and human handoff.
---

# Advance Ticket

Advance one prepared `.ticket-run/state.json` through one bounded useful action. Keep engineering judgment in this skill and durable state in `scripts/ticket-run.js`.

## Authority

- Read `../plane/SKILL.md` completely before accessing Plane. Plane is the canonical ticket contract and shared lifecycle authority; the reference skill supplies no mutation authority.
- The helper is the only local state writer. Send one JSON request on stdin and use `expectedRevision` for every mutation; never hand-edit state.
- The current Pi session is the sole writer for repository changes, state, commits, and external mutations. Subagents may perform bounded read-only research or verification.
- Loop is the only continuation scheduler. Do not create another scheduler, recursively invoke this skill, or use Loop yield for ticket execution.
- Do not merge, deploy, set Plane Done or Canceled, reconcile a changed contract, clean up, or perform destructive work. Those require explicit operator use of `dispatch-ticket`.
- During automatic continuation, persist a pause or block instead of asking an interactive question.

## Preflight every turn

1. Read repository instructions and relevant handoff context.
2. Invoke helper `status` and require one valid state plus one derived `nextAction`.
3. Confirm the current repository remote, worktree, branch, base commit ancestry, Herdr workspace, and worker identity match the assignment.
4. Confirm Git status and base-to-HEAD changes are understood before writing.
5. Before publication and handoff, reread Plane through broker-discovered operations, hash the current canonical contract body from the approved title and description fields, and require the stored contract hash and active claim to match. Exclude Plane comments and workflow metadata from the hash.
6. Stop without mutation on missing, malformed, symlinked, stale, ambiguous, drifted, or conflicting identity evidence.

A paused run requires explicit dispatch or resume authority before helper `activate` or `resume`. A blocked run requires its recorded condition to be resolved. `awaiting_human`, complete, and canceled runs perform no delivery work.

## Bounded turn discipline

For an active run, perform one bounded useful action in the current phase. Record a helper `checkpoint`, `progress`, `pause`, `block`, or `handoff` before returning. Reread state after mutation and trust its revision and next action over conversation memory.

Use a short proportional plan. One implementation packet is normal. Do not recreate the milestone-heavy `.design` planning lifecycle inside a ticket run; Git commits and the current checkpoint are the durable implementation history.

## Phase routing

### `planning`

Inspect the ticket, repository instructions, relevant code, and existing tests. Write a concise `planSummary` that maps the acceptance criteria to the smallest implementation and verification approach. If the ticket no longer fits one bounded delivery, pause with a split recommendation. Otherwise progress to `implementing`.

### `implementing`

Implement the next coherent acceptance-criterion slice. Use test-driven development for meaningful logic. Run focused checks, then create one logical commit for file-changing work. Record a checkpoint with the outcome and commit. When all acceptance criteria are implemented, progress to `verifying`.

### `verifying`

Run the ticket-required and repository-required checks, inspect the complete base-to-HEAD diff, map evidence to every acceptance criterion, and assess documentation impact. Fix a newly understood failure within this phase and checkpoint the result. If the same failure repeats without meaningful progress or needs external input, block rather than loop indefinitely. Progress to `publishing` only with no known required failure.

### `publishing`

Use broker-backed remote Git and GitHub operations. Push only the assigned branch. Create or update exactly one draft PR targeting the assigned target branch. Include ticket context, acceptance-criterion evidence, checks, known gaps, and the run ID. Reread the PR and require its head to equal local HEAD, then progress to `reviewing` with the draft PR URL and published commit.

### `reviewing`

Prepare the published base-to-HEAD evidence and invoke the saved `review` workflow once for the current head. Treat its report as authoritative.

- For confirmed blocking findings, progress back to `implementing`; any changed HEAD must pass full verification, publication, and review again.
- For an incomplete review, unresolved framework failure, or uncertain external comment state, block with the exact recovery condition.
- For a passing review, confirm the reviewed head equals the published head. Known failing CI blocks handoff; pending or unavailable CI must be disclosed.

Move Plane to Review and reread confirmation before invoking helper `handoff`. A successful handoff records the reviewed head, review outcome, CI state, and `awaiting_human`, then stops Loop. The worker never settles the run itself.

## Loop composition

On the initial dispatch-authorized worker entry, activate the paused run before starting Loop. Start one bounded loop with a continuation message equivalent to:

```text
Read .ticket-run/state.json through the ticket-run helper, invoke advance-ticket, perform one next safe bounded action, persist progress or a stop, and control Loop from the resulting state.
```

Leave a healthy running Loop alone after durable progress. Persist local state before Loop control:

- active work: allow the running Loop to continue;
- paused, blocked, awaiting_human, complete, or canceled: stop Loop;
- stopped restored Loop: require explicit resume authority;
- yielded or exhausted Loop: stop and report the operator action required;
- Loop start failure after activation: pause the run with reason `loop_start_failed`.

## External writes

For Plane, Git, PR, or review-comment writes, reread the authoritative surface after the call. On ambiguous failure, reread first and retry once only if the effect is proven absent. Never treat submitted output or local state as confirmation of a remote effect.

## Report

Report ticket and run IDs, status, phase, revision, assigned branch, durable action completed, checkpoint or commit, verified external evidence, Loop action, blocker, and explicit authority required next.
