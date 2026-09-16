# Session Watch events

`api.ts` exports `WatchEvent` for ordinary in-process `pi.events` listeners. All events contain only `{ type, id, state, notification }`: a producer-generated watch UUID and fixed dispositions. No labels, targets, filters, caller instructions, event evidence, tool data or raw errors are emitted.

| Event                        | Timing                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `session-watch:registered`   | After target acknowledgement and parent admission, before receipt persistence and scheduling                  |
| `session-watch:terminated`   | After closing observation or suppressing a pending handoff, before receipt persistence                        |
| `session-watch:notification` | `handoff_unknown` after persisting the attempt and before calling Pi; `handed_to_pi` after synchronous return |

`state` is active/match/deadline/failure/cancelled/invalidated. `notification` is none/pending/handoff_unknown/handed_to_pi/suppressed. Cancellation or lifecycle invalidation can emit another terminal transition when suppressing an already-terminal watch's pending notification; repeated no-op cancellation emits nothing. Shutdown and reached before-tree cleanup publish invalidation even where tree preparation forbids persistence. Restoration emits nothing and starts no resources for restored watches.

Payloads are fresh, shallow-frozen, and failure-isolated from listeners. The bus is process-local and cooperative, not an authenticated durable boundary. These events neither add model turns nor prove task completion. Admission is not consumption; unknown handoffs are never replayed. Polling and countdown refreshes emit nothing.

```ts
import type { WatchEvent } from "../session-watch/api.ts";

const off = pi.events.on("session-watch:terminated", (data) => {
  const event = data as WatchEvent;
  // Observe event.id / event.state / event.notification locally.
  // No permission to control the target or infer task success is granted.
});
pi.on("session_shutdown", () => off());
```

This requires no watcher. `session-watch:*` events cannot themselves be selected by the `session_watch` tool, preventing watcher-generated wake loops. No direct session-control API is exported. The safe typed transport/projection helpers below are supported for trusted supervisors; other modules remain internal. The tool's supported target/event/receipt contracts and limitations are in [README.md](README.md).

## Typed host transport

`api.ts` also exports `SessionEventBridge`, `subscribeEvents`, `discoverSessions`, `SESSION_EVENTS`, `subscribeSessionBus`, `projectSessionEvent`, `sessionEventFilters`, `validSessionNotice`, and the corresponding `SessionEventName`, `SessionNotice`, `SessionTarget`, `EventSubscription` types. [Background](../background/API.md) reuses this closed event inventory and Unix transport without invoking the legacy watcher or sharing job ownership.

`new SessionEventBridge(canonicalPrivateRoot, sessionId)` owns a fresh incarnation. Call `start()` at session startup, `publish(name, projectedMetadata)` only with the safe inventory, and idempotent `close()` on invalidation/shutdown. `subscribeSessionBus(pi, publish)` projects existing producers into safe metadata and returns a disposer; built-in hooks are published separately. Discovery probes only the supplied trusted canonical private directory; never use caller-controlled paths. Background uses a separate private directory, leaving legacy discovery unchanged.

`subscribeEvents(root, exactIncarnation, selectedEvents, lifetimeMs, onEvent, onLoss, signal?)` is a continuous host subscription, distinct from the legacy tool's one-shot `observe`. It returns `{target, startedAt, close}` after ACK. Filters contain 1–8 unique closed-inventory names and lifetime is 1000–86400000 ms. Callbacks are attached before ACK, so accepted events between acknowledgment and return are retained by the caller. Each valid ordered notice invokes `onEvent`; disconnect, malformed frame, wrong incarnation/nonce or non-increasing sequence closes the connection and invokes `onLoss` once. Explicit close suppresses loss reporting. No reconnect/replay or buffering beyond the fixed 8 KiB transport receive buffer is provided; supervisors own bounded event queues and deadlines. Callback exceptions close coverage rather than silently dropping events. Provider setup cancellation can reject before admission; after admission close the returned subscription.

Directory/socket permissions, 16 incoming connections, two-second handshake, 128-entry/four-probe discovery bounds, fixed wire projection and same-user trust limitations remain those documented in the README. The additional `subscribe` wire operation keeps a filter after each event; legacy `watch` still closes after its first match. No legacy caller behavior changes.
