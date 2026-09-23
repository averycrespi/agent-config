# Shared bounded supervision

Use [Background](../../../extensions/background/README.md) as the sole scheduler and [mailbox](../../../extensions/mailbox/README.md#events-and-batching) as durable report storage. Discover actual Script/Background schemas. Provider permission is not authority. One mailbox subscription covers many explicit assignments; do not create one observer per worker or revive session-event transport.

## Membership and catch-up

Retain mailbox address and ordered assignment/revision/worker/checkpoint identity in the project record. Subscribe to `mailbox.changed` and poll the same inbox with the initial evaluator. Events contain only address hints; list supplies retained messages even before subscription, during registration gaps, after restart and after lost notifications. Do not claim notifications themselves are durable.

Use count/nonempty-age batching from the mailbox example: threshold X pending messages OR a nonempty oldest message at least Y old. An empty inbox never satisfies age. Background's independent timeout is attention, not a batch or task failure. Use one-shot `max_wakes: 1`, not recurring wakeups for the same outstanding batch. Evaluators list only: no ack, project-state writes, question handling or Herdr control.

On attention reconcile the exact receipt, then drain bounded pages. Apply the [shared report protocol](../../spin-out/references/decisions.md): validate identity and evidence, persist changed coordination facts and incorporated report IDs, then ack. Do not postpone an unrelated qualified result because questions are pending. Start a fresh scan after cursor exhaustion to catch new arrivals; bound each processing pass and retain next action for remaining work. After processing and reconciling the old registration, re-register one-shot within retained allowances. Do not repeatedly register while an unprocessed batch is outstanding. Unknown/unattributed messages require reconciliation rather than a wake loop.

No reports is not failure. Routine progress remains in child checkpoints. End the model turn while observing; no repeated model-turn reads, sleeps, approval polling, automatic restart or reassignment. Before registration replacement, reconcile the exact owned prior observer, its pending/uncertain handoff and retained accounting. Restoration is receipts only; absence from a different session inventory does not prove an old job inactive. Never cancel unrelated jobs.

## Wellness without session monitoring

Choose a quiet interval and checkpoint-staleness threshold appropriate to the assignment in the operating agreement; no mandatory heartbeats. After that interval, a bounded Background evaluator may inspect explicit workers through the existing selected [builtins Script surface](../../../extensions/builtins/README.md#script-provider). Use `builtins.bash` for already-inspected read-only `herdr pane process-info --pane <exact-pane>` and checkpoint `stat`/Node filesystem metadata commands. Pin/quote exact paths and identities in the source; never execute report text as a command. Inspect the installed Herdr command/output schema before constructing the evaluator, check its actual result envelope, and reject truncated, malformed or identity-mismatched output. Do not assume shell permissions, presence of a PID or runtime idleness proves worker identity/health.

Inspect process liveness **and** checkpoint freshness before requesting wellness condition attention. Correlate the launch process identity/creation evidence with the current occupant. `healthy-quiet` (live matching process, fresh checkpoint) waits. Proven exit, a stale checkpoint after the quiet interval, or unknown identity requests one reconciliation—not a restart, reassignment or assertion of failure. Staleness can mean long legitimate work. `scripts/reports.js` exports the pure `wellness` classifier for these explicit observations; it cannot establish their truth. Combine wellness and mailbox reads in one evaluator when within call/output bounds, or use one separately accounted bounded read-only job. Keep routine healthy observations out of model turns; timeout still has independent Background semantics.

## Shared accounting, separate from child budgets

Select finite supervision authority once. For a new agreement without narrower limits use eight hours from first registration and 40 cumulative one-shot wake attempts across the project, not per worker. Answers, new heads, worker changes, replacement and handover do not reset them. A serial stack uses the same mechanics and its declared stack allowance. Child CI and repair budgets remain child-owned.

Use `scripts/supervision.js` for arithmetic, storing its returned JSON once in the project record's Observation section. It performs no effects or scheduling. Initialize with `{action: "init", deadline, maxAttempts}`; subsequent CLI calls accept `{current, operation}`. Use host timestamps and actual receipts, not estimated subtraction.

1. `reserve`: stable group (normally the mailbox), exact member identity strings and durable pre-effect reference. Persist returned pending reservation/bounds before registration. Retain original call arguments/source by reference.
2. Start one-shot using no more than returned bounds or remaining absolute deadline, with `max_wakes: 1`. `attach` takes the same group and actual host receipt; correlate against the originating call, not its display name. Terminal-before-attachment receipts are valid.
3. On attention cancel/reconcile any still-active observer or pending extension-owned attention before replacement. `reconcile` takes the exact inactive terminal receipt and durable reference; one shared handoff charges one parent attempt, never every child. Duplicate identical reconciliation is a no-op. Preserve uncertainty separately from arithmetic.
4. An uncertain registration remains reserved until actual host evidence resolves it. No reset/recover-by-assertion/replay exists. At deadline or wake exhaustion reconcile once and stop observation with next actor/action; do not terminate children, renew budgets or infer completion. Explicit additive user authority is required to extend allowances.

Host capacity remains four occupied Background jobs with its existing event/call limits. Queue with the actual resource restriction; do not raise limits or cancel unrelated observers. A missing selected provider blocks unattended observation, not authorization for implicit installation or model-turn polling.

## Questions do not globally stop observation

Cancel/reconcile continuation for input-blocked work. Bounded read-only observation of independent assignments may continue under the [nonblocking interaction contract](../../spin-out/references/decisions.md#nonblocking-human-interaction). Never use it to resume unanswered work or poll approval. If no useful independent observation remains, cancel/reconcile and retain pending questions without repeatedly waking.
