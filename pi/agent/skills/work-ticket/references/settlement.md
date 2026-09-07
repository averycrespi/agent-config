# Settlement and Cleanup

Follow [work-ticket](../SKILL.md) and [the checkpoint interface](helper.md). Settlement, cancellation, and removal need their own explicit authority; implementation or publication does not grant it. Never merge or deploy automatically.

## Settlement, cancellation, and accepted exceptions

Reread the immutable ticket and actual PR disposition. For normal PR settlement, verify the intended PR merged and its delivered scope/qualification; for local acceptance, record the user's actual acceptance. If Plane is already Done/Canceled, retain the observation rather than issuing a redundant update. Record a consequential pending effect before a necessary update, reread afterward, and confirm it.

Explicit user acceptance can resolve an incomplete review, missing qualification, or an unusual prior workflow state. Record the precise requirement, accepted revision/scope, action, actual instruction, and reference with `override`. Preserve failed/not-run checks, incomplete review, and unresolved findings as facts. Do not manufacture intermediate local-complete or awaiting-human states, or run retrospective review solely to satisfy a retired helper gate. Confirmed human acceptance does not authorize new publication or deletion.

For multiple tickets sharing a PR, reconcile each ticket's scope and the actual final merged change. Preserve predecessor evidence at its original revision; describe successor relationships in concise references rather than rebinding old checks. Do not waive unresolved identity or ownership conflicts.

## Safe removal

Load [herdr](../../herdr/SKILL.md) and use it for linked worktree removal. Confirm the exact checkout/workspace, all affected tickets, released writers, retained commits/branches, clean tracked/untracked work, and absence of in-progress Git operations. Inspect ignored files, nested repositories, handoffs, and temporary evidence for unique work at risk. An old blocked helper status is not a reason to refuse explicitly authorized cleanup; unresolved data loss or a live writer is.

Before removal:

1. Preserve all needed evidence outside the removal target, including legacy `.pi/tickets/`, handoffs, and referenced logs/reports. Use a persistent archive and a manifest of relative paths, sizes, and hashes; verify copied bytes. Do not prune old records to fit a helper schema. Do not treat temporary paths as durable archives.
2. Verify the new checkpoint's Git common directory survives removal. It normally survives linked-checkout removal; deleting the primary repository needs an external copy too. Preserve existing legacy cleanup archives unchanged.
3. Record the exact pending removal target and intent with `external begin` and reference the archive/safety evidence. Keep source files quiescent, release ownership, and retain the owner/ticket identity for confirmation from a surviving repository checkout.
4. Remove only the authorized checkout/workspace through Herdr without force. Do not bundle branch/archive deletion or unrelated workspace changes. Reread inventory and path absence, then `external confirm` from a surviving checkout. Report what remains and the next actor/action.

After interruption, check authoritative inventory, path identity, preserved evidence, and the pending intent before acting. If already removed, confirm rather than repeat removal. If removal provably did not occur, repeat fresh safety checks and allow at most one authorized retry, recording its consumption in the retained recovery reference. Changed/recreated paths or uncertain outcomes require reconciliation, not force removal.

The compact helper does not archive files, remove worktrees, or certify cleanup safety. Preserve and verify evidence through ordinary filesystem operations before removal. An original legacy pending receipt remains historical intent; retain fresh removal confirmation separately without rewriting that archive or pretending the old receipt was confirmed. Archives and checkpoints persist until their deletion is separately authorized.
