# Mailbox

Durable, bidirectional messages for persistent Pi sessions. Every session loading this extension automatically listens on its **full session UUID**; no Monitor registration, Script permission or evaluator is needed. Ephemeral children remain excluded by their existing extension-loading configuration. Messages are untrusted data: runtime sender identity, receipt and ACK never grant authority.

## Delivery and lifecycle

The first eligible message opens a fixed five-second batch window. Further arrivals do not extend it. When the window expires, delivery waits for settled/idle Pi, no queued work, no editor draft and no blocking UI dialog. Held arrivals may join the same bounded batch without another delay. Mailbox never writes editor content. At most one extension-owned batch and one handed-off wake await handling. Bodies are included directly, bounded to 20 messages and approximately 16 KiB of serialized message data per wake; overflow remains readable and eligible for later batches.

Each message includes a stable ID, full runtime-attributed sender session ID, original millisecond timestamp, age and attempt number. Redelivery keeps the same identity and is explicitly marked. Five-minute visibility starts at actual synchronous Pi handoff, **not** publication, batching or time spent held. Handoff means submission, not model consumption. Messages remain inspectable during visibility. Unacknowledged messages become eligible for another fixed-window, idle-gated delivery after visibility expires.

Three attempts includes the initial delivery. At the limit, automatic delivery stops; messages remain readable and ACKable. A one-time warning accompanies the transition, and the widget retains the limit warning. New messages continue normally. There are no retry, reset-attempt, dismissal or pause commands.

Resume checks the same retained inbox; fork gets its own inbox without copying pending mail. Closed sessions retain mail but are never launched by sends. Conversation-tree navigation never rolls back external inbox state, attempts or ACKs. Reconcile older instructions against current authority and applied effects before acting again: at-least-once delivery is not exactly-once execution.

Only one consumer can own an inbox. Duplicate consumers fail closed. A synchronous handoff exception retains uncertainty and the attempted visibility interval for inspection, but suspends all automatic redelivery even after that interval expires. Reconcile prior application and ACK only after durable incorporation; there is no retry/reset API. A crash or storage failure between the durable handoff intent and confirmation leaves an uncertain intent without a deadline; inspect it rather than replaying automatically. An exhausted or uncertain message can be ACKed after durable incorporation, or removed through the human clear command below.

TUI delivery checks the visible draft and dialog hooks; headless sessions use runtime idleness. RPC cannot verify client drafts, so automatic handoff is held there; inspect/list/ACK remain available. Deterministic fixtures do not establish live editor behavior or model compliance. Installation, configuration linking and running-session reload need separate authorization.

## Tool

```js
mailbox({
  action: "send",
  mailbox: "recipient-full-session-uuid",
  type: "question",
  message: "Question with checkpoint and evidence reference",
});
mailbox({ action: "list", mailbox: "recipient-full-session-uuid", limit: 20 });
mailbox({
  action: "ack",
  mailbox: "recipient-full-session-uuid",
  ids: ["runtime-message-uuid"],
});
```

The tool accepts send/list/ack only. Sender identity is supplied by the active runtime, never tool arguments or message prose. Arbitrary valid local addresses remain usable as retained storage, but only the owning session-ID inbox is automatically listened to. Addresses are storage names, not authorization boundaries.

First send creates the inbox. Messages allow 8192 UTF-8 bytes and 8500 serialized payload bytes. Addresses allow 1–80 ASCII alphanumeric/underscore/hyphen characters, beginning alphanumeric; types use the same alphabet with a 48-character limit. Each inbox holds at most 1000 unacknowledged messages or 4 MiB serialized state. Nothing silently expires or is evicted; a full inbox rejects new sends.

List returns `{mailbox, messages, nextCursor, pending, oldestAt}`. Messages also expose `sender`, `attempts`, `visibleUntil`, `uncertain` and `warned`. Pages contain at most 1–50 messages (default 20) and 16 KiB serialized message data. Use `next_cursor` for subsequent direct-tool pages. Cursors pin an incarnation/high-water mark: ACKs can remove rows, but concurrent later sends require a fresh scan after cursor exhaustion. Total pending is the current inbox count, not the next batch. Listing an absent inbox does not create it.

ACK permanently removes incorporated IDs and frees capacity; repeated/unknown valid UUIDs are no-ops. Duplicate IDs in one request reject. **ACK after durable incorporation, not task completion.** Preserve unresolved obligations in TODO when useful, then ACK promptly even if a human answer is pending. Do not repeat effects on redelivery without reconciling prior application. Managed children checkpoint before consequential reports; both directions preserve exact assignment, identity, evidence and approval provenance.

## Commands and widget

`/mailbox` is noninteractive, read-only status: IDs, senders, ages, attempt counts and delivery state, never message bodies. `/mailbox-config` displays effective configuration.

Human-only `/mailbox-clear` atomically removes the current inbox's messages, attempts, visibility deadlines and extension-owned pending batch. Sends committed after clear survive, and listening continues. It reports the removed count and that **already-handed Pi messages cannot be retracted**. Clear is not ACK, task acceptance or completion; it does not touch TODO, Coordinate or Background. No tool or Script equivalent exists.

