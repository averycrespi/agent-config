# Background design

Background separates execution lifetime from the foreground tool turn without replacing any executor. The adapter prepares its existing executor's authority and deadline; the service owns persisted admission, outcomes and attention.

## Modules

- `api.ts`: supported host contract and session-bus discovery, independent of extension module-cache identity.
- `service.ts`: single-owner execution/attention lifecycle, copied receipts, finite admission, cancellation, dismissal and stale-completion suppression.
- `store.ts`: bounded validated session sidecar, exclusive owner-only staging, atomic rename and filesystem synchronization. Historical observer entries are never inspected.
- `index.ts`: Pi session/turn/context hooks, automatic readiness-based handoff and one persistently mounted below-editor widget.

## Admission and storage

A stable UUID and immutable deadline are persisted before invoking adapter code. No work starts after failed admission. Each adapter is invoked once in a handled promise, and must use its original executor's deadline/abort implementation. Background never dispatches provider calls or schedules repeated work.

The session sidecar is separate from Pi's append-only custom entries: `appendEntry` can buffer writes before the first assistant message and does not provide a filesystem durability acknowledgment. A bounded atomic snapshot makes admission failure observable before execution and avoids unbounded receipt-update history. Store errors close admission and abort active work. Even a rename followed by failed directory synchronization is uncertain; no automatic resend or execution replay follows.

Records are retained for the entire session. Fixed capacity rejects rather than evicting pending, consumed, dismissed or uncertain results. Branch visibility follows the admission anchor, while the sidecar retains all branches. Returning to an old branch surfaces interrupted outcomes. A fork does not inherit execution ownership or sidecar state. Persistence is cooperative single-owner storage, not a hostile same-user isolation mechanism.

## Attention and races

Terminal outcome and notification intent commit together. Before `sendMessage`, handoff becomes durably unknown. Only successful return marks handed-to-Pi; a throw retains uncertainty. Consumption remains a separate observation requiring context inclusion and a successful provider-response hook, not a send return, agent settlement, inspection, or task acceptance. Providers without that hook retain attention until dismissal. Trusted context/payload-transforming extensions limit what this observation proves.

The delivery pump checks idle state, pending messages, visible TUI draft and dialog state before each handoff. It does not mutate the editor. A one-second unref'ed timer catches draft clearance without model polling or blocking lifecycle handlers. Timers are cleared on close. Each terminal run has at most one notification attempt; dismissed intent is suppressed, and already handed messages cannot be recalled.

Shutdown/reload and successful navigation revoke the service before aborting, persist conservative interrupted/unknown-effect state, and suppress late executor results. Restoration cannot recreate callbacks or renew deadlines. Canceled navigation leaves execution untouched. Storage failure retains in-memory uncertainty and forbids new work/notifications. Arbitrary synchronous trusted callbacks remain capable of blocking Pi; the service is not a sandbox.

## Rendering and tests

Rows show only genuine lifecycle state, a sanitized label, unknown-effect warning, optional adapter-reported settled/total and failed counts, and short identity. Optional progress snapshots validate monotonic counts and bounded partial outcomes before atomic persistence. They produce no telemetry event or notification; interruption preserves the last snapshot. Existing Script adapters need not report progress. Shared fitting truncates each row to terminal width without wrapping. The shared persistent-widget helper repaints instead of reinserting keys; no animation, fabricated percentages or sibling reordering is introduced.

Tests cover durable-before-run ordering, cancellation, capacity, storage faults, no-replay uncertainty, restoration and stale callbacks, real Script subprocess outcomes/revocation, actual event-bus listener payloads, tool controls, draft deferral and narrow/hostile rendering. Interactive qualification remains a separate delivery requirement; unit fixtures alone do not prove a live conversation remains responsive.
