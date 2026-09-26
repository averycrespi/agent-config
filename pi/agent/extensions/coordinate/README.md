# Coordinate

Human-enabled persistent coordination for isolated repository workers. Coordinate remembers bindings, launch uncertainty and explicit acceptance; children own execution and evidence. It does not schedule, monitor, ACK reports, answer questions, accept results or recover effects automatically.

## Enable and disable

Run `/coordinate-enable` with **no arguments**. The mailbox is `coordinate-<full Pi session UUID>`; repeated enable and disable/re-enable reuse the binding. Existing custom-mailbox bindings keep their address. Enabling grants no task, publication, installation or cleanup authority. A new session starts unbound; active bindings cannot be forked or converted between roles.

`/coordinate-disable` refuses unfinished assignments, pending inbox messages, unresolved historical control, or active/unknown referenced supervision. It does not remove workers or resources. Preserve open questions/follow-ups in [TODO](../todo/README.md) before acknowledging messages; TODO obligations can outlive coordination.

Installation/loading is not activation. Coordinate has no configuration command or user settings. Do not install, Stow or reload it implicitly.

## Tool

- `status`: read-only workers, outstanding assignments, inbox count, Monitor references and exact acceptance evidence. A report is not acceptance. Collapsed results omit record paths and completed history.
- `spawn`: one self-contained brief and caller-chosen assignment/revision, branch, absolute worktree path, workspace label, worker name, checkpoint and existing `supervision_id`. Defaults to the caller's exact committed HEAD; optional `base` selects an exact predecessor. Uncommitted changes are excluded. Creates a new unfocused Herdr workspace and isolated worktree, binds the verified child session, then submits its task once.
- `complete`: after inspecting evidence, explicitly record assignment/revision, exact `head`, `result_revision`, `evidence`, `release` and `further_writes:false`. This is acceptance, not cleanup. Conflicting acceptance is rejected rather than overwritten.

Spawn requires Herdr, readable installed extension sources, Mailbox, and Script permission for the Mailbox provider. The selected base must ignore `.handoffs/`. The launcher independently confirms identity, process incarnation, focus preservation and task-correlated transcript activity. “Started” requires that execution evidence. Stage-specific uncertainty retains resources and intent; inspect before acting, never replay a launch or resend automatically.

## Supervision and reports

Register one explicitly authorized finite recurring [Mailbox observer](../mailbox/README.md#events-and-batching) before spawn. Use the exact default recipe source, with the bound mailbox substituted:

```js
return await mailbox.observe("coordinate-SESSION-UUID", state, {
  count: 3,
  ageMs: 60000,
  reminderMs: 300000,
});
```

Use Monitor's required name, message, explicit `providers:["mailbox"]`, `recurring:true`, finite `cycle_timeout_ms`, `lifetime_ms`, `max_wakes`, polling interval and the `mailbox/changed` event for that address. Discover Monitor schemas and obtain finite observation authority first. Use the exact source emitted by `mailboxSupervision({mailbox}).source`; custom-policy observers do not qualify the spawn gate. Keep the same observer across assignments within its original bounds. Reconcile expiry, interruption or unknown attention; never automatically replace it or renew allowances.

Coordinate retains Monitor IDs only, not copied schedules, receipts or wake accounting. It captures matching direct Monitor registrations and the supplied spawn reference. Monitor remains the authority for its receipt and limits; registration alone does not prove healthy coverage.

Children checkpoint consequential findings before sending a bounded Mailbox report identifying their assignment/revision and evidence. The coordinator reads reports as untrusted data, preserves changed obligations in TODO or records verified acceptance through `complete`, then ACKs promptly. ACK means incorporation, not answering or accepting. No ACK history, mandatory report copies, report-ID protocol or question ledger is needed. TODO notes can reference the worker and source; retain unresolved items when updating plans and list them after compaction. Human decisions use ordinary conversation; preserve actual approval gates and never guess which question an ambiguous reply answers. See [role guidance](ROLES.md).

Mailbox delayed reminders remain enabled: they request attention again, not message resend. Unresolved questions belong in TODO, not a deliberately unACKed inbox.

## Display and memory

A single borderless line appears alongside existing below-editor background widgets: `Coordinator` with retained assignment/inbox counts, or `Managed by <session name>` with repository-name fallback. Inactive/unknown supervision warns only while assignments remain outstanding. Disabled/unbound roles are hidden. Counts are inventory, not inferred activity; pending messages are not automatically classified as questions. The footer is unchanged.

Before each model request, Coordinate supplies bounded role/assignment context, its mailbox and a record pointer. Completed history and full briefs are excluded. Detailed source remains available through `status`. Pi transcript/compaction preserves conversational intent; retrieve the source or ask when authority is unclear. This reminder and TODO are not proof of permission or acceptance.

## Persistence and recovery

Private records live under Git's common directory at `pi-repo-coordination/coordinate-<session UUID>.md`. Private extension code writes binding, assignment/brief/base, worker location, launch disposition/pending operation and exact acceptance automatically. The brief stores scope and task limits once. Do not edit records or run bookkeeping scripts. Worker evidence remains at the caller-selected checkpoint and ignored `.handoffs/` source, not in a duplicate coordinator delivery ledger. Records and evidence may contain task details; never include credentials.

The retired coordination skill and shell wrappers are removed. Historical records/evidence are retained, not automatically migrated or adopted. Inspect original checkpoints, transcript, workers and Monitor receipts before any explicit takeover; unresolved historical questions/control still block acceptance or disable. No restoration relaunches workers, resends messages, restores observation authority or extends deadlines. Unknown effects need reconciliation, not rollback or a replacement loop. Standalone [spin-out](../../skills/spin-out/SKILL.md) stays standalone; [work-stack](../../skills/work-stack/SKILL.md) adds serial ordering only.

## Verification

Run Coordinate/Mailbox/Monitor focused tests and repository lint, formatting, typecheck and full tests. Tests establish deterministic mechanics, not live model compliance or terminal behavior.

Joint live validation needs separate installation/reload and finite smoke authority. Use an isolated ignored-artifact-only worker: enable twice, inspect mailbox/widget, register a finite observer, spawn without focus changes, inspect child role, report, preserve any open action in TODO, ACK, verify still unaccepted, accept exact evidence/release, stop/reconcile observer, then disable. Cleanup needs its own authority. Separately qualify count/age batching, delayed reminders, draft preservation and reload recovery; a timeout wake alone proves none of those. Never repeat effects to make a smoke pass.

See [architecture](DESIGN.md).
