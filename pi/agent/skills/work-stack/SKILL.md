---
name: work-stack
description: Use when the user explicitly requests an ordered series of tickets delivered serially as stacked branches or PRs in one repository, with isolated ticket children and parent coordination.
---

# Work stack

Coordinate an explicit ordered stack, delegating exactly one ticket at a time. A request to use this skill authorizes isolated ticket children and session-bound observation, not parallel implementation. Keep implementation and ticket checkpoints in the owning child; the parent owns only orchestration.

Read [spin-out](../spin-out/SKILL.md), [work-ticket](../work-ticket/SKILL.md), [Herdr](../herdr/SKILL.md), and [Background](../../extensions/background/README.md). Use Herdr for creation/explicit communication, Background for attention, and work-ticket for delivery, independent [review](../review/SKILL.md), publication, CI and recovery. Do not build a second delivery state machine.

Example: “Work ABC-1 then ABC-2 serially from main as stacked review-ready PRs; publish is authorized, do not merge.” A local-only request never authorizes pushing.

## Resolve the whole stack

1. Read [Plane](../plane/SKILL.md); resolve every requested ticket/range to immutable project/ticket UUIDs and complete canonical criteria. Retain order. Reject missing, duplicate, ambiguous or cross-repository selections; never silently add, reorder or shape tickets.
2. Resolve repository, target branch and full immutable initial base SHA. Default an unspecified base to current branch/HEAD only when consistent with the tickets and checkout. Verify required source is reachable there; never substitute uncommitted source or a moving tip.
3. Reconcile native dependencies and qualification, not numbering/stale prose. Distinguish prerequisites already supplied by the base, earlier tickets, and external results/merges. Stop for cycles, forward dependencies, unavailable source or unresolved meaning. Review-ready is not merged; never merge prerequisites automatically.
4. Resolve actual user authority and boundary for every child: local-only or review-ready PR. In-scope local commits follow work-ticket unless excluded. PR delivery requires publication authority and its bounded review/CI repair/promotion contract. Do not infer merge, deployment, cleanup, history rewriting, global setup, Stow linking or live reload authority.
5. Inspect Git history/status, branches/worktrees, portable claims, ticket/stack checkpoints and live Herdr agents. Reconcile competing writers before launch. Require both sessions to already load Background and permit its `sessions` provider. Missing policy/capacity blocks unattended continuation, not an excuse for polling or installation.

Retain reconciled order/authority in the [stack checkpoint](references/checkpoint.md); recheck mutable facts before each launch.

## Launch one isolated owner

Follow spin-out's exact-base creation, ignored handoff and Pi startup procedure. Record intent before resource creation and confirm each worktree/pane/agent/prompt effect before another consequential action. Never retry an uncertain launch or prompt.

Ticket one uses the initial SHA/target. Each successor uses the verified predecessor head as creation base and predecessor branch as PR target. Reconcile all predecessor heads first; preserve both exact SHA and branch identity. Verify ancestry and complete outgoing history for unrelated commits. Branch labels alone are insufficient.

The self-contained handoff must carry:

- Immutable ticket/project/repository identity, criteria, dependency disposition, stack order and parent checkpoint reference.
- Current user authority/exclusions separately from historical ticket prose; requested boundary and child as sole implementation writer/owning work-ticket session. Normal read-only review delegation remains allowed, not another ticket writer.
- Initial and immediate predecessor source/base/head, assigned worktree/branch, exact creation SHA, separate PR target. Review incremental base-to-head changes while testing the cumulative tree.
- Required checks and target-applicable CI coverage. Missing stack-base coverage blocks; never weaken checks or silently change the target.
- Authorized locked checkout-local dependency preparation after inspecting setup/lifecycle effects, preserving lockfiles and actual user restrictions. Missing dependencies, setup completion or unfinished implementation errors are not handoff boundaries.
- Final exact branch/base/head, clean committed output, local/review/check references, PR identity/state, unresolved findings, retained allowances, pending-effect/observer reconciliation and explicit owner release or no-further-writes quiescence.

Read back the handoff before prompting. After startup/readiness, discover with `script describe` and selected `sessions.list()`; correlate returned persistent session UUID to Herdr's child identity, then pin its exact live incarnation. Never select by display name, PID, list position or persistent UUID alone. Inspect typed schemas with `background list`. Register attention **before** spin-out's non-waiting prompt submission. Failed registration leaves the unprompted child retained; do not launch a substitute.

The parent may write the initial handoff before submission, never edit the child's checkout afterward. A setup milestone, commit, draft PR or runtime settlement does not authorize launching the successor.

## Wait for attention, then reconcile

