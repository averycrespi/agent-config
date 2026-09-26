# Mailbox design

Mailbox owns durable messages and automatic session listening, batching, visibility and wake eligibility. Coordinate owns assignments and explicit acceptance; TODO owns unresolved obligations; Monitor owns unrelated bounded observations; Background owns separate execution notification/consumption. None of those lifecycles is merged here.

## Storage and delivery transaction

`store.ts` validates bounded inputs before taking a cooperative writer lock. It validates a complete bounded snapshot, computes a replacement privately, enforces quota, writes/fsyncs a private staging file, renames atomically and fsyncs the directory. Readers see complete JSON without locking. Runtime sender identity is required at the host boundary. Sequence/incarnation cursors survive ACK without renumbering; clear changes incarnation so old scans reject rather than silently skipping fresh mail.

Each message retains attempts, visibility deadline, handoff uncertainty and one-time limit-warning disposition alongside its original ID/sender/time/body. None is reconstructed from conversation history. Listing exposes all messages, including visibility-held and exhausted ones. ACK and clear share the same writer transaction as sends.

Delivery rechecks current rows under that lock, selects only eligible bodies within byte/count bounds, then durably records an uncertain intent before invoking synchronous Pi handoff. The actual handoff timestamp starts visibility. A successful call confirms the intent; a thrown call retains uncertainty and the full timeout. Failure/crash after intent but before final confirmation leaves an orphan intent with no deadline, excluded from automatic replay. A post-rename durability failure is explicit uncertainty, never permission to resend. The writer lock stays held through handoff, so ACK/clear cannot sneak between selection and submission; contending operations fail without retry. Only selected rows consume attempts. Exhaustion survives restart and does not inhibit new messages.

The API cannot make filesystem publication and Pi submission atomic. Conservative intent retention closes the blind-replay gap, at the cost of manual reconciliation for orphan intents. Warning disposition is persisted once with the limit transition; a crash before UI notification can lose the transient notice, but the durable widget/status warning remains. No exactly-once execution guarantee is claimed.

## Consumer, timing and lifecycle

`consumer.ts` claims a separate exclusive per-session directory; duplicate owners fail closed. Normal shutdown releases it idempotently without deleting messages. Crashed ownership requires process/state inspection and separately authorized manual cleanup, like writer locks. Registration starts no resources; `session_start` claims and catches up. New/resumed/forked session identity comes from runtime context, not environment routing. Navigation changes neither consumer ownership nor external ACK/delivery state.

`delivery.ts` owns one pending fixed-window deadline. Later arrivals never move it. At expiry it waits for safe idle; arrivals while held can join. Empty/ACKed/cleared eligibility cancels the pending batch. Overflow stays eligible for a later bounded batch. `index.ts` gates on runtime idle, queued messages, prior handed wake, TUI draft and prompt depth; it never edits the draft. Handed work stays gated until settlement. The filesystem watcher is a hint; a one-second nonpersistent ticker supplies durable catch-up and countdown refresh. A storage/configuration/listener failure fails closed instead of silently replaying or weakening policy. RPC draft visibility is unavailable and therefore handoff is held.

Human-only clear uses the writer lock, wipes rows and delivery state, cancels the extension-owned pending batch, and leaves later sends intact. It cannot retract messages owned by Pi and never mutates other extensions' state. Tool/Script APIs expose no clear, retry, reset, pause or dismissal.

## Display and interfaces

`widget.ts` projects exactly listening/pending/unavailable, bounds width and prioritizes actionable warnings. `createPersistentWidget` mounts once and repaints without reordering siblings. Bodies and sender text never enter rows. `notification.ts` provides a pure compact/expanded untrusted wake projection with theme background, bounded sanitized text and unchanged model content. `render.ts` retains tool rendering and persistence-versus-consumption semantics.

`api.ts` provides read-only current-process readiness and total pending counts for Coordinate. A session is ready only when its own listener is available; storage existence is not listener readiness. Optional Script send/list/ack and address-only change events remain separate from automatic listening. No provider evaluator, observer recipe or legacy supervision adapter is used.

## Verification

Store/delivery regressions cover fixed windows under continuous arrivals, zero delay, byte overflow, held eligibility, ACK/clear transaction races, stable redelivery identity, full visibility reset, exhaustion and mixed mail, uncertain handoff, durable orphan intents, quotas/cursors and duplicate consumers. Extension fixtures cover real tool/provider sender attribution, resume/fork/navigation/shutdown, UI holds, read-only status and continued listening after clear. Widget/notification tests cover colors, hostile controls and narrow widths. Coordinate tests establish listener readiness without Monitor/Script permission. Full repository tests retain unrelated Monitor and Background behavior. Deterministic tests do not qualify live model compliance, terminal/editor behavior or live Herdr delivery; candidate linking/reload and live exercises need separate authority.
