# Mailbox

Durable local reports for coordinated Pi workers. A mailbox address identifies storage, **not authority or an authenticated sender**. Workers checkpoint before reporting; coordinators incorporate reports durably before acknowledging them. Questions and results are conventions in the [shared coordination protocol](../../skills/spin-out/references/decisions.md), not mailbox task states.

## Tool

```js
mailbox({
  action: "send",
  mailbox: "project-alpha",
  type: "result",
  message: "Checkpoint and evidence: /retained/result.json",
});
mailbox({ action: "list", mailbox: "project-alpha", limit: 20 });
mailbox({
  action: "ack",
  mailbox: "project-alpha",
  ids: ["runtime-message-uuid"],
});
```

The first send creates the mailbox. Runtime-generated IDs and millisecond timestamps accompany caller-supplied type/message strings. Addresses use 1–80 ASCII alphanumeric, underscore or hyphen characters, beginning alphanumeric; types use the same alphabet with a 48-character limit.

Messages are limited to 8192 UTF-8 bytes and 8500 serialized payload bytes. Each mailbox holds at most 1000 unacknowledged messages or 4 MiB of serialized state. Full mailboxes reject new sends; unacknowledged messages **never expire or get evicted**. Ack permanently removes matching pending messages and frees capacity. Repeated/unknown valid UUIDs are no-ops; duplicate IDs in one request reject. Ack means incorporated, not answered, accepted or completed.

List returns `{mailbox, messages, nextCursor, pending, oldestAt}`. Supply `next_cursor` to the direct tool for subsequent pages. Pages contain at most the requested 1–50 messages (default 20) and 16 KiB serialized message data. The cursor captures an incarnation and sequence high-water mark: concurrent sends do not enter that scan, and concurrent acknowledgments can remove rows without shifting positions. Start a fresh scan after the final page to discover later arrivals. Counts describe the current inbox, not the cursor snapshot. Listing an absent mailbox does not create it.

## Tool display

The TUI shows a stable `mailbox <action> <address>` header and a compact result:
`Sent result`, `3 shown | 7 pending | more pages`, or `Acknowledged 3 messages`.
Sending, listing and acknowledging use warning styling while in flight; settled
operations use success styling, and failures or uncertain publication use error styling.
Sent means persisted, not consumed, accepted or completed. Ack is not task resolution.

Expand results for full message IDs, UTC timestamps, and explicitly untrusted message
previews (up to 1200 characters for send, 240 per listed message). Controls and line
breaks are sanitized before styling; longer previews are marked `[truncated]`.
Rows truncate rather than wrap at narrow widths. Full content remains in the unchanged
model-facing untrusted result envelope; report JSON is never interpreted as UI state.

List summaries distinguish this page's shown count from the current inbox's pending
count. `scan complete` does not imply the inbox is empty: later arrivals require a fresh
scan. Opaque cursors are not displayed. Expanded acknowledgments show requested IDs
and acknowledged/requested counts, never which IDs were removed (storage returns only
a count). `No messages acknowledged` is a successful no-op, not a resolved task.
Diagnostics are bounded and only shown expanded; uncertain publication calls for
reconciliation before resending, never automatic replay. Renderer fixtures do not
qualify a live TUI session.

## Storage and failures

Storage is local and untracked at `<Pi agent directory>/mailboxes/` (normally `~/.pi/agent/mailboxes/`). The root must be a real current-user-owned mode-0700 directory; state files are mode 0600. Each mailbox has an atomic JSON state file. Cooperative cross-process exclusive lock directories serialize writes without retry. Temporary bytes are fsynced before rename and the containing directory is fsynced before success. Local filesystems with atomic same-directory rename/fsync are required; network filesystems and hostile same-user mutation are not supported.

`invalid_input` changes no mailbox state. `mailbox_full` rejects publication. `storage_failed` means the operation could not establish a successful mutation (including contention, unsafe paths or corrupt storage). `publication_unknown` means rename may have committed but durability/cleanup confirmation failed. Never automatically resend after timeout, cancellation, process exit or an uncertain result. Retain a stable report identity in the child checkpoint and reconcile the inbox/project record first; runtime message IDs are not caller idempotency keys.

