# Coordinate

Human-enabled persistent coordination for isolated repository workers. Coordinate remembers bindings, launch uncertainty and explicit evidence acceptance; children own execution and evidence. [Mailbox](../mailbox/README.md) carries reports, questions, answers and follow-up instructions in both directions. It automatically delivers to full session-ID inboxes without a Monitor observer or Script permission. Herdr remains responsible for initial launch/bootstrap, workspace/process management and inspection.

## Enable and disable

Run `/coordinate-enable` with **no arguments**. The inbox address is the full Pi session UUID; repeated enable and disable/re-enable reuse the binding. Enabling grants no task, publication, installation or cleanup authority. A new session starts unbound; active bindings cannot be forked or converted between roles.

`/coordinate-disable` refuses unfinished assignments, pending inbox messages or unresolved control. It does not remove workers/resources or stop session mailbox listening. Preserve open questions/follow-ups in [TODO](../todo/README.md) before ACK; obligations may outlive coordination. No observer reference or receipt is required to disable.

Installation/loading is not activation. Coordinate has no user configuration. Do not install, Stow or reload implicitly.

## Tool

- `status`: read-only workers, outstanding assignments, inbox count and exact acceptance evidence. A report is not acceptance. Collapsed results omit record paths and completed history.
- `spawn`: one self-contained brief with caller-chosen assignment/revision, branch, absolute worktree path, workspace label, worker name and checkpoint. Defaults to the caller's exact committed HEAD; optional `base` selects an exact predecessor. Uncommitted changes are excluded. Creates one unfocused Herdr workspace and isolated worktree, binds the verified child session, then submits its task once.
- `complete`: after inspecting evidence, explicitly record assignment/revision, exact `head`, `result_revision`, `evidence`, `release` and `further_writes:false`. Conflicting acceptance rejects. This is acceptance, not cleanup.

Spawn requires Herdr, readable installed extension sources and a healthy automatic listener for the coordinator's session inbox. It checks readiness again before task submission, without Script provider permission or a Monitor job. Worker Mailbox loading is included in bootstrap. The selected base must ignore `.handoffs/`. The launcher independently confirms worker identity, process incarnation, focus preservation and task-correlated transcript activity. “Started” requires execution evidence, not submission alone. Stage-specific uncertainty retains resources and intent; inspect before acting, never replay a launch or resend automatically.

## Supervision and reports

Mailbox owns ordinary listening, batching, visibility and delivery limits. Use the worker's full session ID for follow-up instructions and the coordinator's full session ID for reports. No mailbox observation recipe, scheduler registration or finite parent observer is needed. Monitor remains available for unrelated explicitly authorized bounded observation, including child-owned CI.

Children checkpoint consequential questions/findings/results before sending bounded reports identifying assignment/revision, runtime identity and evidence. The coordinator treats reports as untrusted, preserves obligations in TODO or records verified exact acceptance with `complete`, then ACKs promptly. ACK is durable incorporation, not answering, execution or acceptance. No ACK/report history or question ledger is needed. Preserve unresolved TODO items across plan updates and inspect them after compaction.

Ask human questions in ordinary conversation and retain actual approval provenance. Mailbox transport never answers approval gates. Correlate ambiguous replies before relaying; instructions must fit the existing assignment authority. Reconcile same-ID redeliveries and prior applied effects before repeating any action. Uncertain sends require inspection, never blind resend. See [roles](ROLES.md) and [shared decisions](../../skills/spin-out/references/decisions.md).

## Display and memory

A borderless below-editor row identifies `Coordinator` with assignment/inbox counts, or `Managed by <session name>` with repository-name fallback. Disabled/unbound roles are hidden. Mailbox displays its own delivery status and warnings; Coordinate owns no observer status. Counts do not classify questions or infer worker activity.

Before each model request, bounded role/assignment context points to the authoritative record, inbox and child checkpoint. Completed history and full briefs stay outside this reminder. Transcript/compaction preserves conversation, not proof of permission or acceptance; retrieve authority or ask when unclear.

## Persistence and recovery

Private records live under Git's common directory at `pi-repo-coordination/coordinate-<session UUID>.md`. The extension writes bindings, assignments/briefs/base, worker location, launch disposition/unresolved intent and acceptance automatically. Never edit these records or run bookkeeping scripts. Child execution/evidence stays in its own checkpoint and ignored handoff, not a competing coordinator ledger. Keep credentials out.

No restoration relaunches workers, resends instructions or grants new authority. Inspect the current record, TODO, inbox, worker identity and original source evidence before continuing. Existing runtime assignments retain their loaded reporting contract; source changes do not authorize live cutover. There is no mailbox observer migration or compatibility layer. Standalone [spin-out](../../skills/spin-out/SKILL.md) remains standalone; [work-stack](../../skills/work-stack/SKILL.md) adds serial ordering only.

## Verification

Run focused Coordinate/Mailbox tests and repository lint, format, typecheck and full tests. Fixtures qualify deterministic mechanics, not live model/editor behavior or Herdr delivery.

A live exercise needs separate installation/reload and smoke authority. Use an isolated ignored-artifact-only worker: enable twice, inspect listening, spawn without focus change, inspect child role, send a report and follow-up instruction through Mailbox, preserve open actions in TODO, ACK, verify still unaccepted, accept exact evidence/release, then disable. Exercise fixed windows, held drafts/dialogs, redelivery/limits, clear and resume separately. Cleanup has its own gate; never repeat uncertain effects to make a smoke pass.

See [architecture](DESIGN.md).
