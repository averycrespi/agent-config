---
name: supervise
description: Use when the user asks to supervise, babysit, periodically check progress, or keep workers or ongoing work on track, or when an authorized workflow explicitly includes supervision. Do not activate merely because a task is long-running or a background tool is awaiting completion.
---

# Supervise

Keep authorized work progressing without taking over its execution. Use existing [Monitor](../../extensions/monitor/README.md) observation and [Mailbox reporting](../spawn-agent/references/decisions.md), not a new ledger, role, process or recovery service. A milestone, idle worker or elapsed timer is not task completion.

## Establish the supervision envelope

Treat an explicit request to supervise as authorization for the defaults below unless the user overrides them. An authorized workflow may explicitly include this same envelope, as [work-stack](../work-stack/SKILL.md) does. Announce the selected bounds and proceed without asking the user to repeat timer parameters. Merely loading a skill, launching a worker or receiving a worker message does not authorize supervision. Preserve narrower instructions and existing runs' original bounds; new defaults do not extend historical authority.

| Bound          | Default                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| Wake delay     | 20 minutes after the supervising turn settles; first delay starts on registration |
| Cycle timeout  | 25 minutes                                                                        |
| Total lifetime | 12 hours from initial registration, including work and settlement waits           |
| Wake cap       | 36 cumulative handoff attempts                                                    |

Identify the objective, existing owner/session, readable progress evidence, completion boundary and permitted interventions from the request and existing assignment. Ask only about consequential ambiguity in those facts. For worker supervision, use one coordinator-owned watchdog for the supervised set, separate from child-owned execution/CI observers. Keep the objective, authority reference, original absolute deadline, consumed wakes, Monitor ID and unresolved next action in existing TODOs/conversation or a checkpoint. Link child evidence rather than copying it; create no supervision registry or parallel execution ledger.

Permit progress inspection, in-scope resource coordination and a scoped prompt to resume already-authorized work. Do not expand scope, grant permissions, renew child budgets, launch replacement workers, restart processes, replay uncertain operations, publish or clean up merely because supervision was requested. Retain the task's existing approval and ownership boundaries.

## Choose the smallest observation mechanism

- **Workers can silently stop:** use a recurring settlement-based coordinator wake. Interpret worker progress on each wake; do not duplicate their tests, reviews or CI polling.
- **A process or external job exposes a deterministic condition:** use a bounded Monitor evaluator or typed event, waking for completion, failure or deadline rather than recurring model status checks. Observe only under the existing provider/action authority and task allowance; the 12-hour default is a ceiling, not permission to extend that task.
- **A background tool already supplies completion notification:** rely on that notification. Do not add a competing completion observer. A coordinator watchdog may still cover the separate risk that its persistent workers stop before finishing their assignments.

Read Monitor's current contract and discover permitted schemas with `monitor list` and `script describe` before selecting providers/events. Inspect historical receipts and retained registration attempts before starting. Reuse a matching active watchdog; reconcile and, when appropriate, cancel an obsolete one before replacement. If identity, registration or handoff is uncertain, preserve it and investigate rather than registering a duplicate.

For a new worker-supervision envelope with the defaults, use this timer-only shape, tailoring the message to the actual objective and evidence references:

```json
{
  "action": "start",
  "name": "Worker progress supervision",
  "message": "Reconcile this receipt and existing task notes. Inspect worker progress, blockers, ownership and next actions. Resume only unjustified stops within existing authority after checking prior continuation delivery. Resolve contention without taking over execution. Preserve original supervision and child allowances; cancel when finished or no useful authorized supervision remains.",
  "providers": [],
  "recurring": true,
  "delay_ms": 1200000,
  "cycle_timeout_ms": 1500000,
  "lifetime_ms": 43200000,
  "max_wakes": 36
}
```

Confirm admission and retain the returned ID and host deadline before claiming coverage. Missing tools, denied admission or incompatible host policy require a precise coverage-gap report, not installation, reload, policy changes or a shell polling fallback. Continue independent authorized work. These wakes are not strict wall-clock appointments: later delays begin after correlated settlement, delivery can be deferred, and cycle timeout alone does not prove a worker stalled.

## Reconcile each wake

1. Inspect the exact receipt and remaining original allowance. Reconcile reports/checkpoints and current worker identity/activity; use recent task-specific evidence, not idle status or silence alone. Read only enough original evidence to resolve the next decision.
2. Classify each worker as **progressing**, **legitimately waiting**, **blocked**, or **idle with actionable work**. A live review/test/CI observer or unresolved ownership boundary is a legitimate dependency; a completed prerequisite with `next=self` and no blocker is not a stopping boundary.
3. For idle actionable work, verify that no operation or prior continuation is active, queued, unincorporated or uncertain. Send one scoped Mailbox continuation under the existing assignment, naming the unfinished objective and next action. Do not resend the initial assignment, duplicate execution or treat missing acknowledgment as permission to repeat an instruction. Reconcile the same message's delivery and application before any further intervention.
4. Resolve actual resource contention within existing authority; leave command selection, checks, repairs and evidence with the owner. Record/escalate genuine blockers without creating per-command approval gates. For unknown activity, investigate or report uncertainty rather than declaring a stall or forcing a restart.
5. Update only changed control facts and unresolved obligations, then ACK incorporated messages. Resume the coordinator's own available work, or yield at a real dependency. Keep the watchdog active while useful authorized coverage remains; routine healthy checks need no verbose status report.

A release, milestone or housekeeping message does not replace the ongoing objective. Accept completion only against the task's exact evidence and ownership-release requirements, not a child's stop or the watchdog's successful wake.

## End, recover or exhaust coverage

Cancel and reconcile the watchdog when the objective finishes or no useful authorized supervision remains. Before requesting user input, cancel continuation for the affected input-blocked work. Independently authorized shared read-only observation may continue under the [nonblocking question contract](../spawn-agent/references/decisions.md#incorporation-and-questions); never poll approval or resume blocked writes.

At the final available wake, surface unfinished work and the impending coverage gap; stop at the retained limits rather than promising continued attention. Monitor's final wake-cap exhaustion may not emit an extra notification. Request additional allowance only when needed, with consumed bounds and the unfinished objective; never automatically renew. Expiry is not completion and does not erase available work in the current authorized turn.

After interruption or an input-blocked cancellation, reconcile the original registration, receipts and any Pi-owned queued wake before a replacement. Preserve the original absolute deadline and cumulative wake count, conservatively charging attempted/unknown handoffs. Bound a replacement by remaining time and wakes, never a fresh 12 hours or 36 wakes; do not start when either is exhausted or unresolved. New task labels or successor children do not reset the envelope. Explicit user extensions are additions with provenance, not refunds.

Monitor is session-bound: reload, navigation and shutdown invalidate observations; restored receipts do not restart work. Disclose coverage loss and resume only within reconciled existing authority. Do not install, link, reload or add an external watchdog as recovery.

## Verification

Run skill discovery/link and structural checks and inspect the [supervision scenarios](references/verification.md). These qualify written contracts, not model obedience or live timer delivery. Live exercises require separate explicit authority; retain their prompts, results and untested boundaries outside tracked source.