A crash can retain `<address>.lock/owner.json` and staging files. Inspect the recorded PID, actual process identity and retained state before any separately authorized manual removal; never automatically break locks or overwrite corrupt data. There is no expiry, total-root quota, archival daemon or automatic cleanup. Mailbox count and retained disk usage need operator management; acknowledged bytes are not a secure-erasure guarantee. Ordinary Pi history still retains tool arguments/results. Do not send secrets. No separate diagnostic logs or spills are written. There are no user-facing settings or routing environment variables; Pi's standard agent-directory selection determines the shared storage root.

## Script provider

### Availability

The loaded mailbox extension registers `mailbox` through the supported Script/Monitor API. Require it in Script's global `allowedProviders` and explicitly select it per execution. Registration, permission and selection are not user approval. No installation or live reload is implied.

### Methods

| Signature                                  | Result                                        |
| ------------------------------------------ | --------------------------------------------- |
| `mailbox.send(address, type, message)`     | Persisted `{id, at, type, message}`           |
| `mailbox.list({mailbox, limit?, cursor?})` | Same page envelope as the direct tool         |
| `mailbox.ack(address, ids)`                | `{mailbox, acknowledged}` newly removed count |

### Example

```js
script({
  action: "describe",
  description: "Inspect mailbox methods",
  providers: ["mailbox"],
});
script({
  action: "run",
  description: "Read project reports",
  providers: ["mailbox"],
  source: 'return await mailbox.list({mailbox: "project-alpha"});',
});
```

### Permissions and effects

Send/ack mutate local storage; list reads it. Subscription can create the empty storage root and open a filesystem watcher. No network, credentials, role gating or environment routing exists. Message content is untrusted data; inspect identity and authority independently. Script's host allowlist remains authoritative; nested calls emit no synthetic Pi tool hooks. Monitor evaluators must remain read-only and never acknowledge.

### Failure and lifecycle

Declared failure codes preserve Script's sticky host accounting; catching a failure in guest code does not make it pass. An uncertain publication sets `outcomeUnknown`. Methods check cancellation before synchronous bounded storage work; cancellation cannot undo committed effects. Shutdown disposes provider selections/watchers, not messages. Restart or coordinator absence does not discard the inbox. There are no retries, reconnects or replays.

## Events and batching

See [API.md](API.md) for minimal `mailbox.changed` and process-local `mailbox:changed` contracts. Notifications are hints, not retained messages. Subscribe before initial listing and combine events with bounded polling to survive missing notifications and registration gaps. Monitor is the **only scheduler**.

Illustrative one-shot policy: wake at three pending messages or when a nonempty batch is 60 seconds old. Discover schemas first and reduce bounds to the existing coordinator deadline/remaining wake allowance:

```js
monitor({
  action: "start",
  name: "project reports",
  message:
    "Reconcile receipt, drain reports, persist changed coordination state, then ack incorporated IDs. Do not resume unanswered work.",
  providers: ["mailbox"],
  events: [{ provider: "mailbox", event: "changed", args: ["project-alpha"] }],
  interval_ms: 30000,
  cycle_timeout_ms: 600000,
  lifetime_ms: 900000,
  max_wakes: 1,
  source: `const p = await mailbox.list({mailbox: "project-alpha", limit: 1});
    const ready = p.pending >= 3 || (p.pending > 0 && trigger.at - p.oldestAt >= 60000);
    return {decision: ready ? "wake" : "wait", evidence: {pending: p.pending, oldestAt: p.oldestAt}};`,
});
```

Empty inboxes never meet batch age. Monitor's independent timeout still requests attention; it is not a report or failure. After processing/ack, reconcile the sole owned observer and re-register one-shot within retained allowances. Do not register repeatedly for a still-outstanding batch. Questions already incorporated stay in the project record, not the inbox.

Monitor holds TUI attention while a visible draft is nonempty and never writes editor text. RPC cannot verify drafts and queues for the next human turn. See [Monitor delivery qualification](../monitor/README.md#clocks-queues-and-attention). Fixtures do not prove actual editor behavior or model compliance. The [bounded live recipe](../../skills/coordinate-repo/references/verification.md#live-validation-recipe-requires-separate-authority) is unrun unless separately authorized.
