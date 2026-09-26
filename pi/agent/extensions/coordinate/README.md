# Coordinate

Opt-in persistent coordination for isolated implementation workers. Loaded in all configured Pi sessions, inert when unbound. The human enables a coordinator with `/coordinate-enable`; agents retain judgment and use existing Mailbox, Monitor and Herdr. No scheduler, dashboard, report tool, forced turns or automatic acceptance exists.

## Commands and tool

```text
/coordinate-enable {"mailbox":"project-inbox","authority":"retained actual user instruction reference"}
/coordinate-disable
```

Enable is user-command-only and idempotent for the same binding; it adds no execution/publication authority. Disable refuses unresolved assignments, reports/questions/control or supervision. It never kills workers or deletes resources. Children cannot become coordinators or spawn nested workers. Unbound tool calls reject without effects and explain enable.

`coordinate` has exactly three actions:

- `status`: read-only bounded identities, launch intent, last incorporated reported disposition versus explicit accepted evidence, outstanding actions and active/inactive/unknown supervision. Full retained record is linked when output is truncated. No polling, worker prompting or observation registration.
- `spawn`: require `assignment_id`, positive `revision`, `branch`, absolute `path`, `workspace_label`, `worker_name`, self-contained Markdown `brief`, absolute child `checkpoint`, and an existing `supervision_id`. Optional `base` resolves once in the calling checkout; default is its committed HEAD. Returns exact base and whether uncommitted changes were excluded. Caller chooses names and follows repository policy. New worktree plus separate unfocused Herdr workspace only; no research mode.
- `complete`: require `assignment_id`, assignment `revision`, exact 40-character result `head`, `result_revision`, checked `evidence` and `release` references and explicit `further_writes:false`. This records the coordinator's evidence-based acceptance, not an independent truth verifier. Conflicting acceptance rejects. It never merges, stops Pi or cleans up.

Before spawning, read [role policy](ROLES.md) and the installed [Herdr skill](../../skills/herdr/SKILL.md). Ensure `/.handoffs/` already has local Git ignore coverage. Supply a complete objective, criteria, task authority/exclusions and verification/delivery bounds in the brief; no elaborate task schema is needed. A launched child explicitly loads the same trusted Coordinate and Mailbox source paths for that invocation, without installation or reload. Required source must remain available throughout launch.

## Supervision and reporting

Register the existing [recurring Mailbox recipe](../mailbox/README.md#events-and-batching) before spawn. Coordinate supports the canonical default `mailboxSupervision({mailbox}).source` with mailbox events, polling and explicit finite lifetime/wake limits; custom policy observers remain available through Mailbox but do not qualify this MVP's launch gate. Use the exact source emitted by the helper (JSON policy keys and whitespace), not a paraphrased evaluator. Permission is not authority. Record and retain the existing [cumulative allowance](../../skills/coordinate-repo/references/supervision.md); Coordinate never registers or rearms Monitor.

For mailbox `project-inbox`, the default recipe emits exactly:

```js
source: 'return await mailbox.observe("project-inbox", state, {"count":3,"ageMs":60000,"reminderMs":300000});';
```

Pair it with `providers:["mailbox"]`, the `mailbox.changed` event for that address, polling, `recurring:true`, explicit finite clocks/wakes and the recipe's persist-before-ACK message. Discover Monitor schemas and retain original allowance/receipt before using its ID in spawn.

The launch gate inspects the actual process-local Monitor receipt/source match and Mailbox availability, not a caller-supplied green claim. After preparing the worker it establishes its exact session binding and reporting identity before one task prompt. Success requires task-correlated input plus fresh execution evidence. The returned projection includes created workspace/pane/terminal IDs, submitted transcript entry, activity/sequence/status, transcript path and bounded wait disposition with the retained index reference. Process readiness and `agent_prompted` are insufficient.

Children checkpoint plus immutable artifact, then use unchanged mailbox send/list/ack. Parent follows [managed reports/questions](../../skills/spin-out/references/decisions.md), persists incorporation before ACK and uses Herdr for correlated follow-ups. ACK and settlement are never acceptance. No automatic inbox processing or report interpretation runs in the extension. An agent may retain `reported: {disposition, reference}` on the assignment through the canonical index helper; status labels this separately from verified acceptance.

## Storage and lifecycle

Records use the resolved Git common directory's untracked `pi-repo-coordination/coordinate-<session-id>.md`, through the existing atomic validated index helper. A coordinator record owns assignment/launch/acceptance facts. A child's separate record is only a role/parent/brief/checkpoint pointer, not a second execution ledger. Session custom entries retain role/pointer identity only. Restore reads external facts, never old branch snapshots. Active bindings refuse forks; another session cannot acquire the old binding by inheriting transcript entries. Tree navigation cannot rewind accepted external facts; navigation during an operation is refused.

No automatic worker creation, observation restoration, takeover/adoption, migration or allowance reset occurs. Same-user filesystem and event-bus access are cooperative boundaries, not authentication/hard fencing. Keep one coordinator process per exact session and serialize all manual index writes with tools. Do not open the same session in competing processes. Corrupt or mismatched bindings fail closed; outside Git and unbound sessions receive no reminder.

Before each model call, including tool loops and post-compaction calls, one compact request-local reminder supplies role/reference/duty/outstanding-obligation context. It replaces its own prior reminder, not the system prompt or other extensions' messages. Full briefs and skills are not repeatedly injected.

## Partial effects and recovery

Predictable source, ignore and collision failures reject during shared repository-read-only preflight before any assignment is recorded; corrected input can be submitted normally. Git checks handoff ignore coverage against the selected immutable base plus shared excludes, not just the caller checkout; private temporary ignore-check bytes are removed afterward. Tracked `.handoffs` at the base rejects. The same preflight is revalidated before effects. After admission, a race, failure or cancellation retains resources and the last durable intent/receipt. Repeating a spawn with the same assignment rejects; never mint a new ID, restart, replay an uncertain submission or roll back to evade uncertainty. Use explicit Herdr inspection/manual recovery and the canonical record. A prepared child is not necessarily unprompted after an interrupted submit: inspect exact transcript and identity. Reload restores facts only; inactive/unknown coverage must be reconciled within the original authority/allowance before further work.

The old `coordinate-repo` skill and saved `launch-worker` recipe are retired as normal entry points. [Legacy recovery](../../skills/coordinate-repo/RECOVERY.md) and its native durable helpers remain for existing runs; no automatic cutover. Standalone spin-out remains available. [Work-stack](../../skills/work-stack/SKILL.md) adds serial predecessor-aware policy, not another controller.

No user-facing configuration/environment overrides or separate diagnostic logs exist. Private briefs, raw Herdr receipts and paths stay in ignored handoffs/common-directory records and ordinary Pi history; never commit them. No automatic retention/deletion exists.

## Verification limits

Run focused Coordinate, Mailbox/Monitor and legacy launch tests plus repository lint, formatting, typecheck and full tests. Fixtures establish deterministic mechanics, not live Pi/Herdr/model behavior. Live interaction remains **unrun unless separately authorized**; do not install, Stow or reload candidate configuration as an implicit test. See [architecture](DESIGN.md) and the retained [bounded live recipe](../../skills/coordinate-repo/references/verification.md#live-validation-recipe-requires-separate-authority).
