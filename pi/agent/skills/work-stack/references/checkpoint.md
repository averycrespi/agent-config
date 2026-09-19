# Stack checkpoint

Keep one parent-owned Markdown record at `<git-common-dir>/pi-stack-checkpoints/<unique-stack-id>.md`. Resolve the common Git directory through Git; this location is outside tracked worktrees and survives linked-checkout removal. Verify the path is outside tracked content, create a fresh record without overwriting an existing stack, and protect it as local recovery data. Never stage it, handoffs, or private runtime identifiers. Do not add a tracked checkpoint or a new delivery-state helper.

Before initialization, inspect existing stack and per-ticket records for competing ownership. On recovery, read the existing record first. Preserve its stack identity, authority, accepted evidence, unresolved effects, and next action; do not initialize a replacement merely because a session changed. One parent writes this record. Children own their ticket records through [work-ticket's helper](../../work-ticket/references/helper.md); the parent reads/references those records but never claims or edits them to advance the stack.

Use a short record with these fields; omit unavailable facts explicitly as unknown, not guessed values:

| Section        | Retain                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Unique stack ID, repository/common-directory identity, parent session UUID and active/released ownership; instruction authorizing any transfer                                                  |
| Authority      | Actual user request/reference, exact ordered project/ticket UUIDs and canonical criteria references, local-only or PR-ready boundary and exclusions per ticket                                  |
| Starting point | Initial target branch and immutable base SHA, prerequisite/dependency reconciliation references                                                                                                 |
| Tickets        | Per-ticket checkpoint path; assigned branch/worktree/Herdr workspace/pane/agent; child session UUID and live incarnation; predecessor identity, target branch, creation base SHA, verified head |
| Observation    | Parent watch ID, target incarnation, selected events, registration/deadline and receipt reference/disposition; interruption or uncovered interval awaiting reconciliation                       |
| Evidence       | Boundary outcome and revision-bound local/review/PR/check references; pending child observers/effects referenced in ticket record; adverse findings and explicit exceptions                     |
| Current intent | Exact pending create/start/prompt target and expected effect, attempted versus confirmed results, reconciliation reference; at most one executing ticket child                                  |
| Next           | Current ticket or finished position, blocker if any, next actor and concrete action                                                                                                             |

For each child's parent-owned Background observation, retain the selected per-child duration and cumulative attempt ceiling (defaults: 2 hours and 30 attempts), any explicit user policy override and its authority reference, the original absolute wall-clock deadline, cumulative attempted wakes (including uncertain handoffs), explicit additive user allowances, actual coverage boundaries and pending gaps across every registration/reload/recovery. Store the immutable cycle/lifetime/wake bounds and exact job ID; never use a replacement as a fresh budget. The child's CI ledger is separate and remains child-owned.

Checkpoint before each consequential launch/control effect, after confirmed resource identity, after boundary reconciliation, and before ending a turn or handing off. Keep concise updates and references, not a copied transcript, duplicate check history, phase cursor, or generic task-result protocol. Retain unresolved intent until observed evidence resolves it; a process/PR may exist even if its creation receipt was lost.

On parent transfer, establish the prior parent has relinquished orchestration or is proven inactive under actual takeover authority; preserve child owners. Match existing children through ticket/run identity plus Herdr and Git evidence. Reconcile originating watch receipts before replacing observations, never resubmit a possibly accepted prompt. A released record or green checkbox is not proof of current Git/PR facts. Stop on corrupt/conflicting state rather than deleting it.

At final handoff, mark parent ownership released and persist the same next actor/action reported to the user. Keep all ticket and evidence references; removal needs separate authority.
