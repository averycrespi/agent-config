# Checkpoint Helper

Run `node <absolute-skill-path>/scripts/ticket-state.js` with one JSON object on stdin. Use a quoted heredoc, never interpolate ticket prose into shell arguments. No generated Python/Node wrapper, caller CAS revision, contract hash, snapshot, or lifecycle gate is needed. Requests/results are bounded to 64 KiB. Success returns `{result: ...}`; failure returns `{error: ...}` and exits nonzero without partially updating the record.

## Common fields and storage

Supply absolute repository-root `cwd` and immutable Plane UUID `ticketId`. Mutations also need `owner`: use the current session UUID, not a shared display name. `status` needs no owner and never creates state. Records live at `<git-common-dir>/pi-ticket-checkpoints/<ticketId>.json`, outside tracked files and normally outside a removable linked checkout. A surviving checkout of the same repository can read them after linked-checkout removal. Removing the primary repository still requires an external archive.

Mutation responses contain only the saved path, next actor/action, repair counts, and compact CI disposition. `status` returns the full checkpoint or `{missing: true, legacy: <path or null>}`. Read full state after interruption, conflict, or uncertainty—not after each successful save. No user settings or retained diagnostic logs; records have owner-only permissions and remain until separately authorized deletion. They may contain user instruction excerpts and artifact paths: never include secrets or transcripts.

## Initialize and checkpoint

```json
{
  "action": "init",
  "cwd": "/absolute/repository/root",
  "ticketId": "11111111-2222-3333-4444-555555555555",
  "owner": "current-session-uuid",
  "patch": {
    "scope": "Canonical ticket reference and concise agreed scope",
    "authorization": "Actual user request and authorized local/PR boundary",
    "plan": "Reproduce; implement; verify; review",
    "next": { "actor": "agent", "action": "Reproduce the reported failure" }
  }
}
```

`checkpoint` uses the same identity fields plus a partial `patch`. Allowed fields:

| Field                                        | Contents                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `scope`, `authorization`, `plan`, `progress` | Concise nonempty text; scope changes describe actual authorization                                               |
| `blocker`                                    | Text or `null`                                                                                                   |
| `next`                                       | `{actor, action}`; always concrete                                                                               |
| `evidenceRefs`, `findingRefs`                | Arrays of concise artifact references, including covered revision/scope and outcome; appended without duplicates |
| `pr`                                         | PR reference or `null`                                                                                           |

Do not mark old evidence current merely by saving a new checkpoint. Record fixes/acceptance as new references; retain original failures. Updating scope, committing, or following up never erases evidence or repairs. These are observations for the agent to evaluate, not publication approval fields.

## Small supported operations

