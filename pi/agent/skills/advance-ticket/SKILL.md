---
name: advance-ticket
description: Use when advancing one prepared Plane ticket run through planning, implementation, verification, draft PR publication, independent review, CI, ready-for-review promotion, and human handoff.
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

Before any remote write, run one fail-closed publication-safety gate:

1. Require a clean working tree and reread the repository instructions.
2. Inspect the complete outgoing commit range from the assigned base through HEAD, including every commit message, patch, and path; the final diff alone is insufficient because removed content remains in history.
3. Draft the PR title and body, then invoke `github.run_secret_scanning` on bounded chunks of the outgoing patches and proposed PR metadata.
4. Review the same outgoing evidence against repository guidance. For public repositories, check especially for private organizations, projects, teams, URLs, credentials, proprietary design material, tracked handoffs, local paths, personal data, and non-generic examples.
5. Stop before push on any finding, unavailable or incomplete scan, oversized evidence, or uncertainty. If a secret is already committed, adding a removal commit is insufficient; block for explicit operator-controlled history repair.

After the gate passes, use broker-backed remote Git and GitHub operations to push only the assigned branch and create or update exactly one draft PR targeting the assigned target branch. Use a public-safe summary of the outcome, acceptance criteria, implementation, checks, and known gaps. Never copy raw Plane URLs or comments, workspace identifiers, local paths, or run state into public PR metadata. Reread and require one open draft PR whose head equals the unchanged local HEAD, whose head branch is the assigned branch, and whose base is the assigned target branch, then progress to `reviewing` with the draft PR URL, published commit, and confirmed draft/head/source/target evidence.

### `reviewing`

Prepare the published base-to-HEAD evidence and invoke the saved `review` workflow once for the current head. Treat its report as authoritative.

- For confirmed blocking findings, progress back to `implementing`; any changed HEAD must pass full verification, publication, and review again.
- For an incomplete review, unresolved framework failure, needs-human finding, or material evidence gap, block with the exact recovery condition.
- Treat only a report with no material findings as passing review, confirm the reviewed head equals the published head, and invoke helper `record_review` to persist that exact-head outcome. After interruption, reuse only the recorded passing review for the unchanged published head; do not rerun it.

After review passes, inspect CI through broker-discovered GitHub operations. Require all required checks to pass for the PR's current head and require that CI head to equal the published head. A pending check remains in `reviewing` with a checkpoint; unavailable or ambiguous CI blocks with an exact recovery condition. For failed CI, inspect the failure and either progress to `implementing` for a bounded repair or block when it is external or not safely repairable. Never hand off with pending, unavailable, ambiguous, or failing CI.

After review and CI pass for the same published head, mark the draft PR ready for review through a broker-discovered GitHub operation. Reread the PR and require that it is open, no longer a draft, still uses the assigned source and target branches, and still has the published head. Then move Plane to Review and reread confirmation. Invoke helper `handoff` with the reviewed head, `ciState: "pass"`, the exact CI head, ready-for-review confirmation and head, and confirmed Plane Review state. A successful handoff records the reviewed head, passing CI state, and `awaiting_human`, then stops Loop. The worker never merges or settles the run itself.

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