Register one-shot `sessions.lifecycle` on the exact child incarnation with the stable filters `agent_settled`, `ask-user:input_requested`, and `session_shutdown`. Do not dynamically narrow filters while child CI is active. Supply `providers: ["sessions"]`, `max_wakes: 1`, explicit `cycle_timeout_ms` ≤1,500,000 and `lifetime_ms` within the remaining parent allowance. No evaluator is needed. Retain job ID, coverage boundary and incarnation. **End the parent turn while pending**; do not poll with model turns, repeated Herdr reads or get calls.

Default parent observation allowance per child is 30 minutes wall-clock from the first registration and 10 handoff attempts across registrations; retain its absolute deadline and consumed attempts in the checkpoint across recovery. Each registration uses cycle `min(25 minutes, remaining time)` and lifetime equal to remaining time. Do not renew deadlines or counts on re-registration, reload or head changes. User additions must be explicit and additive. Child CI retains its separate work-ticket ledger and owner.

On attention, inspect exact Background receipt, child checkpoint, Herdr report/state and authoritative Git/PR/check evidence. Correlate job/incarnation/session/ticket/revision before acting:

- Settlement means runtime idleness, not completed delivery. A child may be waiting on its own Background CI job. Reconcile semantic progress; leave qualification and repair to that child, never create a competing parent CI observer.
- Input attention grants no authority to answer or approve. Report the concrete unresolved question and stop successor launch. Communicate already-authorized evidence through Herdr only without inventing user choices.
- Condition is attention only. Cycle timeout proves neither child success nor failure; make one reconciliation and renew only for proven ongoing authorized work within remaining parent/child allowances.
- Evaluation/coverage failure, disconnect, cancellation, invalidation, exhausted budget, interrupted accounting or unknown handoff requires reconciliation and a concrete next actor. Do not reconnect/replay, relaunch, infer completion or reset allowance. Unknown notification delivery cannot be transferred to a new job.

One-shot coverage excludes events before the target ACK. Before replacement, reconcile the uncovered interval and current semantic state from child checkpoint/report. For a proven working child or known pending CI within retained allowances, resolve the same live incarnation freshly, register with unchanged filters, then reconcile once after registration to catch a boundary reached before ACK. If boundary/input blockage is already proven, cancel that exact job; otherwise end the turn. An active matching job needs no replacement. Unresolved state stops rather than spinning on settlement. Account handoff attempts from receipts; unknown consumption is not zero usage.

## Advance only on evidence

Before a successor:

- Verify assigned branch, creation base, final exact head, ancestry, clean intended tree and all incremental history. Resolve unexpected commits/head changes.
- For local-only, verify required checks and review cover the cumulative tree/incremental change, committed output exists and no publication occurred.
- For PR-ready, follow [publication](../work-ticket/references/publication.md): confirmed open non-draft PR/source/base/head, independent review, local evidence and fresh required exact-head CI applicable to its target. Retain limitations/scoped exceptions as exceptions, not green or automatically inherited authority.
- Require released child ownership or explicit no-further-writes quiescence; reconcile pending effects and child-owned jobs. Persist evidence/artifact references and allowances before releasing ownership. Cancel/reconcile only the parent's corresponding attention job before advancing.
- Recheck earlier stack heads/dependencies and published remote source/base relationships. A changed predecessor pauses the stack; never auto-restack, retarget, reset, force-push or silently use a newer tip.

Record accepted evidence and next ticket before launch. Failed boundaries, exhausted allowances or uncertain ownership/effects stop the stack with resources retained; do not skip to an apparently independent ticket.

## Resume and hand off

Read stack and referenced ticket [recovery](../work-ticket/references/recovery.md) records. Reconcile worktrees, children, ownership, originating observer receipts, publication intents and live Git/PR facts before continuing. Missing fields/receipts do not prove effects absent. Resolve uncertain creation/start/prompt through actual resources and the existing child's report; never blindly repeat. Preserve all consumed repair/wait allowances.

Shutdown/reload/navigation/replacement breaks Background coverage without automatic reconnect; restoration is receipts only. Absence on another branch proves neither non-delivery nor child absence. Require user reconciliation when identity/liveness is unresolved; never promise detached execution. Historical observer transitions follow [migration notes](../../../docs/migrations.md#observer-retirement), not replay.

Before final handoff, recheck stack relationships and evidence. Report each ticket's status, branch/target/base/exact head, PR/check/review references, blockers/exceptions and next actor/action. State predecessor-first merge order without merging. Green against a recorded stack base is not independent readiness for main; later merge/retarget/restack needs authority and fresh qualification. Persist final evidence and unresolved effects before releasing parent ownership once; retain all resources and adverse evidence. Cleanup requires separate authority and [work-ticket settlement](../work-ticket/references/settlement.md).

Use the [verification guide](references/verification.md); structural tests do not prove model behavior or live delivery.
