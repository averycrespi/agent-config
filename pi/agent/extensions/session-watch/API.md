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

This requires no watcher. `session-watch:*` events cannot themselves be selected by the `session_watch` tool, preventing watcher-generated wake loops. No direct control API or generic transport API is exported. Other modules are internal. The tool's supported target/event/receipt contracts and limitations are in [README.md](README.md).
