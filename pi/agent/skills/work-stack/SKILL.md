---
name: work-stack
description: Use when the user explicitly requests an ordered series of tickets delivered serially as stacked branches or PRs in one repository, with isolated ticket children and parent coordination.
---

# Work stack

Deliver an explicitly ordered stack with one ticket actively implementing at a time. Give each ticket its own Pi session and Herdr-managed worktree. Keep the parent responsible for order and acceptance, not a second delivery ledger or an intermediate manager.

## Resolve the stack

Read [Plane](../plane/SKILL.md) to resolve the requested ticket identities, canonical criteria and dependencies in one repository. Preserve the requested order; reconcile duplicates, cycles, forward dependencies or unavailable prerequisites before launch rather than silently adding or reordering tickets. Record the initial target branch and full immutable base SHA, plus each ticket's authorized local-only or PR-ready boundary. Ticket approval alone does not authorize execution or publication.

Track order, progress/blockers, predecessor relationships and result references in existing TODOs/conversation. Link the child session and its work-ticket checkpoint instead of copying review findings, check inventories or CI counters. Do not create a stack registry or require assignment/revision counters. Preserve existing runs' reporting contracts and historical evidence without automatic cutover.

## Launch and deliver serially

Use [spawn-agent](../spawn-agent/SKILL.md) for launch and handoff, [Herdr](../herdr/SKILL.md) for worktree operations, and [Mailbox](../../extensions/mailbox/README.md) for communication. Follow those procedures rather than adding a stack-specific launch mode. Use [shared reporting guidance](../spawn-agent/references/decisions.md) for questions and uncertain messages; task/session identity and exact result evidence suffice for new stacks.

Launch only the next ticket. Pass the verified immutable base explicitly: ticket one starts at the initial SHA; each successor starts at the **verified predecessor head** and targets its predecessor branch for PR publication. Keep creation SHA, source branch and PR target distinct in the brief. Verify source availability, ancestry and outgoing history before creation; branch labels alone are insufficient.

Delegate delivery to [work-ticket](../work-ticket/SKILL.md), including its authority gates, checks, independent review, publication, finite repair limits and CI observation. Require review of the incremental diff against the creation base and tests of the cumulative resulting tree. The child owns implementation, review, repairs and CI evidence; do not duplicate its observer or execution ledger.

## Verify before advancing

Inspect the original result evidence before accepting the exact revision in TODO/conversation. Require all of the following before launching a successor:

- Correct branch, creation base, committed final head, ancestry, incremental history and intended clean tree.
- Required cumulative-tree checks and independent incremental review covering that revision, with any explicitly authorized exceptions disclosed.
- The authorized delivery boundary: local-only output without unauthorized publication, or an open non-draft PR with exact source/base/head and required exact-head, target-applicable CI. Missing checks or main-only coverage do not qualify a stacked PR.
- Explicit release/no-further-writes, with pending effects and child observers reconciled. Acceptance is not ownership release; a message, successful launch or idle status alone is insufficient.
- Earlier accepted heads and source/base relationships still match. A changed predecessor or missing source pauses advancement for reconciliation, not automatic restacking, retargeting, history rewriting or substitution of a moving tip.

A blocked child remains the owner; do not launch its successor or a replacement. Preserve the blocker and next action in TODO, handle questions through the shared reporting guidance, and continue only independent authorized work. Child-owned pending CI is not a reason for a competing parent observer. Answers and recovery never renew child allowances.

## Recover and finish

After interruption or compaction, read existing TODOs/conversation, Mailbox messages, Git state and child checkpoints. Reconcile worker identity, ownership, pending effects and any observation receipts before continuing. Inspect uncertain launch or message effects before repeating operations; never blindly resend, replay a prompt or launch a duplicate child. Retrieve original authority when unclear; historical records do not grant takeover or fresh effects.

Report ticket status, branch/base/head/target, accepted result references, blockers or exceptions, and the next actor/action. Preserve predecessor-first merge order without merging: green against a stack base is not independent readiness for main. Publication, merge, restack, retarget, destructive actions, installation and live reload retain their separate gates. Retain sessions/worktrees until explicit cleanup authorization; use the owning skills' cleanup procedures.

For changes to this skill, run discovery/link and structural tests and inspect the [stack scenarios](references/verification.md). Structural checks do not prove model behavior; live exercises require separate authority.
