# Monitor design

Monitor separates observation from cognition: one deterministic session owner schedules fresh code-mode executions; pending observations never enter the agent message loop. The public contracts live in [README](README.md) and the [code-mode host API](../code-mode/API.md).

## Modules and boundaries

- `index.ts` binds the engine to the active Pi context, captures generation tokens across asynchronous setup, persists custom entries, delivers terminal custom messages, and registers one tool plus direct commands. It uses supported below-editor widgets and never owns Pi's queue.
- `engine.ts` owns synchronous admission, stable identity, immutable lifetime, shared execution slots, per-monitor cancellation, accounting, result validation, terminal states and serialized notification attempts. An injected clock/executor/message sink provides deterministic tests without live mutations.
- `config.ts` validates global/environment settings and finite hard ranges. Invalid configuration disables registration; inspection/cancel do not need gateway access.
- `receipts.ts` validates a bounded versioned history shape and restores latest per-ID receipts with bounded indexing and a hard 4096-entry ancestry/examination window. It uses `getLeafId`/`getEntry`, never an unbounded `getBranch` materialization; older receipts remain in Pi history but are omitted from restoration. Restoration never restores a worker or handoff.
- `tool.ts` defines the schema, bounded receipt summaries, untrusted notification framing and compact width-aware rendering. Widget/tool rows do not read source, arguments or evidence.

Monitor imports only code mode's supported `api.ts` and the gateway sanitization surface. There is no second JavaScript runtime, indirect invocation of an agent tool, or monitor-specific allowlist. Ordinary code mode, direct MCP and Loop have independent execution lifetimes and remain unchanged.

## Scheduling and ownership

Registration finishes dependency inspection before entering synchronous engine admission, so concurrent starts cannot reserve the same name or oversubscribe capacity. All request errors are collected before mutation. A fresh UUID prevents reuse across cancellation/eviction; source remains private to an active monitor record.

One host timer selects the next eligible observation/deadline. A set of running promises holds shared slots through executor cleanup; each monitor has at most one controller. Completion schedules the next observation relative to settlement, never relative to missed interval boundaries. Queue delay consumes lifetime. The executor additionally checks wall time at IPC admission and dispatch, not just timer callbacks, so an event-loop delay cannot admit a late nested call.

Terminal state closes observation immediately and aborts the controller. Deadline/cancellation may precede child close; the terminal receipt retains in-flight status until settlement, then adds final safe host failure metadata. A pending notification waits for cleanup so it cannot lose uncertain-effect evidence. Capacity remains occupied until both cleanup and pending handoff end. Retention never evicts occupied records.

Session/branch generation invalidates asynchronous registration, timers, results and pending handoffs. Shutdown persists invalidation while the old runtime is still valid, then aborts/awaits child cleanup. Tree navigation invalidates without persisting during the prepared tree operation. Destination restoration walks only its active branch. If a later extension cancels navigation, monitors remain stopped; if an earlier extension cancels before Monitor's hook runs, no navigation occurred and monitors remain owned by the original context. Neither case blocks navigation or restarts observations.

## Failure and handoff invariants

Host `RunResult` always wins over guest decisions. A repeat-safe host failure still requires a protocol-valid observation return before scheduling another poll; malformed decision/evidence terminates deterministically while retaining host failure metadata. Latest validated evidence is separately attributed to its poll number. The cumulative safe-failure counter survives intervening waits. Classification defaults unsafe: only every-call nondispatch plus branded transient discovery failure qualifies. Any dispatched call makes replay unsafe regardless of annotations or subsequent gateway rejection.

Terminal notification transitions are `pending → handoff_unknown → handed_to_pi`, or `pending → suppressed`. Persist `handoff_unknown` before invoking the synchronous Pi API. Exceptions/interruptions leave that state without replay. A separate zero-delay timer serializes one attempt at a time and permits cancellation before the Pi boundary; there is no acknowledgment promise to await. Successful API return says only that handoff returned, never that a follow-up was consumed. Do not use `hasPendingMessages`, history absence, agent end or queue inspection as a selective acknowledgment.

Custom receipt entries are not conversation messages. A persistence error closes the engine rather than continuing unrecorded observation. History entries are individually bounded; append-only Pi history grows with finite polling and user registrations. Interrupted recovery receipts conservatively retain `inFlight` and consumed poll count; exact final call accounting after abrupt shutdown is not guaranteed. Source/returned evidence may contain sensitive data in ordinary Pi history; redaction is not universal secret detection.

## Change guidance

Keep all tests observable: controlled clocks assert scheduling/message counts, API fixtures execute real permissioned children, and fake Pi sinks assert delivery options/lifecycle/widget placement. Existing code-mode tests qualify isolation, credential/schema admission and cancellation semantics. No live mutation fixture is needed. Manual TUI smoke and live service qualification are separate evidence, not implied by unit tests.

Do not add resume/update/extend, detached workers, CI-specific adapters, work-ticket adoption, approval polling or queue-clearing workarounds without revisiting the product/authority boundary. Node permissions are not CPU/memory quotas or hostile multi-tenant isolation.
