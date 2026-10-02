# Mailbox API

The direct tool and optional Script methods are documented in [README.md](README.md#script-provider). Store and delivery modules are internal; no shared host mutation API is promised.

## Read-only local inspection

`inspectMailbox(pi, mailbox)` from `api.ts` returns `{pending, sessionId, listening}` when the loaded extension is active, otherwise `undefined`. `pending` counts every unacknowledged message, including exhausted/visibility-held ones. `listening` is true only for this runtime's owned session-ID inbox with healthy delivery. Callers must match session identity and listening when qualifying readiness; arbitrary address storage is not automatic listening.

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

The extension owns session consumer ownership, fixed-window batching and bounded `mailbox-wake` messages. Eligible TUI/headless batches steer active runs at the supported boundary or start an ordinary idle run; safety holds clear through existing host readiness checks without needing settlement. RPC automatic handoff remains held because client editor state is unavailable. Known pre-call safety deferrals spend no attempt; uncertain actual handoffs remain non-replayable. Wake content names the receiving inbox outside the untrusted payload; `details.recipient` carries the same runtime session UUID. ACK targets that inbox, while replies target the runtime-attributed sender. Original message identity, runtime sender, sent timestamp, age, attempt and redelivery marker remain inside explicit untrusted framing. Directions can exercise only authority already established in the conversation, never grant or expand it. ACK after incorporation is independent of permission to execute the request. `details.count` remains the batch count. Each new handoff also carries a runtime-generated `details.wakeId` UUID used only to correlate message admission with the local `queued for agent` widget indicator. Redeliveries get a new wake ID while retaining each durable message ID. Admission changes no ACK, visibility, attempts or delivery gates; historical wakes without this field cannot clear a current indicator. New wakes also include display-only `details.display: {version: 1, count, redelivered}`: `count` is 1–20 and `redelivered` is 0–count, derived from selected messages whose attempt exceeds one. The renderer uses only validated metadata for receipt/redelivery headings; missing, malformed or unknown-version metadata yields `mailbox status unavailable`. Mixed batches retain both total and redelivery counts. This metadata is not proof of incorporation and never controls delivery, ACK or limits. Pi handoff is submission only; ACK stays an explicit operation after durable incorporation. Navigation never reconstructs external state from transcript. Already-handed messages cannot be retracted by clear or shutdown.

See [lifecycle and failure semantics](README.md#delivery-and-lifecycle), [Script provider API](../script/API.md) and [Monitor event API](../monitor/API.md). There is no observer recipe, evaluator method or migration/compatibility layer for former mailbox supervision. Existing running assignments keep their original loaded runtime/reporting contract until explicitly changed; source edits do not install or reload a live session.
