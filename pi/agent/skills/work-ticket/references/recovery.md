# Recovery and Follow-up

Read the [checkpoint interface](helper.md). Reconcile the actual ticket, checkout/branch, pending external actions, PR head, checks, review coverage, and writer liveness before resuming. Preserve evidence, unresolved findings, consumed allowances, and an active repair's ID. Checkpoint text is not proof of user consent, process absence, or a remote effect.

## Resume or transfer

Read `status`. Continue as the recorded owner only after verifying that this is the same session/checkout. A different session uses `claim` with the previous owner, actual transfer instruction, and observed release/absence evidence. A user resume request can authorize takeover of a proven inactive predecessor; a still-live competing writer requires coordination, not an assertion that it disappeared. Explicit relocation also names the previous checkout. Preserve the old revision/scope on evidence references; a claim never makes old checks current.

For authorized follow-up, update scope/authorization/plan and next action with `checkpoint`. No `reopen_local`, terminal status, scope hash, or PR transition is required. Do not infer new implementation, publication, or cleanup authority from a historical completion or a casual resume of inspection. Reevaluate affected evidence and obtain new review only where scope, content, or applicable requirements are no longer covered. Additional budgets need explicit additive user authorization through `override`.

A malformed checkpoint or identity conflict needs diagnosis and concrete recovery, not deletion or an unrestricted bypass. For a stale helper lock, prove the recorded process absent before removing that lock alone. Preserve corrupt bytes before any explicitly authorized repair and reconstruct facts from authoritative artifacts, never fabricate passing evidence.

## Legacy adoption

The new helper does not execute schema-v1 delivery gates or mutate `.pi/tickets/<uuid>/state.json`, `.ticket-run/`, or existing cleanup archives. On `status` showing missing new state, inspect any existing legacy records and other writers before initialization. Stop old wrappers; reread the new interface.

After explicit authorized recovery, initialize a compact checkpoint using fresh scope, authority, next action, and references to retained original records/reports. Supply:

```json
{
  "recovery": {
    "instruction": "Actual instruction authorizing recovery of this delivery",
    "reference": "Retained legacy state and reconciliation artifact location",
    "reviewUsed": 2,
    "ciUsed": 0,
    "waitingMs": 0,
    "effectsReconciled": true,
    "repairs": {
      "review": {
        "batches": [
          {
            "id": "original-first",
            "plan": "Retained completed attempt reference"
          },
          {
            "id": "original-second",
            "plan": "Retained interrupted attempt reference"
          }
        ],
        "active": "original-second"
      }
    }
  }
}
```

These are observed consumed amounts, not arbitrary defaults. The helper refuses refunding the legacy review count. Legacy adoption keeps the historical two-batch repair baseline (or consumed count if greater) and 30-minute initial monitoring baseline, rather than applying the larger new-ticket defaults. Historical pre-monitor checkpoints without `initialWaitLimitMs` also keep that 30-minute baseline; existing monitor ledgers retain their own recorded limits. Account for historical extensions, pending/active repairs, CI waiting, infrastructure reruns, accepted exceptions, and all pending effects from surviving evidence. For a kind with an unfinished repair, supply `repairs.review` or `repairs.ci` with all retained `{id, plan}` batches and its original `active` ID. Batch count must equal the corresponding consumed amount; IDs must be unique and active must name one of them (or be `null`). Resume with that same ID/plan, then finish without charging again. Kinds without supplied identities retain consumed counts as completed synthetic batches; never use that fallback for an unfinished attempt. Explicitly restore any previously authorized remaining allowance with a scoped addition, rather than resetting used amounts. If old CI consumption or authorization is unknown, disclose the uncertainty and obtain an explicit bounded recovery allowance; do not invent zero consumption. Record previously accepted exceptions and their actual authority before relying on them.

Reconcile legacy pending effects before adoption. If an effect happened, retain its authoritative confirmation; if absent, retain the unresolved next action and require reread before retry. Existing bytes remain unchanged. Before removing a checkout, copy and verify legacy records and referenced artifacts into a persistent external archive as described in [settlement](settlement.md).

## Interrupted publication and CI

Reread the authoritative external surface before retrying an effect, whether or not a local pending marker survives. Confirm observed effects; retry once only after proving absence and authorization. Never duplicate a PR merely because the prior response was lost.

Read the persisted CI ledger, registration intent/Monitor ID, originating receipts and allowances before registering anything. Monitor is session-branch-bound: reload/navigation/shutdown invalidates observation without restart. Confirm PR/head and exact job identity; absence in another branch does not prove the old job inactive. Keep a matching active job rather than duplicate it. Cancel/reconcile a mismatched ticket-owned job before replacement, never unrelated jobs.

If preparation persisted but attachment did not, inspect Monitor receipts and registration evidence to determine whether start happened. Bind a proven matching registration with `ci attach`, even if already terminal, then reconcile. Retain source-independent correlation before dispatch: exact PR/source/base/head and required inventory, preparation timestamp/bounds, owner/session, and the start-attempt reference in checkpoint progress with full arguments/receipts in the persistent artifact root. After admission, bind the host-returned job ID to that attempt. Correlate an interrupted response using originating tool-call/host history and matching creation/bounds, not just a similar name, timestamp or evaluator evidence; `get` never returns source. Display name alone is not identity proof. If the receipt is unavailable, prove the originating registration absent/inactive before `ci recover`. Missing UUIDs do not permit replay. If identity/liveness remains unresolved, retain intent and stop for user reconciliation.

Reconcile known host terminal timestamps exactly. An invalidated receipt without a terminal timestamp or an unavailable registration conservatively charges its open interval through recovery. The helper computes this from persisted/host timestamps; never supply guessed elapsed amounts. A paused repair interval does not consume monitoring. After reconciliation, freshly check PR/head/requirements and resume an existing repair, assess readiness, or prepare a new watcher for still-pending CI under the remaining allowance. Old queued notifications must match the current/retained watcher identity and head before any action; already-accounted or wrong-head notifications cannot restart delivery.

Older schema-v2 records and their historical `monitor` field remain readable; no watcher backend marker means legacy accounting, not a new Monitor registration. Settle a proven legacy registration using its original receipt or concrete inactivity evidence. Never reinterpret it as Monitor success, transfer uncertain notifications, auto-resume work, or delete history/socket files. Retired controls are unavailable in new sessions: if an old observer is still live, reconcile through its originating owner under explicit live-session authority before replacement. See [migration notes](../../../../docs/migrations.md). Charge any legacy open waiting interval before preparation; paused records retain consumption. New heads, registrations and restarts never replenish allowance. Exhaustion requires an explicit additive exception; resume alone is not an extension.
