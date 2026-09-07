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

These are observed consumed amounts, not arbitrary defaults. The helper refuses refunding the legacy review count. Account for historical extensions, pending/active repairs, CI waiting, infrastructure reruns, accepted exceptions, and all pending effects from surviving evidence. For a kind with an unfinished repair, supply `repairs.review` or `repairs.ci` with all retained `{id, plan}` batches and its original `active` ID. Batch count must equal the corresponding consumed amount; IDs must be unique and active must name one of them (or be `null`). Resume with that same ID/plan, then finish without charging again. Kinds without supplied identities retain consumed counts as completed synthetic batches; never use that fallback for an unfinished attempt. Explicitly restore any previously authorized remaining allowance with a scoped addition, rather than resetting used amounts. If old CI consumption or authorization is unknown, disclose the uncertainty and obtain an explicit bounded recovery allowance; do not invent zero consumption. Record previously accepted exceptions and their actual authority before relying on them.

Reconcile legacy pending effects before adoption. If an effect happened, retain its authoritative confirmation; if absent, retain the unresolved next action and require reread before retry. Existing bytes remain unchanged. Before removing a checkout, copy and verify legacy records and referenced artifacts into a persistent external archive as described in [settlement](settlement.md).

## Interrupted publication and CI

Reread the authoritative external surface before retrying an effect, whether or not a local pending marker survives. Confirm observed effects; retry once only after proving absence and authorization. Never duplicate a PR merely because the prior response was lost.

Read persisted monitoring state and allowances before using Loop. An open waiting interval counts across interruption; a paused repair interval does not. Resume pending observation with `ci wait`, or finish the already-started repair. Reconcile current PR head before new writes. Neither new heads nor session restarts replenish budgets or configured Loop limits. An exhausted allowance requires an explicit addition and an actionable user handoff; “resume” alone is not an unlimited extension.
