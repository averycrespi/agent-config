# ask-user API

## Events

Ordinary process-local `pi.events` listeners can observe:

| Event                      | Payload                | Timing                                                     |
| -------------------------- | ---------------------- | ---------------------------------------------------------- |
| `ask-user:input_requested` | `{requestId}`          | When the custom UI factory begins an unaborted interaction |
| `ask-user:input_resolved`  | `{requestId, outcome}` | Cleanup after UI settlement, including rejection           |

`api.ts` exports `InputRequestedEvent`, `InputResolvedEvent` and `InputOutcome`. Each actual wait receives a fresh UUID. Outcome is `answered`, `cancelled` or `failed`; no question, context, options, answer, tool-call contents or raw error enters these shallow-frozen payloads. Existing requesting-tool results still contain the answer.

Validation rejection, pre-abort, headless execution and unsupported RPC custom UI do not announce a wait. Cancellation shares the original request ID; returning from the editor to the choices is still one wait. Abrupt exit cannot guarantee resolution. Listener failures cannot replace the result or skip cleanup. Balanced `herdr:blocked` active/inactive signaling remains around the custom UI call. Built-in Pi UI prompt hooks remain distinct.

```ts
import type { InputResolvedEvent } from "../ask-user/api.ts";
const off = pi.events.on("ask-user:input_resolved", (data) => {
  const event = data as InputResolvedEvent;
  // Observe identity/outcome, not an answer or permission to supply one.
});
pi.on("session_shutdown", off);
```

The bus is cooperative and best-effort, not authenticated, durable or cross-process. No question state is restored or replayed. Managed coordination uses [mailbox reports](../../skills/spin-out/references/decisions.md), not an asynchronous ask-user API or a parent-mode result.
