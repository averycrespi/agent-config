---
name: work-stack
description: Use when the user explicitly requests an ordered series of tickets delivered serially as stacked branches or PRs in one repository, with isolated ticket children and parent coordination.
---

# Work stack

Use the user-enabled [Coordinate extension](../../extensions/coordinate/README.md) directly in this session with the serial policy below. Ask the human to run `/coordinate-enable` if unbound; an agent cannot enable it. Existing runs retain [legacy recovery](../coordinate-repo/RECOVERY.md), without automatic cutover. Do not introduce an intermediate manager. Share the [exact-base launch procedure](../spin-out/references/launch.md), [managed report/question protocol](../spin-out/references/decisions.md), [supervision/accounting](../coordinate-repo/references/supervision.md), [index persistence](../coordinate-repo/references/index.md) and [explicit recovery](../coordinate-repo/references/recovery.md); do not maintain stack-specific copies. One child owns implementation and [work-ticket delivery](../work-ticket/SKILL.md); the parent owns ordering/control facts only.

## Resolve ordered scope

Read [Plane](../plane/SKILL.md), resolve every requested ticket to immutable project/ticket identities and canonical criteria, and retain the exact requested serial order. Reject duplicates, cross-repository selections, cycles, forward dependencies and unavailable prerequisite source. Never silently add/reorder/shape tickets or treat numbering as a dependency graph. Resolve initial target branch and full immutable base SHA; verify required source is reachable. Review-ready is not merged and never authorizes an implicit prerequisite merge.

Record actual authority and local-only or PR-ready boundary per child. Work-ticket permits in-scope local commits unless excluded; publication, merge, restack, retarget, history rewriting, cleanup, installation/Stow and live reload retain their separate gates. Inspect competing writers, portable claims, checkpoints, current Git state and Herdr identities before launch. Keep existing stack records/recovery as evidence; cutover is manual with explicit takeover, not automatic migration/adoption or a concurrent controller.

## Serial launch policy

Use Coordinate `spawn` and shared mailbox-based reporting with exactly one active ticket child. Supply one complete Markdown brief and caller-chosen branch/path/workspace/worker names, plus an existing recurring supervision ID. Pass `base` explicitly as the verified immutable predecessor SHA, never rely on the coordinator checkout's default HEAD. Store stack-specific facts in the [compact stack policy section](references/checkpoint.md), not a second delivery ledger. Include the explicit mailbox, assignment ID/revision, child checkpoint, readable shared contracts, canonical criteria and selected finite child repair/CI policy in each handoff. Standalone spin-outs remain standalone.

Ticket one starts at the verified initial SHA and target. Each successor starts at the **verified predecessor head** and targets its predecessor branch for PR publication. Preserve separate creation SHA, source branch and PR target. Reconcile all prior heads, ancestry and outgoing history before creation; branch labels alone are insufficient. Required source unavailable in the checkout blocks launch.

Review each child's incremental diff against its predecessor/base; run required tests against the cumulative resulting tree. Preserve target-applicable required CI coverage; no checks or checks against main alone do not qualify a successor PR targeting another branch. The child owns review, CI observation, fixes and exact-head evidence; do not commission duplicate delivery or competing parent CI monitors.

## Advance only on evidence

A question, setup milestone, commit, draft PR, mailbox message, Monitor timeout or runtime settlement never permits advancement. A pending question blocks successor launch; use the shared conversational answer/provenance/uncertain-relay protocol with the same owner. No replacement child or prompt replay.

Use `coordinate complete` only after inspecting the exact result revision/evidence and release/no-further-writes disposition. Before the next child, require:

- Exact assigned branch, creation base, final head, ancestry, intended clean tree and incremental history reconciled.
- Required cumulative-tree checks and independent incremental review covering the accepted revision, with failures/exceptions disclosed.
- For local-only delivery, committed output and no unauthorized publication. For PR-ready delivery, confirmed open non-draft PR with exact source/base/head, required exact-head target-applicable CI and work-ticket publication gates satisfied.
- Released child ownership or explicit no-further-writes quiescence, with pending effects and child observers reconciled. Evidence acceptance alone is not ownership release.
- Parent observer reconciled and accepted exact revision/evidence/release references persisted before successor launch. Retain child allowances at their owning checkpoint.
- All earlier stack heads and remote source/base relationships still match. A changed predecessor pauses the stack; never automatically restack, retarget, reset, force-push or substitute a moving tip.

Use the shared finite parent supervision policy across this stack; preserve selected deadlines, consumed attempts and uncertain reservations through successor launches and handover. At exhaustion perform one final reconciliation. If it proves the full current boundary, record acceptance, but do not invent fresh observation authority for the successor; obtain an explicit additive allowance when needed. An answer or completed child does not reset project-wide supervision. Child execution/CI budgets remain independent.

## Finish

Recover with the shared explicit-takeover procedure: read project state, mailbox, pending questions/answers/relay intents, workers and original observer receipts before control. No automatic migration or failover. Report each ticket's status, branch/target/base/exact head, accepted evidence/release references, blockers/exceptions and next actor/action. Preserve predecessor-first merge order without merging; green against a stack base is not independent readiness for main. Later merge/restack/retarget needs authority and fresh qualification. Retain resources; cleanup is separate.

Use the [shared verification and live recipe](../coordinate-repo/references/verification.md) plus [stack-specific scenarios](references/verification.md). Fixtures do not prove live model compliance or actual ticket delivery.
