# Mailbox API

The agent-facing tool and selected Script methods are documented in [README.md](README.md#script-provider). Storage modules are internal; no shared host storage API is promised.

## Recurring supervision recipe

Trusted callers import `mailboxSupervision`, `MAILBOX_WAKE_GUIDANCE`, `DEFAULT_BATCH_POLICY` and types `BatchPolicy` / `BatchCheckpoint` from `./api.ts`. `mailboxSupervision({mailbox, policy?, instructions?, events?})` returns `providers`, `recurring: true`, `message`, `source`, and (unless `events: false`) an address-only event selection. Supply explicit authorized `name`, `interval_ms`, `cycle_timeout_ms`, `lifetime_ms`, and `max_wakes` at the Monitor boundary. The helper neither registers work nor selects budgets; it rejects invalid policy and oversized combined instructions. Extra instructions supplement, never replace, persist-before-ACK guidance.

The Script method `mailbox.observe(address, state, policy)` requires all three positional arguments. Use `null` initial state and `{}` for default policy. It returns `{decision, evidence: {mailbox, pending, fresh, oldestNewAt, reminder}, state}`. `state` is null or `{mailbox, epoch, through, notifiedAt}`; carry it verbatim between successful evaluations of the same immutable observer. Epoch/sequence are storage identities, not report IDs or authorization. No report body or ID list is exposed. This constant-size result covers all 1000 possible pending rows in one bounded read, avoiding Monitor's eight-call budget and 4096-byte state limit even when report-body pages contain only one row.

`observe` uses host time at the snapshot read, not an old queued event timestamp. It is a pure read/projection: no scheduler, ACK, storage mutation, automatic publication, persistent provider state or notification handoff. The last condition decision covers the snapshot; Monitor alone commits it on whole-evaluation success and owns attention coalescing, settlement correlation and finite budgets. Canceled/failed evaluations cannot commit progress. No notification is evidence of handling. A different storage incarnation starts fresh eligibility; an impossible same-incarnation watermark or state for another mailbox rejects. Restart is manual and never renews caller allowances.

See [policy and complete agent example](README.md#uniform-batching-policy) for defaults, ranges, explicit-field precedence, mixed-batch semantics and limitations. `send/list/ack`, existing list cursors and storage format are unchanged.

## Typed Monitor event

The `mailbox` provider registers `changed` with positional arguments `[address]` and payload `{mailbox: address}`. No message content, types, IDs, question/answer data, paths, process identities or credentials enter notifications. Subscription installs a nonpersistent filesystem watcher on the stable storage directory before returning coverage `{mailbox, startedAt, catchUp: "initial_list_and_polling"}`. Only the selected mailbox's atomic state-file replacement (or an unattributed filesystem change) emits a hint. Filesystem notifications can be duplicated, coalesced or lost; errors call `lost()` rather than reconnecting.

Pair subscriptions with polling and an initial durable list. Monitor installs subscriptions before its initial evaluator, so messages published before or during registration are read from storage; future notification loss is caught by polling. Event-only observation cannot guarantee discovery and is not the managed coordination recipe. A notification can race publication durability confirmation; list sees only complete renamed state, and acknowledgment still requires durable incorporation. Retained storage, not notification timing, owns the report.

Abort, Monitor completion/cancellation/navigation or provider disposal closes the subscription idempotently. There are no subscription timers, reconnects or model wakeups in mailbox. Monitor owns bounded deadlines and attention. No message is automatically acknowledged or deleted by subscription disposal.

## Process-local event

`pi.events` emits `mailbox:changed` with the same frozen `{mailbox}` payload after confirmed send or a nonempty ack mutation. Observer failure cannot undo storage or convert a committed send into a failed publication. This is observational and best-effort, not cross-session transport or authorization. Monitor uses filesystem hints for cross-process discovery; the bus does not forward raw session events.

```ts
const off = pi.events.on("mailbox:changed", (data) => {
  const event = data as { mailbox: string };
  // Observe the address only; obtain and verify reports through bounded list.
});
pi.on("session_shutdown", off);
```

See [Script's provider contract](../script/API.md) and [Monitor's event contract](../monitor/API.md) for allowlisting, selection, sticky failure accounting and disposal. Existing-run cutover is manual; there is no legacy state/transport adapter.
