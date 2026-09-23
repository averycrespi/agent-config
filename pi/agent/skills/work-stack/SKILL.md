---
name: work-stack
description: Use when the user explicitly requests an ordered series of tickets delivered serially as stacked branches or PRs in one repository, with isolated ticket children and parent coordination.
---

# Work stack

Coordinate an explicit ordered stack, delegating exactly one ticket at a time. Keep existing stack records/recovery; [coordinate-repo](../coordinate-repo/SKILL.md) handles independent/general assignments, not automatic stack adoption, migration or a concurrent controller. A request to use this skill authorizes isolated ticket children and session-bound observation, not parallel implementation. Keep implementation and ticket checkpoints in the owning child; the parent owns only orchestration.

Read the [shared launch procedure](../spin-out/references/launch.md), [work-ticket](../work-ticket/SKILL.md), [Herdr](../herdr/SKILL.md), and [Background](../../extensions/background/README.md). Use Herdr for creation/explicit communication, Background for attention, and work-ticket for delivery, independent [review](../review/SKILL.md), publication, CI and recovery. Do not build a second delivery state machine.

Example: “Work ABC-1 then ABC-2 serially from main as stacked review-ready PRs; publish is authorized, do not merge.” A local-only request never authorizes pushing.

## Resolve the whole stack

1. Read [Plane](../plane/SKILL.md); resolve every requested ticket/range to immutable project/ticket UUIDs and complete canonical criteria. Retain order. Reject missing, duplicate, ambiguous or cross-repository selections; never silently add, reorder or shape tickets.
2. Resolve repository, target branch and full immutable initial base SHA. Default an unspecified base to current branch/HEAD only when consistent with the tickets and checkout. Verify required source is reachable there; never substitute uncommitted source or a moving tip.
3. Reconcile native dependencies and qualification, not numbering/stale prose. Distinguish prerequisites already supplied by the base, earlier tickets, and external results/merges. Stop for cycles, forward dependencies, unavailable source or unresolved meaning. Review-ready is not merged; never merge prerequisites automatically.
4. Resolve actual user authority and boundary for every child: local-only or review-ready PR. In-scope local commits follow work-ticket unless excluded. PR delivery requires publication authority and its bounded review/CI repair/promotion contract. Do not infer merge, deployment, cleanup, history rewriting, global setup, Stow linking or live reload authority.
5. Inspect Git history/status, branches/worktrees, portable claims, ticket/stack checkpoints and live Herdr agents. Reconcile competing writers before launch. Require both sessions to already load Background and permit its `sessions` provider. Missing policy/capacity blocks unattended continuation, not an excuse for polling or installation.

Retain reconciled order/authority in the [stack checkpoint](references/checkpoint.md) as a replace-in-place current-state snapshot. Reference child-owned delivery records and retained history rather than copying their contents; recheck mutable facts before each launch.

## Launch one isolated owner

Follow the shared exact-base creation and ignored handoff procedure. Read [parent-managed decisions](references/decisions.md) before child startup: set `PI_ASK_USER_MODE=parent` for the child process only, using its scoped launch alternative when Herdr has no child-environment option. Leave the human-facing parent and standalone spin-outs unchanged. Record intent before resource creation and confirm each worktree/pane/agent/prompt effect before another consequential action. Never retry an uncertain launch or prompt.

Ticket one uses the initial SHA/target. Each successor uses the verified predecessor head as creation base and predecessor branch as PR target. Reconcile all predecessor heads first; preserve both exact SHA and branch identity. Verify ancestry and complete outgoing history for unrelated commits. Branch labels alone are insufficient.

Make the handoff self-contained in task context, not a copy of shared workflow policy. Carry:

- Immutable ticket/project/repository identity, canonical criteria or an exact readable criteria reference, dependency disposition, stack position and absolute parent checkpoint path.
- Actual user authority/exclusions, requested boundary and child as sole implementation/work-ticket owner; distinguish current instructions from historical ticket prose.
- Initial and predecessor source/base/head, assigned worktree/branch, exact creation SHA and separate PR target; incremental review and cumulative-tree testing scope.
- Ticket/repository-specific required checks and target-applicable CI coverage, setup constraints and any scoped exceptions.
- Selected finite child policy upfront: by default two review/five CI repair batches, two hours cumulative CI monitoring, eight hours from first post-publication check and 12 attention attempts. The child consumes these within existing authority without per-batch parent approval. Existing child limits/usage remain in its checkpoint, never copied into a second ledger.
- Explicit instructions to read the exact available work-ticket skill and this skill's [parent-managed decision contract](references/decisions.md) before work, including its shared protocol reference. Provide resolved readable paths; do not paste their review/publication/recovery procedures or decision protocol. Reference the parent checkpoint for its changing observation state, not copied deadlines/counts.
- Final report contract: concise outcome/blocker, exact branch/base/head and PR identity/state, child checkpoint and revision-bound evidence references, unresolved findings/exceptions, and explicit released/no-further-writes disposition with pending effects/child observers reconciled. Reference child-owned allowance and delivery details rather than repeating counters, check inventories or review narratives.

Verify all referenced task criteria and shared contracts are readable by the child during handoff readback; resolve missing references before prompting. Shared policy references do not replace explicit ticket-specific authority or acceptance criteria.

Read back the handoff before prompting. After startup/readiness, discover with `script describe` and selected `sessions.list()`; correlate returned persistent session UUID to Herdr's child identity, then pin its exact live incarnation. Never select by display name, PID, list position or persistent UUID alone. Inspect typed schemas with `background list`. Register attention **before** spin-out's non-waiting prompt submission. Failed registration leaves the unprompted child retained; do not launch a substitute.

