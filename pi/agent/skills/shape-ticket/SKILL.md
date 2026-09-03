---
name: shape-ticket
description: Use when creating, refining, approving, or materially editing a Plane ticket intended for the minimal ticket-driven delivery workflow.
---

# Shape Ticket

Shape one independently deliverable Plane ticket. Plane is the canonical contract; do not create a local specification, plan, or ticket copy during shaping.

## Boundaries

- Read `../plane/SKILL.md` completely before accessing Plane; follow its shared organization, trust, identity, and write-confirmation contract.
- Ready authorizes implementation through an independently reviewed, CI-passing pull request promoted to ready for review, not merge, deploy, Plane completion or cancellation, cleanup, or destructive work.

## Minimum contract

Require the ticket body to settle:

- **Outcome:** one bounded result in one repository.
- **Acceptance criteria:** stable `AC-<number>` identifiers with observable pass/fail behavior.
- **Repository:** GitHub-style `owner/repository` identity.
- **Target branch:** the approved base branch.
- **Verification:** repository-required checks and any ticket-specific evidence.
- **Promotion:** `Draft pull request, promoted after independent review and exact-head CI pass`.
- **Constraints and out of scope:** only when material.

Record dependencies through Plane relationships rather than copying their status into prose. A ticket cannot become Ready while a blocking dependency is incomplete.

## Create or refine Draft

Workflow **Draft** is a visible lifecycle meaning, not Plane's `is_draft` flag. Ticket-driven work items must never use `is_draft: true`; that flag creates a hidden internal draft rather than a ticket in the project's normal work-item list.

1. Resolve the workspace, project, ticket type, likely duplicates, and the target project's configured states by immutable ID. Prefer a visible project state named Draft. If none exists, select an appropriate visible Backlog or other unstarted state and report that workflow Draft maps to it. Never assume a state name or ID.
2. Select one independently deliverable outcome. Split work that requires separate repositories, promotion decisions, or independently useful outcomes.
3. Present a complete **Draft preview** containing title, body, project, relationships, and the actual resolved Plane state name and ID. When using a fallback state, label the workflow-Draft-to-Plane-state mapping explicitly.
4. Require explicit approval before creating a new ticket. Approval to discuss or shape work is not creation approval.
5. Create or update the visible ticket with the resolved project state and without `is_draft: true`. Reread it, then find its immutable ID in the project's normal work-item list, accounting for pagination. Direct retrieval by ID alone is insufficient confirmation. Report its confirmed identifier, immutable ID, actual Plane state, and any fallback mapping.
6. Research answerable questions before asking the user. Use the clarification protocol for material product, compatibility, security, data, or migration decisions.

## Approve Ready

Before Ready, verify semantically that:

- the outcome and every acceptance criterion are complete and unambiguous;
- repository, target branch, verification, and PR promotion policy are explicit;
- all blocking dependencies are Done;
- the work fits one proportional implementation effort; and
- no unresolved decision can materially change delivery.

Read the exact current ticket contract body—the title and description fields presented in the Ready preview—and hash it through `../advance-ticket/scripts/ticket-run.js` using the `hash` action with one JSON request on stdin. Plane comments, relationships, lifecycle fields, and other workflow metadata are not part of the hashed contract body. Never interpolate ticket prose into shell arguments.

Present a distinct **Ready preview** containing the complete ticket, dependency states, and exact contract hash. Explain the authority Ready grants and withholds. Require fresh explicit Ready approval; Draft approval does not carry forward.

After approval:

1. Reread the ticket and confirm the preview still matches.
2. Move it to Ready.
3. Add a portable approval marker as a Plane comment, not as part of the ticket title or description. Include no local paths:

   ```text
   <!-- ticket-ready:v1 sha256:<approved-body-hash> -->
   ```

4. Reread Plane and confirm both Ready and the exact marker.

The marker proves which canonical contract body received approval. Comments are not part of the hashed contract body, so approval and later run-claim comments do not invalidate it. The marker does not prove implementation, review, merge, or completion.

## Material edits

For a Ready but undispatched ticket, return it to Draft before changing its contract and require a new Ready preview, hash, approval, and marker. For an active ticket, pause delivery first and require explicit operator handling; do not silently refresh the local assignment. Preserve Done or Canceled history by creating a related follow-up ticket instead of rewriting the old contract.

## Report

Report the confirmed ticket identifier and immutable ID, current state, repository and target branch, dependency disposition, approved contract hash when present, approval obtained in this invocation, and any blocker or operator action required.
