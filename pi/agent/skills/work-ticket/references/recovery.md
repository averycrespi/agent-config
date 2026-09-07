# Ticket Recovery

Follow [work-ticket](../SKILL.md) and [the helper interface](helper.md). Read existing state, then reconcile actual ticket, files, Git, ownership, PR, checks, and pending effects before acting. Preserve the run, plan, findings, unfinished repair batch, and consumed allowance. A state record is not proof of a live process, user consent, or a remote effect.

## Resume and transfer ownership

Use `reconcile` with common CAS/hash fields and concrete `observations`. A changed owner additionally requires `previousOwnerReleased: true`, established from actual session/process or release evidence. Cross-check portable claims and other checkout writers. Stop on malformed state, conflicting identity, or unresolved ownership; never initialize another attempt to bypass recovery.

Active reconciliation observes the current snapshot and invalidates stale evidence. For `local_complete` or `awaiting_human`, reconciliation may transfer ownership but preserves completion, original snapshot/evidence, findings, and authority. It records ownership history and does not authorize edits or publication. Reopening PR, Done, Canceled, or human-accepted delivery is not supported. Before subsequent actions, use fresh snapshots: terminal reconciliation preserves historical evidence, not a claim that current files are unchanged.

Reuse checks only for unchanged applicable inputs and scope. Use the helper's explicit content-independent reuse path only for eligible commits; otherwise obtain fresh evidence. Scope expansion requires reevaluation even when files did not change.

## Explicit local follow-up

An actual user request for additional implementation after local handoff authorizes a follow-up; ordinary resume, reconciliation, or unsolicited review suggestions do not. Reconcile ownership first if the previous session has released it, then use `reopen_local` with common CAS/hash fields and:

- `newContract`: newly authorized outcome/AC/evidence requirements, even if unchanged;
- `authorization: {operations, boundary: "local", evidence}` containing `implement` and optional `commit`, not unrelated operations;
- replacement `plan`, current `fingerprint`, fresh `observations`;
- `planeState: In Progress`, `noPrConfirmed: true` from authoritative inspection.

Require local completion, no recorded or actual PR, confirmed implementation-only external history, and no competing writer. This archives the previous delivery and returns active with fresh scope/authority. It preserves run, findings, consumed repairs, external history, and prior deliveries; it clears current evidence and stales review. Use the returned receipt before editing. Do not delete state or switch to untracked coding to evade completion.

Default repair allowance remains two cycles across the run. For genuinely new follow-up scope, an explicit user instruction may add one or two cycles using `additionalRepairCycles: {cycles, evidence}` on `reopen_local`. The helper requires a changed contract and retains the addition with its scope hash and authorization. Additional coding authority alone does not grant additional cycles. Never refund consumption or extend configured runtime limits through this operation.

For explicit publication of an unchanged local completion, use `begin_pr` under [publication](publication.md), not a fabricated coding follow-up. Publication adds no repair allowance.

## Interrupted effects and helper failures

Reread the authoritative external surface before resolving pending writes. Confirm observed effects; retry once only after proving the effect absent and still authorized. Do not repeat confirmed claims, PRs, or lifecycle changes.

After a helper crash, inspect the exact `.pi/tickets/.writer.lock/owner.json`; prove its process absent before removing that stale lock alone. Never delete ticket state to get unstuck. Use the same rule for archive locks.

## Settlement and cleanup recovery

Read [settlement](settlement.md) for already-merged acceptance and all cleanup requests. Reread `humanAcceptance` after interruption instead of repeating it or manufacturing successful review evidence.

Retain `archiveDir` and `cleanupId` outside the removal target. After interrupted cleanup, use `cleanup_status`, verify the archived identities/evidence, and inspect fresh Herdr inventory and source-path existence. If already removed, confirm the journal; if already confirmed, report it without repeating removal. If removal provably did not happen, `cleanup_retry` requires fresh safety checks and unchanged source evidence and permits only one retry.

Use `adopt_cleanup` only for an already removed checkout with original byte-preserved legacy evidence, as documented in settlement. Missing evidence, recreated paths, changed ownership, or ambiguous effects require a blocked handoff, not reconstructed success. Keep archives until deletion is separately authorized.
