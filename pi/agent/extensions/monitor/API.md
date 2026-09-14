# Monitor events

Monitor publishes in-process lifecycle observations on Pi's existing `pi.events` bus. Import the payload union from `api.ts`:

```ts
import type { MonitorEvent } from "../monitor/api.ts";
```

| Event                  | Payload                                           | Timing                                                                                                                        |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `monitor:registered`   | `{ type: "registered", id }`                      | After synchronous admission, before receipt persistence and scheduling.                                                       |
| `monitor:terminated`   | `{ type: "terminated", id, state, notification }` | After closing observation or suppressing a pending notification, before persisting the transition.                            |
| `monitor:notification` | `{ type: "notification", id, notification }`      | `handoff_unknown` after persisting the attempt and before calling Pi; `handed_to_pi` only after the synchronous call returns. |

`id` is the producer-generated 36-character monitor UUID. `state` is `condition`, `deadline`, `failure_limit`, `unsafe_failure`, `cancelled`, or `invalidated` (`MonitorTerminalState`). Termination notification is `pending` or `suppressed`; notification-event disposition is `handoff_unknown` or `handed_to_pi`.

These shallow-frozen payloads contain only identity and fixed enum values: no labels, descriptions, instructions, source, evidence, tool data, or raw errors. They are separate from the richer retained receipts. Events do not add persistence, poll/countdown telemetry, model turns, permissions, or allowances. Producer behavior and the existing follow-up remain authoritative; listeners should be short, observational, and must not mutate producer state.

Cancellation or lifecycle invalidation suppresses extension-owned pending handoffs. This can emit a second terminal transition for an already terminal monitor whose notification was still pending. Repeated cancellation/close without a transition emits nothing. Shutdown, replacement, and reached before-tree hooks emit invalidation for affected monitors; restored receipts emit nothing and never restart work. Abrupt process termination cannot guarantee an event.

`condition` means attention, not task success. `handoff_unknown` marks an attempt, not proof of failure; a thrown handoff stays unknown and is never retried. `handed_to_pi` is not an acknowledgment of consumption. Already Pi-queued messages cannot be selectively retracted. See the [notification boundary](README.md#notification-boundary).

## In-process example

Inside another loaded extension factory, this collects only terminal dispositions without a watcher, model call, or cross-process bridge:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MonitorEvent } from "../monitor/api.ts";

export default function (pi: ExtensionAPI) {
  const terminal = new Map<string, string>();
  const unsubscribe = pi.events.on("monitor:terminated", (data) => {
    const event = data as Extract<MonitorEvent, { type: "terminated" }>;
    terminal.set(event.id, event.state);
    if (terminal.size > 32) terminal.delete(terminal.keys().next().value!);
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
    terminal.clear();
  });
}
```

Pi's bus is process-local, best-effort, and not an authenticated message boundary: other trusted extensions can emit on it. Validate untrusted inputs at any external boundary. There is no replay, subscription tool, transport, or task-completion signal here. Built-in Pi hooks remain unchanged.