| Action     | Additional fields and behavior                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release`  | Relinquish checkout ownership without deleting evidence or pending effects                                                                                                                                                                                  |
| `claim`    | `previousOwner`, actual user `instruction`, fresh writer-absence/release `evidence`; `previousCheckout` when explicitly relocating. Retains evidence and all consumed allowances. Reconcile actual processes first; a stored owner is not proof of liveness |
| `repair`   | `kind: review/ci`, `operation: begin`, stable `id`, concise `plan`; consumes once before edits. Identical retries do not recharge or reopen a finished batch. `operation: finish` with the active ID ends the attempt, without certifying success           |
| `override` | `override: {id, requirement, scope, action, instruction, reference}`. Records an actual scoped user exception without changing check/review facts. Stable identical IDs are idempotent                                                                      |
| `external` | `operation: begin`, stable `id`, exact `target`, `intent` before a consequential write. `operation: confirm`, same `id`, authoritative observation `reference` clears pending intent and keeps one last receipt                                             |
| `ci`       | Monitor operations below; no network access or sleeping inside the helper                                                                                                                                                                                   |

Override allowance additions also supply `budget: review/ci/wait` and positive integer `additional` (batches for repair, milliseconds for waiting). Preserve consumed amounts. Waiting additions require an existing monitor. Scope changes, claims, pushes, and resumes do not grant new allowances.

Reconcile pending effects before beginning a different one. Reread authoritative state before retrying remote operations, even if no pending marker exists: the compact helper is not a complete remote idempotency ledger. Confirmed receipt retries are harmless; never replay the actual effect just to get a receipt. `external confirm` remains available to the recorded owner from a surviving repository checkout after release/removal.

## CI timing and observations

The separate `scripts/ci-monitor.js` module owns deterministic timing/classification; the checkpoint persists its small record. The Monitor extension owns background gateway polling; only the owning session invokes this helper. Default allowance is 30 minutes across heads/resumes, including background polls but excluding paused diagnosis/repair. Do not pass model-estimated elapsed time.

Compact mutation receipts include `waitRemainingMs` (a live, conservative projection while an interval is open), `watcher` (pending/attached registration intent), and `lastWatcher` (the latest reconciled host receipt). Raw `waitUsedMs` is reconciled consumption; use prepared `watcher.timeoutMs`, not a stale projection, for registration. Read full status only for recovery/uncertainty. `ci` requests use:

- `operation: watch`, canonical GitHub `pr`, full source `head`, nonempty `required` check-name array. First watch uses a 30-minute waiting allowance. A newly published head also needs `previousHead`; it retains consumption and the required inventory. Repeating watch never resets time or results. A legitimate changed PR or required-check inventory also needs `previousPr` and concrete `reconciliation` evidence (plus `previousHead`); this retains allowances and clears stale observations. Do not change the inventory merely to hide a failed requirement or accepted exception.
- `operation: prepare` after a complete pending observation and before `monitor start`. Records `{pr, head, preparedAt, timeoutMs, id: null, createdAt: null, deadline: null}` in `watcher`. `timeoutMs` is the remaining allowance, capped at Monitor's 24-hour registration maximum. With less than 1000 ms left, returns `limit` without a watcher; make the final authoritative check instead. Do not repeat prepare after an uncertain start—read status and reconcile the existing intent.
- `operation: attach`, exact `pr`, `head`, and `receipt: {id, createdAt, deadline}` copied from the Monitor host receipt. Binds one UUID, verifies its creation is between preparation and the helper's current clock, and rejects lifetimes exceeding the prepared allowance. Identical attachment is idempotent. Retain the registration evidence reference in the checkpoint; never put source or credentials there. If attachment rejects an actual registration, cancel that exact monitor and reconcile its absence/inactivity before recovering the open intent.
- `operation: reconcile`, exact `pr`, `head`, terminal `receipt: {id, createdAt, deadline, state, endedAt}`, and `reference` to the host receipt. Supported terminal states are `condition/deadline/failure_limit/unsafe_failure/cancelled/invalidated`. Charges `endedAt - createdAt`, retains the latest receipt with PR/head identity in `lastWatcher`, clears `watcher`, pauses timing, and clears `nextPollAt` so fresh terminal qualification need not wait 60 seconds. A restored `invalidated` receipt without `endedAt` is conservatively charged through the helper's current clock. Duplicate identical terminal receipts do not recharge; conflicting identities/timestamps reject. Reconciliation never certifies CI success.
- `operation: recover`, concrete `reference` proving the pending/attached registration absent or inactive when its terminal receipt cannot be recovered. Charges through the current helper clock, from host creation when attached or preparation otherwise; retains an `unavailable` receipt and pauses. Never use this to forget a potentially live watcher. Establish liveness in the originating session/branch first; neither missing current-branch receipts nor checkpoint text proves absence.
- `operation: pause` when no registration intent is open, before diagnosis, repair, or deliberate user handoff. With an attached watcher, cancel it by recorded ID and use `reconcile` instead. While any `watcher` intent exists, only `attach/reconcile/recover` CI operations are accepted; do not change heads, extend, or submit observations around a live/uncertain watcher.
- `operation: observe`, `observation: {head, requirementsKnown, checks: [{name, state}], reference}`. Normalize current gateway observations to `passed/pending/failed/canceled/unknown`. Resolve duplicate names/attempts before submitting. Missing, canceled, inaccessible, ambiguous, or wrong-head evidence never passes. A failed required check yields `repair`; it is not a diagnosis or repair authorization.
- `operation: wait` remains supported for older paused checkpoints; it resumes an observed pending interval without scheduling anything. Prefer `prepare` for new Monitor registrations. Without a reconciled terminal receipt, ordinary helper observations retain their 60-second due check. An open legacy wait counts through interruption and is charged before preparing a Monitor; no historical consumption is refunded.

A terminal notification only pauses and accounts for monitoring. The owning session freshly collects/validates required checks before `observe`. At exhaustion, permit one final authoritative observation; pending results yield `limit` and cannot create another watcher. Extending requires a scoped user override after reconciling any watcher; it never changes CI evidence. Setup delays and queued notifications are excluded when host timestamps establish the actual lifetime; unknown interruption intervals are charged conservatively, never guessed away. See [publication](publication.md) for the full procedure.

The helper validates supplied host receipt structure/identity but does not authenticate it or verify remote state. Copy fields from actual Monitor receipts, not observer-returned evidence; retain their references. Source code, normalization, gateway pagination and policy remain in the calling work-ticket procedure, not the generic Monitor extension.

## Recovery and boundaries

Read [recovery](recovery.md) for legacy adoption and integrity conflicts. Schema-v1 `.pi/tickets/` records and cleanup archives are never rewritten automatically. Old `gate`, `begin_pr`, `reopen_local`, and settlement actions are retired; read this interface instead of retrying old wrappers.

Atomic writes and a short-lived store lock protect cooperative helper calls. Wrong owner, wrong checkout/branch, another active ticket owner, malformed data, or symlinked storage reject. A scoped override does not bypass integrity checks. If a helper crashed, inspect `<git-common-dir>/pi-ticket-checkpoints/.writer.lock/owner.json` and prove its process absent before removing that lock alone. Never delete checkpoints to get unstuck. This is not protection against hostile filesystem mutation or an enforcement boundary for arbitrary shell/gateway actions.
