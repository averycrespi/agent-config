# Checkpoint helper

Run `node <absolute-skill-path>/scripts/ticket-state.js` with one JSON object on stdin, using a quoted heredoc. Supply absolute repository-root `cwd` and immutable Plane UUID `ticketId`; mutations also require the current session UUID as `owner`. Requests/results are bounded to 64 KiB. Success returns `{result: ...}`; failure returns `{error: ...}` and exits nonzero without partial mutation. Never interpolate ticket prose into shell arguments.

Records live at `<git-common-dir>/pi-ticket-checkpoints/<ticketId>.json`, outside tracked worktrees, with owner-only permissions. They survive linked-checkout removal, not deletion of the primary repository. Never stage checkpoints, handoffs, secrets, or transcripts. A checkpoint retains evidence, not independent approval or remote truth.

## Operations

- `status`: no owner required; returns the full record or `{missing: true, legacy: pathOrNull}` without creating state. Read full state on recovery/conflict, not after every mutation.
- `init`: supply `patch` with concise `scope`, actual `authorization`, `plan`, and `next: {actor, action}`. Inspect legacy state and other writers first.
- `checkpoint`: partial `patch`; allowed fields are `scope`, `authorization`, `plan`, `progress`, `blocker` (text/null), `next`, `evidenceRefs`, `findingRefs`, and `pr` (reference/null). Reference arrays append without duplicates. Evidence retains its original revision/scope; saving it does not qualify a new revision.
- `release`: relinquish ownership without deleting evidence or pending effects.
- `claim`: supply `previousOwner`, actual user `instruction`, and fresh release/writer-absence `evidence`; explicit relocation also supplies `previousCheckout`. Reconcile processes and identity first; stored ownership is not proof of liveness.
- `repair`: `kind: review/ci`, `operation: begin`, stable `id`, and concise `plan` before edits. Default two batches of each kind. Identical retries do not recharge/reopen a finished batch. Finish with `operation: finish` and the active ID; this does not certify success.
- `override`: `override: {id, requirement, scope, action, instruction, reference}` records an actual scoped user exception, not invented permission. Allowance additions also supply `budget: review/ci/wait` and positive integer `additional` (batches or milliseconds). Waiting additions require an existing CI ledger and a reconciled watcher. Never reset consumption or erase failed evidence.
- `external`: before a consequential write, `operation: begin`, stable `id`, exact `target`, and `intent`; after authoritative reread, `operation: confirm`, same `id`, and `reference`. Reconcile pending effects before a different effect. Never replay an external mutation to obtain a receipt. Confirmation remains available to the recorded owner after release/removal through a surviving checkout.

Mutation acknowledgments return saved path, next action, repair usage, and compact CI disposition. Full reports/logs belong in retained artifacts, not this record.

## CI registration and cumulative accounting

The active adapter is `scripts/ci-background.js`; `ci-monitor.js` retains the schema-v2 accounting/classification implementation and legacy receipt vocabulary for recovery only. The persisted field `monitor` is a historical ledger name, not a callable retired tool. The helper never performs network access, scheduling, or sleeping. Only the owning agent calls it; Background evaluators must not write checkpoints.

Default allowance is **30 minutes cumulative monitoring wall-clock time across heads/reloads/recovery**, excluding paused diagnosis/repair. Use host timestamps, never model-estimated elapsed time. Compact receipts expose `waitRemainingMs`, `watcher`, and `lastWatcher`. Use the prepared bounds, not a stale remaining-time projection.

`action: ci` supports:

1. `operation: watch`, canonical GitHub `pr`, full `head`, nonempty `required` check-name array. A changed head needs `previousHead`; changed PR/inventory also needs `previousPr` and concrete `reconciliation`. Never change requirements to hide failures. Existing consumption survives.
2. `operation: observe`, `observation: {head, requirementsKnown, checks: [{name, state}], reference}` after a complete authoritative batch. States: `passed/pending/failed/canceled/unknown`. Resolve duplicate names/attempts first. Missing, ambiguous, canceled, inaccessible, wrong-head, or incomplete coverage never passes. Failed checks yield `repair`, not automatic diagnosis/repair authorization.
3. `operation: prepare` only after known pending CI. Records PR/head/preparation time, null host identity, `backend: background`, `timeoutMs` (remaining lifetime, capped at 24 hours), and `cycleMs` (at most 1,500,000 ms). Below 1000 ms, returns `limit` without a watcher: make one final authoritative check. Do not repeat after uncertain start.
4. Register exactly one Background polling job using `providers: ["mcp"]`, `interval_ms: 60000`, `cycle_timeout_ms: watcher.cycleMs`, `lifetime_ms: watcher.timeoutMs`, `max_wakes: 1`, and one-shot default. Discover schemas/policy first. A cycle timeout requests attention without proving CI success/failure; it does not renew the cumulative allowance.
5. `operation: attach`, exact `pr/head`, and actual host `receipt` including `id`, `createdAt`, `deadline`, `cycleMs`, `recurring: false`, `maxWakes: 1`, and `status`. Creation must be between preparation and current helper time; lifetime must fit the prepared allowance. Identical attachment is idempotent, including a job that finished during start/attachment. Retain source-independent registration evidence. If attachment rejects a real job, cancel that exact job and reconcile inactivity before recovering the intent.
6. `operation: reconcile`, exact `pr/head`, actual terminal host `receipt` with those fields plus `endedAt` and `attention`/`lastAttention`, and evidence `reference`. Active receipts reject. Background `finished` reasons map into historical ledger vocabulary: condition → condition; timeout/budget exhaustion → deadline; evaluation/coverage failure → unsafe_failure. Cancelled/invalidated retain their state. This mapping accounts time only: none certifies CI. Backend identity prevents legacy receipts from qualifying new registrations. Copy host fields, never evaluator-returned evidence.

Reconciliation charges `endedAt - createdAt`, clears the watcher, pauses timing and permits immediate fresh qualification. Duplicate identical receipts do not charge twice. `endedAt` is the first observation stop, not queued delivery, cancellation of already-pending attention, or planned deadline. Invalidated receipts lacking a terminal timestamp charge conservatively through the current helper clock. Older finished Background receipts without timing require inactivity reconciliation and `recover`, never guessed timing.

While an intent is open, only `attach/reconcile/recover` CI operations are allowed. Do not change heads or allowances around uncertain/live observers. Inspect `inFlight`, interrupted accounting, gap/failure fields, unknown effects, and handoff disposition before further action; accounting completion is not permission to replay.

- `operation: recover`, concrete `reference` proving an open registration absent/inactive when its terminal receipt cannot be recovered. Charges through current time from host creation if attached, preparation otherwise; retains an unavailable receipt. Missing current-branch receipts do not prove absence. Never use recovery to forget a possibly live observer.
- `operation: pause` only with no open intent, before diagnosis/repair/handoff. Otherwise cancel the exact job and reconcile first.
- `operation: wait` supports historical paused records without scheduling anything. Prefer prepare for new registrations. Open legacy intervals accrue through interruption and are charged before preparation.

After a timeout, freshly inspect exact-head CI. A complete pending result permits another one-shot registration within the remaining allowance; failures/coverage loss/unknown delivery require diagnosis and reconciliation, not automatic restart. At exhaustion, allow one final authoritative check; pending yields limit. An additive user override is the only budget extension.

Legacy intents lack the backend marker. They accept historical receipt attachment/reconciliation solely to settle old accounting; never register new retired observers. Preserve original receipts/history and all consumed time. See [recovery](recovery.md), [publication](publication.md), and [migration notes](../../../../docs/migrations.md).

## Integrity and recovery

Read [recovery](recovery.md) for interrupted ownership, legacy adoption, and scope changes. Schema-v1 `.pi/tickets/`, `.ticket-run/`, and cleanup archives are not automatically rewritten. Old gate/begin_pr/reopen_local/settlement wrappers are retired.

Atomic writes and a short-lived lock protect cooperative helper calls. Wrong owner/checkout/branch, another ticket owner, malformed data, or symlinked storage reject without bypass. Inspect `.writer.lock/owner.json` and prove its process absent before removing that lock alone. Never delete checkpoints to get unstuck. This is not protection against hostile filesystem mutation or arbitrary external actions.
