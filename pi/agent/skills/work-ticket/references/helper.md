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

The separate `scripts/ci-monitor.js` module owns deterministic timing/classification; the checkpoint only persists its small record. Gateway access and scheduling remain with the calling session. `ci` requests use:

- `operation: watch`, canonical GitHub `pr`, full source `head`, nonempty `required` check-name array. First watch uses a 30-minute waiting allowance. A newly published head also needs `previousHead`; it retains consumption and the required inventory. Repeating watch never resets time or results. A legitimate changed PR or required-check inventory also needs `previousPr` and concrete `reconciliation` evidence (plus `previousHead`); this retains allowances and clears stale observations. Do not change the inventory merely to hide a failed requirement or accepted exception.
- `operation: pause` immediately before polling, diagnosis, repair, or a deliberate user handoff; charges the open wait and pauses its clock. Do not pause merely because a scheduled continuation or session interruption is about to wait.
- `operation: observe`, `observation: {head, requirementsKnown, checks: [{name, state}], reference}`. Normalize current gateway observations to `passed/pending/failed/canceled/unknown`. Resolve duplicate names/attempts before submitting. Missing, canceled, inaccessible, ambiguous, or wrong-head evidence never passes. A failed required check yields `repair`; it is not a diagnosis or repair authorization.
- `operation: wait` resumes a previously observed pending wait. Polls are due after 60 seconds; `nextPollAt` is returned in receipts. An open wait counts across session interruption. Polling/diagnosis/repair while paused does not consume waiting.

At exhausted waiting allowance, a final due observation may establish success; pending results yield `limit` and cannot start another automatic wait. The session stops its Loop on that result. Extending requires a scoped user override; it never changes CI evidence. See [publication](publication.md) for the complete polling/repair and stop contract.

## Recovery and boundaries

Read [recovery](recovery.md) for legacy adoption and integrity conflicts. Schema-v1 `.pi/tickets/` records and cleanup archives are never rewritten automatically. Old `gate`, `begin_pr`, `reopen_local`, and settlement actions are retired; read this interface instead of retrying old wrappers.

Atomic writes and a short-lived store lock protect cooperative helper calls. Wrong owner, wrong checkout/branch, another active ticket owner, malformed data, or symlinked storage reject. A scoped override does not bypass integrity checks. If a helper crashed, inspect `<git-common-dir>/pi-ticket-checkpoints/.writer.lock/owner.json` and prove its process absent before removing that lock alone. Never delete checkpoints to get unstuck. This is not protection against hostile filesystem mutation or an enforcement boundary for arbitrary shell/gateway actions.
