---
name: shape-ticket
description: Use when creating, refining, approving, or materially editing a Plane ticket intended for the minimal ticket-driven delivery workflow.
---

# Shape Ticket

Shape one independently deliverable Plane ticket. Keep the canonical contract in Plane; do not create a local specification or ticket copy during shaping.

## Boundaries

Read `../plane/SKILL.md` completely before accessing Plane; follow its shared trust, identity, organization, and reread-after-write contract. Creating a ticket or setting it Ready does not authorize implementation. “Implement this ticket” authorizes local edits and verification, not automatically commit, push, or PR publication. Explicit approval may bundle clearly stated actions; record its authorized scope and completion boundary when handing off to `work-ticket`. Merge, deployment, settlement, cancellation, and cleanup require their own authority.

## Minimum contract

Require:

- **Outcome:** one bounded result in one repository.
- **Acceptance criteria:** stable `AC-<number>` identifiers with observable pass/fail behavior.
- **Repository and target branch:** explicit repository identity and intended base branch.
- **Verification:** repository-required checks and ticket-specific evidence.
- **Material constraints and dependencies:** compatibility, security, data, isolation, resource, or delivery requirements that change implementation; identify out-of-scope work where useful.

Record blocking dependencies through native Plane relationships and inspect their actual states. Do not mark work ready to start while a material blocking dependency is unresolved. For intended PR delivery, describe draft publication followed by promotion only after independent review and required exact-head CI pass; this is a delivery contract, not publication authority.

## Create, refine, or approve

1. Resolve the project, ticket identity or likely duplicates, and configured state IDs. Use a visible Draft/Backlog state for a still-changing contract, not hidden `is_draft: true`. Report a fallback state mapping when the project has no Draft state.
2. Inspect relevant repository context and research answerable uncertainty. Use [the clarification protocol](../clarify/references/protocol.md) for material user-owned choices. Split genuinely independent outcomes; avoid splitting merely to satisfy an execution phase machine.
3. Present the proposed outcome and material decisions when approval is missing. Approval to discuss is not approval to create or mutate. A request explicitly authorizing creation, edits, or Ready can cover those actions without separate Draft and Ready previews, approval-hash comments, or repeated confirmation ceremonies.
4. Before marking Ready, confirm the contract is clear, verifiable, routed to one repository/base, and free of unresolved material decisions or blockers. Ready expresses contract readiness only. Do not infer permission to implement from a state or historical marker.
5. Apply only authorized changes, reread the authoritative ticket, and confirm the intended fields/state/relationships. After creation, verify the immutable ID appears in the project's normal work-item list, including pagination; direct retrieval alone cannot prove visibility.

For material changes to an active ticket, coordinate with its owner and obtain authorization for scope drift before further implementation. Routine plan adjustments within the approved outcome need no new ticket approval. Preserve Done/Canceled history with a follow-up rather than silently rewriting a settled contract.

## Report

Report the confirmed identifier, immutable ID, current state, repository/base, dependency disposition, material unresolved decisions, and the exact approval obtained. Distinguish contract readiness from authorization to implement, commit, or publish. Route authorized execution, inspection, and recovery to `work-ticket`.
