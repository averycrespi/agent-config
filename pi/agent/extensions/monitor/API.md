# Monitor provider API

Trusted sibling extensions import `registerMonitorProvider` and types from `../monitor/api.ts`. This combines ordinary Script method registration with typed host event sources. Providers retain full host authority; this API is not a sandbox for extension authors. Tool controls remain immutable `start/list/get/cancel`; engine modules are internal. Cycle/lifetime policy ceilings come from Monitor's [global/environment configuration](README.md#configuration), snapshotted at extension load; per-job bounds remain explicit.

## Typed event registration

`MonitorProvider` extends Script's `ScriptProvider` with `events: Record<string, EventSource>`. Register at most 16 named event sources per provider. Provider namespaces/methods obey [Script's registration contract](../script/API.md); event names match `[a-z][a-z0-9_]{0,47}`. There is one session-bus registration per namespace, not a process-global registry. Conflicts reject; disposal is explicit and idempotent. Validation finishes before any listener is installed. Dispose on shutdown or authority revocation.

An `EventSource` supplies:

- Nonblank public `description`, at most 500 control-free characters.
- `inputSchema`: strict Ajv draft-07 schema for the positional subscription argument array.
- `payloadSchema`: strict schema for safe projected payloads. Both schemas are snapshotted plain JSON, each at most 16 KiB; no async schemas or remote references.
- `subscribe(args, context): Promise<Subscription>`, invoked by the host, never a persistent guest. `context` contains `signal`, absolute `deadlineMs`, `emit(payload)` and `lost()`.

The returned `Subscription` contains `coverage` (bounded plain JSON describing actual subscription identity/boundary) and idempotent `close()`. Install callbacks before acknowledging coverage. Call `lost()` for disconnect, invalid identity, dropped coverage or malformed input; never reconnect or replay. Honor signal/deadline and close underlying resources. The absolute lifetime deadline can exceed 24 hours under configured policy; do not impose the former fixed ceiling or silently shorten coverage. Host setup is bounded to two seconds and remaining lifetime; a late return is closed without replay. Do not expose transcript/event-bus objects, questions/answers/options, credentials, raw errors or session control in payloads.

Each emitted payload and coverage record is copied and bounded to 4096 UTF-8 bytes. Payload validation failure reports coverage loss rather than invoking the evaluator with malformed data. Monitor buffers accepted events separately from attention coalescing. Provider disposal aborts active event selections as well as Script executions. Script's host allowlist and the registration's explicit provider selection both apply; registration alone grants no authority. Policy is sampled at registration/evaluation, not continuously watched. A provider availability callback change blocks new selection, while active revocation requires disposal.

Example (the application owns the typed producer, not a raw Pi bus selector):

```ts
import { registerMonitorProvider } from "../monitor/api.ts";

const dispose = registerMonitorProvider(pi, {
  namespace: "builds",
  available: () => active,
  methods: {
    status: {
      description: "Read a bounded build status",
      inputSchema: { type: "array", maxItems: 0 },
      handler: async () => ({ value: { ready: producer.ready() } }),
    },
  },
  events: {
    changed: {
      description: "Observe build readiness changes",
      inputSchema: { type: "array", maxItems: 0 },
      payloadSchema: { type: "boolean" },
      async subscribe(_args, { signal, emit, lost }) {
        const subscription = producer.subscribe({
          changed: emit,
          disconnected: lost,
        });
        const close = () => subscription.close();
        signal.addEventListener("abort", close, { once: true });
        if (signal.aborted) close();
        return {
          coverage: { startedAt: subscription.startedAt },
          close() {
            signal.removeEventListener("abort", close);
            close();
          },
        };
      },
    },
  },
});
pi.on("session_shutdown", dispose);
```

`producer` is illustrative trusted application code. Monitor never supplies a raw event-bus object or arbitrary session controller to evaluators. The mailbox extension supplies [durable report hints](../mailbox/API.md); there is no built-in session provider or cross-session lifecycle transport.

## Evaluator input

Each fresh Script child receives `trigger` and `state` function arguments. Trigger is `{kind: "initial" | "timer" | "event", at, subscription?, payload?}`. `subscription` is the zero-based immutable event selection index; `at` is host acceptance time. Provider payloads may additionally carry their own timestamp/sequence. Explicit state is the last committed JSON replacement, never a shared host object. See [execution and attention semantics](README.md#clocks-queues-and-attention).

## Observational lifecycle events

`MonitorEvent` is the safe, shallow-frozen payload `{type, id, status, notification}` emitted on `monitor:<type>`:

- `registered`: after admission, before persistence/scheduling.
- `attention`: a newly coalesced attention or stronger reason, before persistence.
- `terminated`: observation ends or pending attention is suppressed, before persistence. A later cancellation/invalidation can publish another terminal transition to record suppression.
- `notification`: persisted `handoff_unknown` before the Pi API call, then `handed_to_pi` after its synchronous return.

Only UUID and closed status/disposition enums are emitted. No source, names, message text, state, evidence, raw errors or tool payloads cross this surface. Observer failures are isolated. Polls/countdowns and restoration emit nothing; lifecycle observation adds no model calls, replay or permission. These events remain process-local and are not forwarded as cross-session selectors.

```ts
const off = pi.events.on("monitor:terminated", (data) => {
  const event = data as import("../monitor/api.ts").MonitorEvent;
  // Observe event.id/status/notification; do not infer task completion.
});
pi.on("session_shutdown", off);
```

The private provider query is `monitor:providers-v1`; the previous `background:providers-v1` is not registered. All repository consumers import `registerMonitorProvider` from `../monitor/api.ts`; no legacy API alias or duplicate event emission exists. Historical `background-wake` messages remain history only; new notifications use `monitor-wake`. Storage uses `monitor:receipt-v2`, with read-only compatibility for `background:receipt-v1`; retired `monitor:receipt-v1` is deliberately not interpreted. These observer identities must never identify a future Background execution service.

No watcher is required for this in-process observation. Pi's bus is a cooperative trusted-host boundary, not hostile multi-tenant authentication.
