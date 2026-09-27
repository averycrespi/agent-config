# Mailbox API

The direct tool and optional Script methods are documented in [README.md](README.md#script-provider). Store and delivery modules are internal; no shared host mutation API is promised.

## Read-only local inspection

`inspectMailbox(pi, mailbox)` from `api.ts` returns `{pending, sessionId, listening}` when the loaded extension is active, otherwise `undefined`. `pending` counts every unacknowledged message, including exhausted/visibility-held ones. `listening` is true only for this runtime's owned session-ID inbox with healthy delivery. Coordinate requires matching session identity and listening before launch; arbitrary address storage is not automatic listening.

The private `mailbox:inspect-v1` query validates the address and returns no bodies. Inspection never sends, ACKs, creates storage or starts observation. Storage errors propagate; absence means unavailable, not an empty inbox. This same-process seam is not an authorization boundary.

## Change hints

The optional `mailbox` provider registers typed `changed`, positional arguments `[address]`, payload `{mailbox: address}`. Subscription opens a nonpersistent filesystem watcher on the stable storage root and returns coverage `{mailbox, startedAt, catchUp: "initial_list_and_polling"}`. Atomic file replacement or an unattributed filesystem change emits an address-only hint; errors call `lost()`. Notifications may be coalesced, duplicated or lost, so read retained storage for truth. Abort/disposal closes subscriptions idempotently. No bodies, sender IDs, types, paths or credentials enter event payloads.

Process-local `mailbox:changed` emits the same frozen address-only payload after confirmed send, nonempty ACK, or human clear. Observer failure cannot undo committed storage. These events remain available for unrelated authorized read-only observations; automatic session delivery owns its own listener and catch-up ticker, requiring no Script selection or Monitor job.

```ts
const off = pi.events.on("mailbox:changed", (data) => {
  const event = data as { mailbox: string };
  // Address-only hint; inspect retained state before relying on it.
});
pi.on("session_shutdown", off);
```

## Automatic delivery

The extension owns session consumer ownership, fixed-window batching and bounded `mailbox-wake` messages. Wake content includes original message identity, runtime sender, sent timestamp, age, attempt and redelivery marker, inside explicit untrusted framing. `details.count` is display metadata, not proof of incorporation. Pi handoff is submission only; ACK stays an explicit operation after durable incorporation. Navigation never reconstructs external state from transcript. Already-handed messages cannot be retracted by clear or shutdown.

See [lifecycle and failure semantics](README.md#delivery-and-lifecycle), [Script provider API](../script/API.md) and [Monitor event API](../monitor/API.md). There is no observer recipe, evaluator method or migration/compatibility layer for former mailbox supervision. Existing running assignments keep their original loaded runtime/reporting contract until explicitly changed; source edits do not install or reload a live session.
