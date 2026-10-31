# Settlement and Cleanup

Follow [work-ticket](../SKILL.md) and [the checkpoint interface](helper.md). Settlement, cancellation, and removal need their own explicit authority; implementation or publication does not grant it. Never merge or deploy automatically.

## Settlement, cancellation, and accepted exceptions

Reread the immutable ticket and actual PR disposition. For normal PR settlement, verify the intended PR merged and its delivered scope/qualification; for local acceptance, record the user's actual acceptance. If Plane is already Done/Canceled, retain the observation rather than issuing a redundant update. Record a consequential pending effect before a necessary update, reread afterward, and confirm it.

Explicit user acceptance can resolve an incomplete review, missing qualification, or an unusual prior workflow state. Record the precise requirement, accepted revision/scope, action, actual instruction, and reference with `override`. Preserve failed/not-run checks, incomplete review, and unresolved findings as facts. Do not manufacture intermediate local-complete or awaiting-human states, or run retrospective review solely to satisfy a retired helper gate. Confirmed human acceptance does not authorize new publication or deletion.

For multiple tickets sharing a PR, reconcile each ticket's scope and the actual final merged change. Preserve predecessor evidence at its original revision; describe successor relationships in concise references rather than rebinding old checks. Do not waive unresolved identity or ownership conflicts.

## Persistent artifacts

Keep full delivery evidence at `<git-common-dir>/pi-ticket-artifacts/<ticket-uuid>/<run-id>/`. Resolve the Git common directory from the repository, not by assuming a linked checkout's `.git` is a directory. This sibling of `pi-ticket-checkpoints/` survives linked-worktree removal; the strict checkpoint store accepts checkpoint files only, not artifact directories. Keep compact references in the existing checkpoint, not a second delivery ledger.

Keep evidence needed for active delivery or unresolved operations at unique paths. Once work is complete, an explicit workspace cleanup includes its task-owned handoffs, temporary reports and execution bookkeeping. Discard that scratch state rather than copying it into another checkout or `.git/`; no blanket archive or checksum manifest is required. Final results normally remain in commits, PRs or conversation.

Protect unique implementation/user work, artifacts explicitly requested for retention and evidence needed to reconcile unresolved operations. If such material lies inside the removal target, retain only what is needed outside it and verify the copy before removal. Ask only when its disposition is materially unclear. Do not silently sweep unrelated historical archives or checkpoints. Keep generated reports outside maintained source.

## Safe removal

Load [herdr](../../herdr/SKILL.md) and use it for linked worktree removal. Confirm the exact checkout/workspace, all affected tickets, released writers, retained commits/branches and absence of in-progress Git operations. Inspect tracked, untracked and ignored files and nested repositories for unique implementation/user work or unresolved operations; disposable task scratch is not a preservation blocker. An old blocked helper status is not a reason to refuse explicitly authorized cleanup; unresolved data loss or a live writer is.

Before settlement, cancellation or removal, cancel any still-active ticket-owned Monitor CI job by recorded ID and reconcile its host terminal receipt with the checkpoint helper. Preserve uncertain registrations for reconciliation, never cancel unrelated jobs, and do not assume cancellation retracts a Pi-owned follow-up.

Before removal:

1. Separate disposable task scratch from protected material under [persistent artifacts](#persistent-artifacts). Remove scratch as part of the requested cleanup; retain and verify only protected material that would otherwise be lost. Do not relocate ephemeral handoffs merely to preserve task history.
2. Keep any checkpoint needed to reconcile the removal outside the target. The Git common directory normally survives linked-checkout removal; removal of the primary repository needs a surviving location for that unresolved operation.
3. Record the exact pending removal target and intent with `external begin` and reference the relevant safety evidence. Keep source files quiescent, release ownership, and retain the owner/ticket identity for confirmation from a surviving repository checkout.
4. Remove only the authorized checkout/workspace through Herdr without force. Do not bundle branch deletion or unrelated archive/workspace changes. Reread inventory and path absence, then `external confirm` from a surviving checkout. Report what remains and the next actor/action.

After interruption, check authoritative inventory, path identity, preserved evidence, and the pending intent before acting. If already removed, confirm rather than repeat removal. If removal provably did not occur, repeat fresh safety checks and allow at most one authorized retry, recording its consumption in the retained recovery reference. Changed/recreated paths or uncertain outcomes require reconciliation, not force removal.

The compact helper does not archive files, remove worktrees or certify cleanup safety. Verify actual removal and reconcile pending effects through ordinary tools. A legacy pending receipt is not proof of removal. Task-owned disposable checkpoints and artifacts are included in explicit cleanup; retention is justified by remaining work or an explicit request, not by their having existed.
