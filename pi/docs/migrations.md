# Migration notes

Guidance for older installations. For current components, see the [Pi configuration reference](../README.md). Installation, Stow linking, settings changes and running-session reloads remain explicit user actions; repository edits do not perform them.

## Scheduled tasks and Ask User retirement

The `scheduled-tasks` and `ask-user` extensions, their tools/commands, and the bundled `manage-scheduled-tasks` skill are removed. During an explicitly authorized transition, remove any explicit extension load paths and scheduler settings/environment overrides. If installed, remove only the managed `BEGIN PI SCHEDULED TASKS` / `END PI SCHEDULED TASKS` crontab block before deleting its CLI files, and reconcile active runners. Preserve task definitions, handoffs, run artifacts and session history; repository removal does not delete that data or change crontab.

Questions now use ordinary conversation: give options/recommendations when useful, identify blocked scope, and continue independent authorized work. Managed workers retain the [mailbox question protocol](../agent/skills/spin-out/references/decisions.md); unresolved questions and uncertain relays remain pending. Ask User's process-local input events and Herdr blocked signals have no replacement producer. Do not infer approval from silence or replay historical tool calls. Reload is explicit and remains user-owned. Monitor is session-bound observation/continuation, not a replacement cron scheduler.

## Background to Monitor

The former Background observation/continuation extension is now **[Monitor](../agent/extensions/monitor/README.md)**. This is a behavior-preserving rename, not an asynchronous execution service. Only `monitor` start/list/get/cancel is registered; no `background` tool alias, second scheduler, duplicated notification, or legacy provider API exists.

