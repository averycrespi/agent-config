---
name: work-stack
description: Use when the user explicitly requests an ordered series of tickets delivered serially as stacked branches or PRs in one repository, with isolated ticket children and parent coordination.
---

# Work Stack

Coordinate an explicit ordered stack; delegate exactly one ticket at a time. Treat a request to use this skill as a request for isolated ticket children and session-bound observation, not parallel implementation. Keep implementation and each ticket checkpoint in its owning child; keep only orchestration in the parent.

Read [spin-out](../spin-out/SKILL.md), [work-ticket](../work-ticket/SKILL.md), [Herdr](../herdr/SKILL.md), and [Session Watch](../../extensions/session-watch/README.md) before launch. Reuse their procedures, not a second delivery state machine. Use Herdr for creation and explicit communication, Session Watch for attention, and work-ticket for delivery, independent [review](../review/SKILL.md), publication, CI, and recovery.

Example requests:

- “Work ABC-1, ABC-3, then ABC-4 serially from main as local stacked branches. Do not push.”
- “Work ABC-1 through ABC-5 serially as stacked PRs from main. Publish is authorized. Stop at green CI; do not merge.”

## Resolve the whole stack

1. Read [Plane](../plane/SKILL.md); resolve every requested identifier/range to immutable project and ticket UUIDs and read complete canonical criteria. Retain the explicit order. Reject missing, duplicate, ambiguous, or cross-repository entries; do not silently fill gaps, reorder, or shape tickets.
2. Resolve repository identity, initial target branch, and full initial base commit. Default an unspecified base to the current branch and exact HEAD only when consistent with the tickets and checkout; ask about conflicting targets. Verify required source changes are reachable in that commit. Never substitute uncommitted source state or a moving tip.
3. Reconcile native dependencies and current evidence, not ticket numbering or stale descriptive status. Identify which prerequisites are already satisfied in the initial tree, which will be supplied by earlier tickets, and which require an external result or merge. Stop for cycles, forward dependencies, unavailable source, or unresolved prerequisite meaning; a review-ready predecessor does not satisfy a dependency that requires merge. Do not add tickets or merge dependencies automatically.
4. Resolve the exact user authority and boundary for every child: **local-only** or **review-ready PR**. Implementation includes work-ticket's in-scope local commits unless excluded; local-only never pushes. PR delivery requires explicit publication authority and inherits work-ticket's bounded review, CI observation/repair, and promotion contract. Ask if the requested boundary and authority conflict. Do not infer merge, deployment, cleanup, history rewrite, global/system installation, configuration linking, or live-session reload authority.
5. Inspect Git status/history, existing branches/worktrees, portable run claims, per-ticket checkpoints, stack checkpoints, and live Herdr agents. Reconcile competing ownership before launch, including other stacks selecting the same ticket. Require Herdr and both sessions' already-loaded Session Watch; unavailable/capacity-limited watching blocks unattended continuation, not an excuse for polling or installation.

Retain the reconciled order and authority in the [small stack checkpoint](references/checkpoint.md). Recheck mutable facts before each launch, not just at initial preflight.

## Launch one isolated owner

Use spin-out's exact-base creation, ignored handoff, and Pi startup procedure. Record launch intent before creating resources and record each confirmed worktree, pane, agent, and prompt effect before another consequential action. Do not retry an uncertain launch or prompt.

For ticket 1, use the recorded initial commit and target branch. For each successor, use the **verified predecessor head commit** as its creation base and the predecessor branch as its PR target. Reconcile all recorded predecessor heads first. Preserve both immutable base SHA and branch identity; verify ancestry and the entire outgoing history for unrelated commits. A branch label alone is insufficient evidence.

In the self-contained spin-out handoff, include:

- Immutable ticket/project/repository identity, canonical criteria reference, dependency disposition, order, and parent stack checkpoint reference.
- Exact user authority and exclusions, requested boundary, and the child's role as sole implementation writer and owning work-ticket session. Preserve normal read-only review delegation; never create another ticket writer.
- Initial base, immediate predecessor branch/head, assigned branch/worktree, and exact creation base SHA. For PRs, name the target branch separately from the source. Review only the incremental base-to-head change, while required tests run on the cumulative tree.
- Required checks and evidence, including confirmation that PR CI triggers and required-check coverage apply to the stack target branch. Missing coverage is a blocker, not green; do not weaken checks or silently change CI scope.
- Spin-out/work-ticket dependency preparation: inspect repository setup and lifecycle effects, install required declared locked checkout-local development dependencies within authority, and continue implementation and verification after setup. Preserve actual user restrictions; do not invent a blanket no-install instruction or stop merely because unfinished implementation now exposes errors.
- Final evidence requirements: ticket checkpoint, exact branch/base/head, local/review/check references, PR identity/state if applicable, unresolved findings, retained allowances, owner release or quiescence, and concrete next actor/action.

