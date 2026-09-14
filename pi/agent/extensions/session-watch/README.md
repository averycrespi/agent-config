# Session Watch

Watch selected events from another participating Pi session on the same Unix machine and OS user, across repositories. Pending watches and widget refreshes make **zero model calls and zero conversation messages**. A match, deadline, or disconnected observation produces one bounded attention follow-up, never steering.

Both sessions must have this extension loaded. Installing configuration and loading it are separate user decisions; this extension never installs, launches, reloads, or controls another session. Use [Monitor](../monitor/README.md) for gateway conditions and [Loop](../loop/README.md) for model continuation. Session Watch does neither.

## Tool

`session_watch` supports:

- `list`: live participating targets, this session's identity, and up to 32 retained receipts. Select an exact `incarnation`, not a name, PID, session file, or persistent session UUID. Reopening the same session produces a different incarnation. Discovery is advisory: a target can disappear before registration.
- `start`: required `target` incarnation UUID, `events` (1–8 distinct names below), `timeout_ms` (1000–86400000), and `message` (1–2000 nonblank characters). Optional `name` (1–80 characters) is a caller-supplied nonsecret widget label, not an identity selector. Returns a fresh watch UUID after a bounded registration handshake, without awaiting the event. Four occupied watches per parent, including pending registrations and pending notification handoffs.
- `get`, with `id`: full bounded receipt: pinned incarnation/session UUID, label/filter, registration and deadline times, terminal reason, matching event identity/metadata, and notification disposition.
- `cancel`, with `id`: stops only that watch and suppresses its extension-owned pending handoff. It never stops the target or changes another message queue. Already Pi-queued follow-ups cannot be selectively retracted.

Invalid/action-inapplicable fields, unknown IDs, unsafe/missing targets and exhausted capacity reject without admitting a watch. Canceling the registration tool before admission prevents registration; after admission use `cancel`. There is no wildcard, name-based retargeting, resume, reconnect, script, remote endpoint, or automatic replay.

Example tool arguments, after discovering the actual target UUID with `list`:

```json
{
  "action": "start",
  "target": "11111111-2222-4333-8444-555555555555",
  "name": "api-worker",
  "events": ["ask-user:input_requested", "agent_settled"],
  "timeout_ms": 1080000,
  "message": "Inspect the receipt and report whether human attention is needed. Do not infer task completion."
}
```

## Events and meaning

| Events                                                                                                              | Forwarded metadata                                        |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `agent_start`, `agent_settled`, `session_shutdown`                                                                  | Event name only                                           |
| `ask-user:input_requested`                                                                                          | Producer-generated `requestId` UUID                       |
| `ask-user:input_resolved`                                                                                           | `requestId`, `outcome`: answered/cancelled/failed         |
| `monitor:registered`                                                                                                | Monitor UUID `id`                                         |
| `monitor:terminated`                                                                                                | `id`, terminal `state`, pending/suppressed `notification` |
| `monitor:notification`                                                                                              | `id`, handoff_unknown/handed_to_pi `notification`         |
| `loop:started`, `loop:continued`, `loop:yielded`, `loop:stopped`, `loop:resumed`, `loop:extended`, `loop:exhausted` | Loop UUID `id`, running/yielded/stopped `status`          |
| `loop:cleared`                                                                                                      | Event name only                                           |

These reuse the existing [Ask User](../ask-user/API.md), [Monitor](../monitor/API.md), and [Loop](../loop/API.md) publishers unchanged. Unsupported names are rejected, including all `session-watch:*` bookkeeping, preventing recursive watcher-event notifications by default. No poll/countdown events are emitted. Built-in UI prompt hooks are not subscribed: they are not in this repository's pinned Pi dependency API; use `ask-user:input_requested` for supported input attention.

`agent_settled` is runtime settlement, **not semantic task completion**. A session can settle while its CI Monitor is still waiting. Monitor termination is **not proof of green CI**. Input attention grants no authority to answer on the user's behalf. Graceful shutdown is best-effort; a crash need not emit it. A disconnect reports failure; a finite deadline remains the fallback for an unresponsive process.

## Registration and coverage

The target atomically installs the selected filters and captures its current event sequence, then acknowledges registration on the same ordered socket. This is the observation boundary, recorded as `startedAt`; `createdAt` is the earlier parent registration attempt. Events before that boundary are deliberately excluded, even when still semantically relevant. There is no current-state query or catch-up claim. Start may take up to the two-second handshake bound (and rejects if its requested lifetime expires during setup).

An event between target acknowledgement and completion of the parent tool call is retained by the connection's one-result promise, not dropped. Notices carry the exact incarnation, a fresh per-connection nonce, increasing event sequence, timestamp, and validated metadata. Wrong identity, stale sequence, malformed/oversized frames, disconnects, or target replacement cannot silently satisfy or resume a watch. After an acknowledged registration, lost observation ends as `failure`; it does not fabricate continuous coverage. No event log or cursor/replay service is maintained.

Deadlines count from the parent's attempt, including setup. The parent checks its deadline again on receipt, so delayed processing at/after expiry reports `deadline`, not a timely match. A paused event loop cannot meet real-time delivery guarantees. Target and parent use the same machine's wall clock; manual clock jumps are not compensated.

## Notification and lifecycle

