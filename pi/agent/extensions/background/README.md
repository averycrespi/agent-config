# Background execution

Keep the conversation available while an extension's existing executor runs. Background owns persisted admission, retained outcomes, below-editor rows and automatic notifications. It registers **no model-facing tool** and is not Monitor, an executor, or a polling scheduler.

[Script](../script/README.md#background-execution), [Subagents](../subagents/README.md#background-execution), and [Workflows](../workflows/README.md#background-execution) are supported adapters. The chosen adapter and Background must both be loaded. Installing files does not reload existing sessions. Missing Background or an ephemeral session fails admission; there is no foreground fallback. No user-facing configuration or additional permissions are introduced.

## Lifecycle and attention

An admitted execution receives a stable UUID before work starts. Its adapter retains the original provider policy, execution context, cancellation and finite deadline. Background never renews a deadline or resumes work. Cancellation requests abort; it does not roll back external effects. Dismissal is terminal-only: it clears attention but preserves results/accounting, and cannot retract a message already handed to Pi.

Every admitted execution has one sanitized, width-bounded row below the editor: `<source> <state> · <effects warning> · <label> · <telemetry>`, with `script`, `workflow`, or singular/batch `subagent`/`subagents` as the source. Rows contain genuine lifecycle state, not simulated progress. Adapters may report aggregate settled/total and failed counts, or genuine workflow phase and settled/started logical-call counts; per-child details remain in adapter inspection. Terminal rows remain until observed notification consumption or explicit dismissal. The widget repaints in place without reordering sibling widgets. IDs remain in inspection rather than taking widget width from state, warnings or names. At 64 columns combined warnings can compact to `unknown/persist failed/handoff?`; inspection retains full wording.

Success, failure, timeout, cancellation and interruption record notification intent. A bounded identity/outcome/result-reference message is handed to Pi automatically when idle, without a visible TUI draft, pending messages or extension dialog. A one-second readiness timer notices cleared drafts; it never runs executor work or polls a model. Headless/RPC delivery also uses the ordinary follow-up queue. A process that exits cannot deliver until the original session returns.

Intent, handoff (`none`, `unknown`, `handed_to_pi`) and observed consumption are separate. Consumption means the notification appeared in observed model context followed by a successful provider HTTP response; it is **not semantic acceptance**. Providers without that response hook leave consumption unconfirmed and the row visible; use explicit dismissal. Other trusted extensions can transform context/payloads, so this is an observation, not proof of model comprehension. Handoff is persisted as uncertain before sending. Throws, crashes and uncertain delivery never cause automatic replay.

Shutdown/reload and successful tree navigation revoke the old service and request abort. Pending work becomes interrupted with conservative unknown-effect evidence. Restoration exposes receipts on their original admission branch, never launches work or renews budgets. Late callbacks cannot update a replacement service. A canceled navigation does not revoke ownership. Forked sessions do not adopt the original session's sidecar or executions.

## Notification display

Interactive outcomes use the shared [one-line notification renderer](../_shared/README.md#asynchronous-custom-messages): `script succeeded · Demo prime numbers`, for example. Lowercase source and explicit outcome precede warnings and the bounded name; full IDs stay expanded. `customMessageBg` distinguishes notifications from tool rows without icons or padding. Supported narrow content widths are 48 columns; optional identity drops before essential status/warnings. Success, failure, timeout, cancellation and interruption remain distinct and never color-only.

Use Pi's normal tool/message expansion (`Ctrl+O` by default) for full bounded identity, adapter inspection instructions and original notification text; collapse returns to the compact summary. Display text is terminal-sanitized and width-bounded, with explicit expanded-display truncation disclosures. Missing/historical display metadata shows status unavailable rather than guessing from prose. Rendering never fetches results, consumes/dismisses an outcome, triggers a turn or replays execution. Complete model-facing content, references, delivery and RPC/headless semantics are unchanged.

## Persistence and limits

Each persistent Pi session has a separate owner-only `<session-file>.background-executions-v1.json` sidecar. It contains labels, IDs, lifecycle/notification metadata and adapter results/accounting, **not source or provider credentials**. Explicit results can nevertheless contain sensitive data; this is not a secret filter. Script arguments remain in normal Pi history. No diagnostic logs or result spills are added.

Limits are fixed: **4 active executions, 32 retained records and 32 outstanding notifications per session**, a 64,000-byte adapter result, and a 2,200,000-byte sidecar. Updates validate before atomic replacement and filesystem synchronization. Capacity or storage failure rejects admission before work. Persistence failure during execution closes further admission, aborts owned work and exposes in-memory uncertainty; retained disk bytes must be reconciled, never replayed.

There is no silent eviction, age expiry or automatic deletion, even after dismissal. At 32 retained executions use a new session; preserve old evidence according to your session-retention policy. Sidecars must be retained with their sessions. A failed filesystem operation may leave an owner-only staging file; it is not replayed or silently cleaned up. Same-user hostile filesystem mutation and concurrently opening the same session in multiple Pi processes are outside the cooperative single-owner contract.

New records never read or overwrite historical `background:receipt-v1` observer entries. [Monitor](../monitor/README.md) alone interprets those receipts.

## Troubleshooting

- `background_unavailable`: load the service in a persistent session; inspect storage errors. Do not silently fall back.
- `background_capacity`: active work must finish, or the retained session is full. Dismissal does not delete evidence.
- `background_storage_failed_no_replay`: inspect retained sidecar and reconcile effects before further work. No retry is automatic, including when atomic publication may have succeeded.
- `background_active_execution`: cancel or wait for the terminal outcome before dismissal.
- `background_unknown_execution`: check the adapter owner and active session branch.

See [API.md](API.md) for the host contract and [DESIGN.md](DESIGN.md) for invariants.