Read back the handoff before prompting. After Pi starts and is ready, discover its exact live incarnation via `session_watch list`, correlating the returned session UUID with Herdr's observed child session identity. Never select by display name, PID, list position, or persistent session UUID alone. Register the attention watch **before** submitting the task prompt, then use spin-out's non-waiting Herdr prompt. If registration fails, retain the unprompted child and stop; do not launch a substitute. This separates spin-out startup from submission without changing either operation.

The parent may write the initial handoff before submission, but must not edit the child's checkout afterward. Each child follows work-ticket through the authorized boundary; a setup milestone, commit, draft PR, or settlement is not permission to launch the next ticket.

## Wait for attention, then reconcile

Select only useful events, normally `agent_settled`, `ask-user:input_requested`, `monitor:notification`, and `session_shutdown`. Use a finite timeout within Session Watch's contract (default 30 minutes per watch), retain the returned watch ID/receipt and pinned incarnation, and set the next action to reconcile that watch. **End the parent turn while pending.** Do not use a Loop, repeated Herdr reads/waits, or model-driven `get` calls to poll.

On wake, inspect the exact receipt, child checkpoint, Herdr state/report, and relevant Git/PR/check evidence. Correlate the watch, incarnation, session, ticket, and revision before acting. Notifications grant attention only:

- **Settlement or Monitor event:** reconcile semantic progress. CI may still be pending; Monitor termination is not passing CI. Leave qualification and bounded repair in the owning work-ticket child. Never register a competing parent CI Monitor.
- **User input:** report the question/blocker to the user without answering or submitting approval on their behalf. Do not launch the successor. If information was already explicitly authorized, communicate that evidence through Herdr without inventing an answer to unresolved choices.
- **Deadline, disconnect, or unknown handoff:** inspect the retained state once for recovery; do not relaunch, replay notifications, or assume completion. A deadline with unresolved status stops for user attention rather than renewing forever.

A watch is one-shot and excludes events before its target ACK. Before re-registering after a matched event, reconcile any uncovered interval and current semantic state through the child's checkpoint/report. For a still-working child or known pending CI within its retained allowance, register a fresh watch on the same freshly resolved incarnation, then reconcile once after registration to catch a boundary reached before ACK. Cancel that exact watch if the boundary is already proven; otherwise end the turn. An active matching watch needs no replacement. Never rely on re-registration to replay an event or reset a child's wait/repair allowance. If status cannot be resolved, stop rather than spin on settlement.

## Advance only on evidence

Before launching a successor, reconcile the predecessor's requested boundary using fresh authoritative evidence and the child's retained references, not its “done” label:

- Confirm the assigned branch, recorded creation base, final exact head, ancestry, clean intended tree, and complete incremental history. Resolve unexpected commits or head changes before proceeding.
- For local-only, verify required local checks and applicable independent review cover that exact cumulative tree/incremental change, committed output is available, and no publication occurred under this run.
- For PR-ready, follow [work-ticket publication](../work-ticket/references/publication.md): verify independent pre-publication review, required local evidence, confirmed open non-draft PR source/base/head, and fresh required exact-head CI with coverage for that target. Retain downstream limitations and any explicit scoped exceptions as exceptions, never green. An exception cannot be silently propagated to other tickets.
- Confirm the child has relinquished implementation ownership or is quiescent with an explicit no-further-writes handoff; reconcile its pending external effects and ticket-owned observers. Retain checkpoint references and all consumed allowances. Cancel/reconcile only the parent's corresponding Session Watch before advancing.
- Recheck earlier stack heads and dependencies, including remote heads/base relationships for published branches. If any predecessor differs from its recorded head, pause the stack. Never auto-restack, retarget, reset, force-push, or silently use a newer tip.

Record accepted evidence and the next ticket before launch. If a requested boundary fails, a child exhausts its allowances, or an effect/owner is uncertain, stop the stack and retain all resources. Do not skip ahead to an apparently independent ticket.

## Resume and hand off

Read the stack checkpoint and referenced ticket [recovery records](../work-ticket/references/recovery.md). Reconcile existing worktrees, children, ownership, watchers, publication intents, and live Git/PR evidence before continuing. Missing checkpoint fields or receipts do not prove that an effect was absent. Resolve uncertain creation/start/prompt effects through observed resources and the existing child's report; never blindly repeat them. Keep per-ticket repair and CI histories in their existing records, with no budget resets or duplicate claims.

Session Watch is session/branch-bound: reload, navigation, shutdown, or target replacement breaks coverage without automatic reconnect. Inspect originating receipts and uncertain notification disposition before any new registration; absence in another branch proves neither non-delivery nor child absence. Do not promise detached execution. Require user reconciliation when liveness or identity cannot be established.

Before final handoff, recheck recorded stack relationships and relevant evidence. Report each ticket's status, branch, target/base SHA, exact head, PR and verification references, blockers/accepted exceptions, and next actor/action. Give predecessor-first merge order without merging. Distinguish **green against the recorded stack base** from independent readiness for main: later merge, retarget, or restack requires separate authority and fresh applicable qualification. Persist the same next action, relinquish parent ownership when handing off, and retain worktrees and adverse/incomplete evidence.

For authoring or regression verification, use the [scenario guide](references/verification.md); structural checks do not prove model behavior.