- Update explicit extension paths from `extensions/background` to `extensions/monitor`, tool calls to `monitor`, widget references and `/background-config` to `/monitor-config`. Import `registerMonitorProvider`, `MonitorProvider` and `MonitorEvent` from `monitor/api.ts`. Lifecycle events and the private provider query use `monitor:*`; new wake messages use `monitor-wake`.
- Rename global `extension:background` to `extension:monitor` and `BACKGROUND_MAX_CYCLE_TIMEOUT_MS` / `BACKGROUND_MAX_LIFETIME_MS` to their `MONITOR_*` equivalents. Legacy aliases remain supported with visible warnings. Complementary fields merge; overlapping old/new values must agree numerically, including when environment precedence could conceal a settings conflict. Conflicting aliases, malformed sections and unknown policy fields disable starts, not inspection/cancellation. Recognized environment values still override corresponding numeric settings. Project settings remain ignored. See the [configuration table](../agent/extensions/monitor/README.md#configuration).
- Reconcile existing observations in their originating session before an explicitly authorized installation/reload. Retain original deadlines, consumed time/wakes, pending notifications and uncertainty. Running sessions keep their loaded implementation; source edits neither install configuration, run Stow nor reload sessions. Never start both engines for the same work.
- New receipts use `monitor:receipt-v2`. Monitor alone interprets historical `background:receipt-v1` observer receipts, without rewriting them. Restoration retains identity and accounting but invalidates active work and suppresses pending attention; it never recreates timers/subscriptions/evaluators or replays messages. The unrelated retired `monitor:receipt-v1` below is not a current observer receipt. Historical `background-wake` messages remain untouched, not resubmitted or reinterpreted as new admission.
- Ticket CI uses `ci-observation.js` with new `backend: monitor` intents. Existing `backend: background` observer intents and unmarked retired ledger intents retain their identity and cumulative allowance for reconciliation only. The schema-v2 `monitor` field and `ci-monitor.js` accounting implementation remain unchanged. Shared coordinator signatures and reservations also remain unchanged; the rename grants no renewed allowance or replay authority.

The retained Background names identify **historical observations only**, not records or policy for a future Background execution service. Do not load a future service against these aliases without its own explicit migration contract.

## Legacy workflow retirement

The `.design` lifecycle and its `architect`, `specify`, `plan`, `advance-plan`, and `create-jira-ticket` skills are retired. Use [direct authorized work or Plane delivery](../../README.md#working-with-the-agent). Existing local design artifacts remain historical context: verify their claims and re-scope unfinished work; never resume removed helpers or delete artifacts to restart delivery.

## Goal extension retirement

Goal's tool and `/goal*` commands are retired. During an explicitly authorized installation transition, remove explicit Goal load paths, `extension:goal` settings and `GOAL_*` overrides. Historical snapshots remain untouched and do not restore execution. Monitor supports optional explicitly authorized bounded continuation, not mandatory execution choreography.

## Observer retirement

Loop, the original Monitor (`wait/notify`), and Session Watch are retired. These names, controls, events and receipt formats in this section describe **historical interfaces**, not callable guidance. The current Monitor above is the renamed Background observer, not that original implementation. [Monitor](../agent/extensions/monitor/README.md) is the sole supported session-bound observation/continuation primitive. Script and unrelated current tools remain supported; scheduled tasks are retired as described above.

### Inventory and mapping

| Audited surface                                                | Supported mapping / explicit incompatibility                                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Former Loop, original Monitor, and Session Watch registrations | Removed. Use current Monitor start/list/get/cancel; no imported Loop controller or legacy tool aliases.                                                                                                                         |
| Former Background `sessions` provider and transport            | Removed. Use durable mailbox reports with initial-list/polling catch-up; no session-event transport or legacy adapter remains.                                                                                                  |
| Work-ticket, CI helper and delivery references                 | One-shot Monitor polling through selected Script `mcp`, cycle ≤25 minutes, remaining lifetime and one wake. `ci-observation.js` adapts observer receipts to the retained schema-v2 ledger.                                      |
| Work-stack and shared coordination                             | Automatic session-ID Mailbox delivery in both directions, with no mailbox Monitor setup. Herdr verifies launch identity; child owns CI. Existing loaded runs retain their original reporting contract until explicitly changed. |
| Ask User and managed questions                                 | Ask User is retired. Standalone questions use conversation; managed questions use mailbox reports and conversational answers/provenance. Preserve unanswered questions and uncertain relays during manual cutover.              |
| Continuation guidance                                          | Explicit bounded recurring Monitor with post-settlement delay. Cancel before input or when no useful authorized work remains. No evaluator stop, yield/resume/extend or implicit restart.                                       |
| Documentation and runtime callers                              | Current docs, examples, skills, tests and public imports use Monitor. Personal ignored settings are not supplied or edited. Reaudit external callers and explicit load paths before transition.                                 |
| Historical records and tests                                   | Schema-v2 `monitor`, `ci-monitor.js`, and unmarked legacy watcher accounting remain recovery-only. Shared width-fitting sample labels and generic background-process prose are not extension calls.                             |

Repository-local structural tests guard registration/import/link retirement; fixtures qualify behavior, not model obedience or live installation.

### Controls, clocks and failures

- Original Monitor `wait/notify` becomes current Monitor `wait/wake`; evidence is limited to 4096 UTF-8 **bytes**, not characters. Explicit provider selection/global allowlisting replaces implicit Gateway availability. Eight calls, concurrency two and 30 seconds per evaluation remain hard ceilings tightened by Script. No repeat-safe failure budget transfers: every evaluation failure terminates. Diagnose rather than replay.
- Historical Session Watch and Background session subscriptions have no new-session counterpart. Reconcile old observers before manually adopting mailbox reporting under current authority. Preserve records and uncertain notifications without replay; mailbox changes grant attention only, never task completion or answer authority.
- Historical Loop controls are not aliases. Supply cycle timeout, total wall-clock lifetime, wake cap and delay explicitly. First delay starts at admission, subsequent delay after positively correlated awakened settlement. Lifetime includes waiting and agent work, unlike paused active-time accounting. Choose an explicitly bounded supported cadence or stop for a material semantic change.
- Cancel and reconcile before requesting input. A later fresh registration uses only remaining caller-owned allowance; it is not resume or extension. Charge uncertain handoffs conservatively. Missing usage needs bounded recovery authority, not invented zero consumption. Additions require explicit authority and never reset consumption.
- Timeout requests attention without satisfying a condition. Distinguish condition, timeout, evaluation failure, coverage loss, cancellation, invalidation, budget exhaustion and unknown handoff. Reconcile receipts plus fresh semantic/external state; notification, runtime admission and settlement are not green CI. Missing host `endedAt` is conservatively accounted, not inferred from deadlines.

### Safe installation transition

1. Inventory retired load paths, original `extension:loop`/`extension:monitor` settings and `LOOP_*`/`MONITOR_*` overrides. Original Monitor policy is not current Monitor policy: unsupported fields fail closed. Reconcile/remove retired settings under explicit authority rather than blindly copying them. Only the former Background settings have the narrow alias bridge described above.
2. Before an authorized reload/install, reconcile originating receipts, task state, cumulative allowances and pending notifications. Resolve live or uncertain observers through their originating owner before replacement. No automatic live cancellation, linking or session reload occurs here.
3. Under installation authority, remove retired paths/settings and load current Monitor. Source edits do not change already-running sessions. Only the new widget/tool/API is registered afterward.
4. Preserve `loop-state`, `loop-continuation`, original `monitor:receipt-v1`, `session-watch:receipt-v1` and tool/session history. They are not current observer receipts or replay instructions. Preserve `background:receipt-v1` for Monitor's read-only compatibility. Never copy uncertain notifications into new jobs or delete unrelated session/socket files; retired socket files are not automatically cleaned up.
5. Register fresh work only after authority, exact identity, coverage gaps and remaining allowance are reconciled. Restoration never starts execution or notifications. Missing history is not proof of non-delivery; cancellation cannot retract Pi-owned messages.

## Durable mailbox cutover

Existing-run cutover is manual. Before an explicitly authorized installation/reload, reconcile the former coordinator, active workers, old observers, pending questions/answers and uncertain Herdr submissions. Retain original records and allowances. Supply mailbox and assignment identity in new handoffs; remove old session-provider selections and parent-mode launch configuration only under applicable authority. Do not automatically convert state, reissue unanswered questions, replay prompts or introduce a compatibility layer. Local Monitor lifecycle and unrelated CI polling remain supported.

## Ticket checkpoint and CI recovery

Current ticket delivery uses Monitor polling. Existing schema-v2 ledger names and historical receipts remain readable solely for recovery/accounting; new preparations are explicitly marked `backend: monitor`. Existing `backend: background` intents remain historical observer intents and are never relabeled. Follow [work-ticket recovery](../agent/skills/work-ticket/references/recovery.md) and [helper receipt rules](../agent/skills/work-ticket/references/helper.md). Never mutate original historical bytes, refund consumed allowance or clear an uncertain registration merely to start again.