One below-editor line uses muted `mailbox`, immediately followed by exactly one state: accent `listening`, warning `pending`, or error `unavailable`. Counts are normal text, metadata muted, separators dim. Limit/uncertainty sections are independently warning-colored and preserved before optional timing at narrow widths. No bodies, sender labels or unsafe strings enter the widget.

```text
mailbox listening · empty
mailbox pending · 3 unacked · wake in 4s
mailbox pending · 3 unacked · awaiting idle
mailbox pending · 3 unacked · held: draft
mailbox pending · 3 unacked · held: dialog
mailbox pending · 3 unacked · redelivery in 4m
mailbox pending · delivery limit reached · 2 unacked
mailbox pending · 2 at limit · 5 unacked · wake in 3s
mailbox unavailable · /mailbox
```

The widget mounts once and refreshes no faster than once a second for countdowns. Automatic wake rendering is a compact untrusted notification; expansion shows bounded sanitized content without changing model context or ACK state. Tool rows retain compact send/list/ack outcomes and bounded expanded previews. Persistence is not consumption, and scan completion is not inbox emptiness.

## Configuration

Global and project `extension:mailbox` settings merge over defaults; environment values take precedence. Invalid values/settings disable listening instead of silently relaxing limits. Reload is explicit, not automatic.

| Field                 | Default  | Environment override               | Description                                     |
| --------------------- | -------- | ---------------------------------- | ----------------------------------------------- |
| `batchWindowMs`       | `5000`   | `PI_MAILBOX_BATCH_WINDOW_MS`       | Integer 0–86400000; zero removes batching delay |
| `visibilityTimeoutMs` | `300000` | `PI_MAILBOX_VISIBILITY_TIMEOUT_MS` | Integer 1000–86400000, measured from handoff    |
| `maxDeliveryAttempts` | `3`      | `PI_MAILBOX_MAX_DELIVERY_ATTEMPTS` | Integer 1–100, including initial delivery       |

```json
{
  "extension:mailbox": {
    "batchWindowMs": 5000,
    "visibilityTimeoutMs": 300000,
    "maxDeliveryAttempts": 3
  }
}
```

## Storage and failures

Private local state is at `<Pi agent directory>/mailboxes/`, normally `~/.pi/agent/mailboxes/`. The root is current-user-owned mode 0700; files are mode 0600. Cooperative cross-process writer locks serialize mutations without retry. Atomic rename and file/directory fsync require a local filesystem; hostile same-user mutation and network filesystems are unsupported. The consumer lock is separate from short writer transactions.

`invalid_input` changes no state; `mailbox_full` rejects publication. `storage_failed` means success could not be established, including contention, unsafe paths and corruption. `publication_unknown` means a rename may have committed without durability/cleanup confirmation. Never resend automatically after timeout, cancellation or uncertainty: reconcile retained inbox and source evidence first.

Crashes can retain `<address>.lock/owner.json`, `<session>.consumer/owner.json` or staging files. Inspect PID/process identity and retained state before separately authorized manual lock removal. No lock is automatically broken. No migration/compatibility layer, archival daemon, root quota or automatic cleanup exists. ACK is not secure erasure; Pi history can retain bodies. Do not send secrets. No separate logs or spills are written.

## Script provider

### Availability

Loaded Mailbox registers optional `mailbox` methods through the Script/Monitor provider API. Script use requires global allowlisting and explicit per-execution selection, neither of which grants action authority. Ordinary automatic delivery does not use this provider or require Script permission.

### Methods

| Signature                                  | Result                                  |
| ------------------------------------------ | --------------------------------------- |
| `mailbox.send(address, type, message)`     | Runtime-attributed persisted message    |
| `mailbox.list({mailbox, limit?, cursor?})` | Same bounded page as the tool           |
| `mailbox.ack(address, ids)`                | `{mailbox, acknowledged}` removed count |

### Example

```js
script({
  action: "describe",
  description: "Inspect mailbox methods",
  providers: ["mailbox"],
});
script({
  action: "run",
  description: "Read session messages",
  providers: ["mailbox"],
  source:
    'return await mailbox.list({mailbox: "recipient-full-session-uuid"});',
});
```

### Permissions and effects

Send/ack mutate local storage; list reads it. No network or credentials are used. Script permission and sender identity do not grant authority. Nested calls emit no synthetic tool hooks. Monitor evaluators must not ACK or mutate mailboxes. Background retains its separate execution records, notifications, consumption and dismissal; Mailbox never merges those lifecycles.

### Failure and lifecycle

Declared failures preserve sticky Script host accounting. `publication_unknown` sets `outcomeUnknown`. Cancellation is checked before bounded synchronous work and cannot undo committed effects. Shutdown closes listeners/providers, not retained messages. There is no automatic resend or provider reconnect. See [API.md](API.md) for address-only change hints and read-only readiness, and [DESIGN.md](DESIGN.md) for delivery transactions.
