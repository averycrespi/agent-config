# ask-user events

Ordinary in-process `pi.events` listeners can observe:

| Event                      | Payload                  | Timing                                                         |
| -------------------------- | ------------------------ | -------------------------------------------------------------- |
| `ask-user:input_requested` | `{ requestId }`          | When the custom UI factory begins an unaborted interaction.    |
| `ask-user:input_resolved`  | `{ requestId, outcome }` | In cleanup after that UI promise settles, including rejection. |

`api.ts` exports `InputRequestedEvent`, `InputResolvedEvent`, and `InputOutcome`. Each wait receives a fresh producer-generated 36-character UUID, unrelated to tool arguments or tool-call IDs. `outcome` is `answered` (option or free text), `cancelled` (Escape, abort, or no result), or `failed` (UI setup/render promise rejection). Failure before entering the factory does not report a wait. A failure after entering it emits a correlated failed resolution and still rejects the tool execution.

Validation rejection, pre-abort, headless execution, and RPC's unsupported custom UI do not emit a false wait. Cancellation while waiting uses the same request ID. Returning from the free-text editor to the choice list is still the same wait. No prompt state is restored or replayed; abrupt process termination cannot guarantee a resolution event.

Payloads are shallow-frozen and bounded to identity and enum disposition. They contain no question, context, options, answer, tool-call data, or raw error. Existing `herdr:blocked` active/inactive signaling remains balanced around the custom UI call, including synchronous failures. Existing tool results still contain the answer for the requesting agent; they are not public-safe lifecycle payloads.

Event emission does not change user interaction or add model turns. Listener failures cannot replace the producer result or skip cleanup. These are observations, not permission for another agent to answer. Built-in Pi UI prompt hooks remain distinct and unchanged.

## Subscribe

```ts
import type { InputResolvedEvent } from "../ask-user/api.ts";

const unsubscribe = pi.events.on("ask-user:input_resolved", (data) => {
  const event = data as InputResolvedEvent;
  // Observe event.requestId and event.outcome, never an answer.
});
pi.on("session_shutdown", () => unsubscribe());
```

This uses Pi's existing process-local bus without a watcher. The bus is best-effort, not authenticated, durable, or cross-process; other trusted extensions can publish on the same channels. Keep listeners observational and validate data at any external boundary.