The parent may write the initial handoff before submission, never edit the child's checkout afterward. A setup milestone, commit, draft PR or runtime settlement does not authorize launching the successor.

## Wait for attention, then reconcile

Register one-shot `sessions.lifecycle` on the exact child incarnation with the stable filters `agent_settled`, `ask-user:input_requested`, and `session_shutdown`. Do not dynamically narrow filters while child CI is active. Supply `providers: ["sessions"]`, `max_wakes: 1`, explicit `cycle_timeout_ms` ≤1,500,000 and `lifetime_ms` within the remaining parent allowance. No evaluator is needed. Retain job ID, coverage boundary and incarnation. Keep the observer message path-based: “Reconcile this receipt for child `<identity>` using stack checkpoint `<absolute path>`. Attention is not completion.” Read the referenced current state on wake; do not repeat criteria, progress, budgets or historical results in the message. **End the parent turn while pending**; do not poll with model turns, repeated Herdr reads or get calls.

Default parent observation allowance per child is **8 hours wall-clock from the first registration and 40 cumulative Background handoff attempts** across registrations. Handoff attempts count attempted attention delivery to the parent, not child launches or ticket handoffs. Honor an explicit finite user policy, including narrower limits; retain the selected duration, attempt ceiling, absolute deadline and consumed attempts in the checkpoint across recovery. Each registration remains one-shot with `max_wakes: 1`, cycle `min(25 minutes, remaining time)` and lifetime equal to remaining time, subject to host policy ceilings. Do not renew deadlines or counts on re-registration, reload, skill updates or head changes; extensions to retained allowances require explicit additive user authority. At either cumulative limit, stop observation and reconcile once. If that final reconciliation proves every delivery-boundary requirement below, including settled effects and released/quiescent ownership, accept the child and advance under existing stack authority; the successor has its own finite allowance. Otherwise stop successor launch and report the next actor/action with resources retained. Expiry never proves delivery, permits another registration, terminates the child or extends its authority. Child CI retains its separate work-ticket ledger and owner.

On routine attention, reconcile the exact Background receipt and parent allowance, then inspect the child's checkpoint and current Herdr state/report to distinguish ongoing work, pending child CI, input blockage and a claimed delivery boundary. Correlate job/incarnation/session/ticket and relevant checkpoint revision before acting. Read only enough recent output to resolve ambiguous or stale checkpoint progress; do not copy that output into the parent snapshot. Replace the one current observation entry and changed recovery fields using the [compact template](references/checkpoint.md#compact-template); never append a per-wake narrative. Combine changes known at the same safe boundary without collapsing required before-effect intent and after-effect confirmation.

Reserve full authoritative Git/PR/review/check reconciliation for a claimed delivery boundary, recovery, before successor launch or final handoff, or evidence of inconsistency such as changed identity/head or conflicting ownership. A routine timeout with proven ongoing work needs observation reconciliation, not repeated delivery qualification. Leave child-owned CI observation and qualification to the child; investigate uncertainty rather than assuming progress or completion.

- Settlement means runtime idleness, not completed delivery. A child may be waiting on its own Background CI job. Reconcile semantic progress; leave qualification and repair to that child, never create a competing parent CI observer.
- A decision-required report on `agent_settled` follows [parent reconciliation and continuation](references/decisions.md#parent-reconciliation-and-continuation): correlate the current request and existing child, answer from evidence/delegated authority or ask the user, then continue only that child within retained allowances. Label parent decisions honestly; do not fabricate user approval or replay uncertain continuation.
- Actual input attention grants no authority to answer or approve an open UI. Report the concrete unresolved question and stop successor launch; do not remotely resolve the UI or bypass parent mode. Managed calls emit no input attention.
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

Record accepted revision-bound evidence references and next ticket before launch; do not duplicate the child's check history. Failed boundaries, unresolved allowance exhaustion or uncertain ownership/effects stop the stack with resources retained; do not skip to an apparently independent ticket. A completed child's exhausted parent observation allowance does not veto advancement when final reconciliation proves the full boundary; incomplete child qualification still blocks.

## Resume and hand off

Read stack and referenced ticket [recovery](../work-ticket/references/recovery.md) records. Reconcile worktrees, children, ownership, originating observer receipts, publication intents and live Git/PR facts before continuing. Missing fields/receipts do not prove effects absent. Resolve uncertain creation/start/prompt through actual resources and the existing child's report; never blindly repeat. Preserve all consumed repair/wait allowances.

Shutdown/reload/navigation/replacement breaks Background coverage without automatic reconnect; restoration is receipts only. Absence on another branch proves neither non-delivery nor child absence. Require user reconciliation when identity/liveness is unresolved; never promise detached execution. Historical observer transitions follow [migration notes](../../../docs/migrations.md#observer-retirement), not replay.

Before final handoff, recheck stack relationships and evidence. Report each ticket's status, branch/target/base/exact head, child checkpoint and accepted evidence references, blockers/exceptions and next actor/action; do not reproduce child check inventories, review narratives or repair counters. State predecessor-first merge order without merging. Green against a recorded stack base is not independent readiness for main; later merge/retarget/restack needs authority and fresh qualification. Follow [recoverable final bookkeeping](../work-ticket/references/publication.md#recoverable-final-bookkeeping): persist revision-bound evidence, artifacts at the [persistent artifact root](../work-ticket/references/settlement.md#persistent-artifacts), confirmed authorized portable comments, separate parent/child observer receipts, unresolved effects and next action before releasing parent ownership once. Resume by confirming existing effects rather than repeating comments or starting another writer; retain all resources and adverse evidence. Cleanup requires separate authority and [work-ticket settlement](../work-ticket/references/settlement.md).

Use the [verification guide](references/verification.md); structural tests do not prove model behavior or live delivery.
