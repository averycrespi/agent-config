# Mailbox API

The agent-facing tool and selected Script methods are documented in [README.md](README.md#script-provider). Storage modules are internal; no shared host storage API is promised.

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