Terminal reasons are `match`, `deadline`, `failure`, `cancelled`, and `invalidated`. A match includes only the selected event's bounded safe metadata. Notification dispositions:

- `none`: still observing.
- `pending`: the extension owns a cancelable handoff.
- `handoff_unknown`: an attempt was persisted before calling Pi; a throw or interruption does not authorize retry.
- `handed_to_pi`: the synchronous `sendMessage` call returned, **not acknowledgment of model consumption**.
- `suppressed`: cancellation or invalidation stopped an extension-owned handoff.

Each watch attempts at most one `sendMessage` with `deliverAs: "followUp"` and `triggerTurn: true`. Idle Pi wakes; active Pi queues the follow-up. Pi owns batching and consumption. Neither missing history nor an empty queue proves non-delivery.

Shutdown, reload, replacement, or reached before-tree navigation closes observations and suppresses pending handoffs before stale callbacks can wake another branch. Before-tree cleanup is conservative even if a later handler cancels navigation; it does not append while navigation is prepared. Destination history alone supplies restored receipts. Recovery invalidates active receipts, suppresses pending handoffs, and preserves unknown/handed dispositions; it never restarts anything. Inspect `list`/`get`, reconcile the target and any uncertain notification explicitly, and register a new watch only under applicable user authority.

## Widget

Each active watch has one bounded line below the editor, beside Loop/Monitor:

```text
watcher active · api-worker · ask-user:input_requested · 18m left
```

Lowercase muted `watcher`, accent activity, normal label/numbers, muted event/timing labels, and dim separators follow the shared status convention. Dynamic labels are sanitized before styling. Identity/filter detail shortens before essential timing is dropped; very narrow terminals still get exactly one width-bounded line per watch, never overflow/wrapped rows. Countdowns round up to seconds, refresh at most once per second, and clamp at zero.

The TUI mounts once and repaints in place without reordering siblings. RPC receives string-array updates; headless mode makes no UI calls. Terminal rows and the refresh timer disappear immediately, while receipts remain inspectable.

## Privacy, transport, and limits

No user-facing settings or environment overrides exist. Limits and security policy are fixed; unsupported settings cannot relax them. Unix sockets live in the canonical `/tmp/pi-session-watch-<uid>/` directory (`/private/tmp/...` on macOS), requiring a real current-user-owned mode-0700 directory and mode-0600 owned socket endpoints. Unsafe paths, symlinks and regular-file endpoints fail closed. There is no TCP listener, daemon, historical session scan, session path, cwd, or display-name discovery.

Transport notices contain only UUIDs, fixed enums, sequence and timing. Raw bus objects—including Loop instructions/reasons—are never serialized. No prompts, questions/options/answers, transcripts, scripts, tool payloads, credentials, or raw errors are selected from publishers. Caller labels/instructions are **not secret containers**; never put secrets there. The caller's follow-up instruction is held locally until termination, never sent to the target. Pi itself retains original tool arguments in ordinary session history.

This is a cooperative same-user boundary, not hostile multi-tenant authentication: another program running as the same OS user can impersonate a participant, and trusted extensions can emit on Pi's bus. Filesystem ownership and incarnation/nonce validation prevent accidental cross-user/stale routing; they do not authenticate producer semantics against a malicious same-user process.

Resource limits: four occupied outgoing watches per parent, sixteen incoming sockets per target, two-second handshake, maximum 24-hour watch lifetime, 8 KiB receive buffer, and four concurrent discovery probes over at most 128 directory entries. No retry/reconnection occurs. Process exit is not held open by watchers. Print/JSON modes still exit with Pi's ordinary lifecycle; this is not unattended service support.

`session-watch:receipt-v1` custom entries are state, not conversation messages. At most 32 receipts are held/restored, scanning at most 4096 ancestors. Restoration rejects contradictory state/notification/event combinations, noncanonical labels, and invalid temporal relationships; clock jumps can therefore make a receipt ineligible for restoration rather than relax validation. Old terminal receipts are evicted first; older history remains but can be absent from `get`. Entries are bounded, but Pi's append-only session history is not globally bounded. A persistence failure stops the engine, not an unrecorded continuation. Abrupt death can lose the last receipt update. There are no retained diagnostic logs or event-store files.

Normal server close removes its own socket. Crashes can leave stale socket files; discovery ignores failed probes but refuses an overfull directory. It never deletes stale or unrelated files. If discovery fails, inspect directory ownership/modes and stale endpoints, reconcile their process liveness, and authorize manual cleanup or a new session as appropriate. Neither cleanup nor restart is automatic.

## Verification boundary

Colocated tests exercise the actual event bus and existing Ask User/Monitor publishers in a real child process, plus registration ordering, wrong/stale identity, privacy, disconnection, deadlines, cancellation, unknown handoff, restoration, bounded UI and stable mounting. The child can settle while its Monitor remains active without implying CI success. Host fixtures assert Pi's public follow-up options, not internal queue consumption.

Live interactive Pi sessions, actual RPC clients, remote filesystems, Windows, suspend/resume and clock jumps are not qualified by those tests. Runtime/UI integration is tested with controlled contexts; no production session installation/reload is part of verification. See [DESIGN.md](DESIGN.md) and [API.md](API.md).
