# Stack checkpoint

Keep one parent-owned Markdown record at `<git-common-dir>/pi-stack-checkpoints/<unique-stack-id>.md`. Resolve the common Git directory through Git; this location is outside tracked worktrees and survives linked-checkout removal. Verify the path is outside tracked content, create a fresh record without overwriting an existing stack, and protect it as local recovery data. Never stage it, handoffs, or private runtime identifiers. Do not add a tracked checkpoint or a new delivery-state helper.

Before initialization, inspect existing stack and per-ticket records for competing ownership. On recovery, read the existing record first. Preserve its stack identity, authority, accepted evidence, unresolved effects, and next action; do not initialize a replacement merely because a session changed. One parent writes this record. Children own their ticket records through [work-ticket's helper](../../work-ticket/references/helper.md); the parent reads/references those records but never claims or edits them to advance the stack.

Maintain a fixed-section current-state snapshot, not an accumulating narrative. Replace superseded values in place; mark unavailable facts explicitly as unknown. Keep one row per ticket and one current parent observation entry for the active child. Use the [compact template](#compact-template); omit empty sections. Target a few KB for a small stack; size should grow with tickets and unresolved decisions, not wake count. Never meet the size target by dropping unresolved effects, adverse evidence references, authority or consumed allowances.

| Section        | Retain                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Unique stack ID, repository/common-directory identity, parent session UUID and active/released ownership; instruction authorizing any transfer                                                  |
| Authority      | Actual user request/reference, exact ordered project/ticket UUIDs and canonical criteria references, local-only or PR-ready boundary and exclusions per ticket                                  |
| Starting point | Initial target branch and immutable base SHA, prerequisite/dependency reconciliation references                                                                                                 |
| Tickets        | Per-ticket checkpoint path; assigned branch/worktree/Herdr workspace/pane/agent; child session UUID and live incarnation; predecessor identity, target branch, creation base SHA, verified head |
| Observation    | Current parent watch ID/incarnation and receipt reference/disposition, cumulative allowance summary below, unresolved coverage gaps; retain prior reconciled receipts by reference              |
| Evidence       | Accepted boundary outcome and revision-bound artifact references; child checkpoint reference for delivery details, pending child observers/effects and adverse findings; explicit exceptions    |
| Current intent | Exact pending create/start/prompt target and expected effect, attempted versus confirmed results, reconciliation reference; at most one executing ticket child                                  |
| Next           | Current ticket or finished position, blocker if any, next actor and concrete action                                                                                                             |

Keep each fact with one owner:

- Parent: stack order/authority, assignments, accepted boundary evidence, launch/control intent and parent observation allowance.
- Child: implementation progress, current decision request/context and resolution provenance, repair/CI allowances, delivery evidence and child-owned effects/jobs. Reference its checkpoint and revision-bound artifacts; do not mirror its progress or maintain another CI ledger.
- Background: exact registration bounds, coverage timestamps and receipt dispositions. Reference retained receipts rather than transcribing their fields into prose. Keep the current job ID/incarnation, accounted receipt identity, cumulative usage and unresolved gaps in the parent snapshot so recovery cannot double-charge or overlook an uncertain handoff.

For each child's parent-owned observation, retain the selected duration and attempt ceiling (defaults: 8 hours and 40 attempts), original deadline, current authorized deadline, cumulative attempted wakes (including uncertain handoffs), any reserved attempt, and references to explicit policy overrides/additive allowances. Preserve these across registrations/reloads/recovery; never use a replacement as a fresh budget. Retain immutable cycle/lifetime/wake bounds and actual coverage boundaries in referenced receipts. Do not copy the parent's changing deadlines or wake counts into child handoffs; give the parent checkpoint reference instead. Child CI keeps its separate child-owned ledger.

Prefer reference-first recovery: reopen child checkpoints, revision-bound artifacts and exact session entries instead of making the parent self-contained in delivery detail. Preserve historical user instructions, superseded authority, failed evidence and resolved effect/observation receipts through durable references before replacing their inline detail. Identify session evidence by absolute session path and entry/tool-call ID, not merely "session history". Use existing session records and persistent artifacts where sufficient; retain an exact receipt or instruction artifact beside the checkpoint only when its source may expire or cannot be reliably reopened. Do not create rolling copies of the whole snapshot or a parallel per-wake audit log. Do not rely solely on Background's bounded receipt inventory. On recovery, reconcile unresolved state before compacting a legacy narrative; never discard uncertainty or rewrite failures as success. This is reference retention, not a second delivery-state helper or a requirement to write a per-wake prose log.

For a [pending child decision](decisions.md), keep its request ID, child/ticket/run/session identity and current head/context revision by checkpoint/report reference under `Next`; do not copy a second question history. The child remains the sole implementation owner. Keep the parent's current answer/provenance/authority reference and exact continuation target/effect under `Current intent` until reconciled. Distinguish submission from acknowledged application, preserve stale/uncertain effects, and never treat decision waiting as owner release or delivery. Parent allowance remains in `Observation`; child allowances remain child-owned and are not reset by an answer.

Checkpoint before each consequential launch/control effect and after confirming its identity/result, when observer identity/accounting changes, after boundary reconciliation, and before stopping with changed recovery state. Combine changes known at the same safe boundary into one update; do not repeat an unchanged snapshot after every tool call or turn. Never combine a required before-effect intent and after-effect confirmation into a single post-hoc write. Retain unresolved intent until observed evidence resolves it; a process/PR may exist even if its creation receipt was lost. Keep concise values and references, not a copied transcript, duplicate check history, phase cursor, or generic task-result protocol.

On a routine wake, replace the current observation and next-action values, accounting each receipt once; do not append child progress, receipt timestamps or a resolved-job narrative. Keep an accounting anchor to the last reconciled receipt plus the durable session sequence needed to resolve any gap or uncertain consumption. After a confirmed launch/continuation, remove its resolved prose from `Current intent` and retain its confirmation reference with the assignment/current decision. After accepting a child, reduce it to one ticket row: checkpoint reference, assigned branch/target/creation base/accepted head, accepted outcome and revision-bound evidence/release references, and unresolved exceptions. Retain that child's final parent allowance/accounting by reference before replacing the active observation entry. Verification requires independently reading evidence, not copying it.

## Compact template

Use descriptive placeholders below only as a shape; replace them with exact identities, full SHAs, absolute readable paths and stable references. An evidence reference may cover several related facts when its scope/revision is explicit. Do not create another artifact solely to fill a template slot.

```markdown
# Stack <id>

## Identity and authority

Repository/common dir: <path>; parent: <session UUID>, active
Authority: <actual request + exact source reference>; boundary: <local/PR-ready>
Order: <project UUID + ordered ticket UUIDs>; exclusions: <actual restrictions>

## Starting point

Initial target/base: <branch>@<full SHA>; dependencies/criteria: <exact references>

## Tickets

| Ticket | Assignment                                                          | Owner/checkpoint                       | Accepted boundary                                                                  |
| ------ | ------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| <UUID> | <worktree/branch; pane/agent; predecessor; PR target; creation SHA> | <session/incarnation; checkpoint path> | <not accepted, or outcome/head + revision-bound evidence/release refs; exceptions> |

## Observation

Active child: <UUID/session/incarnation>; job: <UUID or none>
Policy: <duration>/<attempt cap>; original/current deadline: <timestamps>
Attempts: <consumed>/<reserved>; accounted through: <exact receipt reference>
Unresolved coverage/effects: <none or concrete gap + evidence reference>
Authority additions/prior accounting: <references, only when applicable>

## Current intent

<Only unresolved create/start/prompt/decision effect; exact target and authority reference>

## Next

<Current position; blocker/decision reference if any; actor and concrete action>
```

For example, after a routine timeout, replace `job: J1; attempts: 3/1; accounted through: R0` with `job: J2; attempts: 4/1; accounted through: R1` only after reconciling J1 and registering J2 with its own safe intent/result boundaries. Preserve the original/current deadlines. Do not append "J1 timed out; child finished unit tests; J2 registered" or repeat R1's host fields. If registration is uncertain, retain its unresolved intent/reservation rather than writing J2 as confirmed.

After ten routine wakes, the snapshot should remain approximately the same size, with updated accounting and exact recoverable references. Test this behavior with the [compact-state scenarios](verification.md#compact-state-regression-scenarios); a template or structural test alone cannot enforce model compliance.

On parent transfer, establish the prior parent has relinquished orchestration or is proven inactive under actual takeover authority; preserve child owners. Match existing children through ticket/run identity plus Herdr and Git evidence. Reconcile originating watch receipts before replacing observations, never resubmit a possibly accepted prompt. A released record or green checkbox is not proof of current Git/PR facts. Stop on corrupt/conflicting state rather than deleting it.

At final handoff, mark parent ownership released and persist the same next actor/action reported to the user. Keep all ticket and evidence references; removal needs separate authority.
