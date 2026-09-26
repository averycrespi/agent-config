# Coordinate design

Coordinate owns durable delegation facts, not agent orchestration. Mailbox owns bidirectional session delivery, Monitor owns unrelated bounded observations, TODO remembers unresolved obligations, and child checkpoints own execution/evidence.

## Modules and state

- `index.ts`: human role commands, tool boundary, bounded request-local context and lifecycle refresh.
- `state.ts`: binding validation, assignment inventory and explicit exact-result acceptance.
- `record.js`: private common-directory storage with digest checks, atomic replacement and independent readback. No CLI entry point or agent bookkeeping API.
- `launch.ts`: capability/base preflight, assignment persistence, automatic listener readiness and child binding between prepare and submit.
- `launcher.js`: finite private Herdr launch with intent-before-effect and identity/focus/transcript checks. No legacy saved-Script or research launch wrapper.
- `render.ts`: pure concise summaries and role widget projection.

New state contains only role binding, assignment identity, one launch brief including committed base and task constraints, worker location, launch status/unresolved operation and acceptance references. No mailbox observer references are generated. Completed intermediate intents are cleared; raw Herdr envelopes, redundant prompt copies, ACK/report histories, wellness, questions/answers/relay ledgers and secondary supervision accounting are not generated. Historic sections remain readable and are not deleted or adopted automatically.

The brief must remain available before external effects. Record readback/digest confirmation gates every effect; missing confirmation is uncertainty, not permission to retry. Persistence and external effects cannot be one transaction. Preserve partial resources and the last unresolved intent when a later stage fails. A successful prompt submission is not task-correlated execution.

## Ownership and lifecycle

One owning coordinator session serializes tool/command mutations. Child bindings reject all coordinator actions; no role conversion or nested workers. Activation comes only from the human command. The mailbox is the complete session UUID. Existing external records are not migrated; a non-session address cannot satisfy new listener readiness. Session-tree history cannot roll back external worker facts. Active forks are refused; unrelated sessions do not inherit activation.

Read-only status does not accept, ACK or repair. Request-local context replaces only Coordinate's previous reminder, bounds outstanding identities, and points to source. Restoration emits no launch, observation or control effects. No new compaction memory framework is introduced.

Spawn reads Mailbox's current-process listener readiness before launch and before submission. It needs neither Script permission nor Monitor registration. Mailbox owns timers and delivery; no observer status, disable dependency, scheduler, copied budgets or inferred authority belongs here. Follow-up instructions use worker session inboxes while Herdr retains bootstrap/process inspection.

## Rendering

A persistent supported below-editor widget is mounted once while visible, updated in place on lifecycle/tool/mailbox events, and removed when disabled or shutting down. It owns no timer, border or footer behavior. Stale async refreshes cannot repaint a newer state. Labels are sanitized before styling and fitted to one row. Counts derive from retained assignments and inbox inspection; pending messages are not inferred questions or worker activity. Mailbox owns delivery warnings in its own widget.

Collapsed tools report useful counts/dispositions; evidence and record paths remain expanded. Disabled status is neutral while the model still receives a no-effects rejection. Spawn success requires matching submitted user text and subsequent assistant activity in the verified worker transcript. Verified execution remains confirmed when the worker is blocked on a question; its observed disposition is retained separately in execution evidence, not used as an irreversible launch failure. This is not completion or release, which still require explicit acceptance. Worker identity alone renders as prepared, never started. Uncertainty is stage-specific, never safe-replay guidance.

## Verification boundaries

Regression tests cover bindings, original mailbox reuse, request context replacement, read-only status, ownership/acceptance, listener readiness independent of Monitor/Script, launch partial failures and no replay. Pure display tests cover hostile labels and bounded widths. Fake Herdr tests cannot qualify live Pi/Herdr delivery, focus, draft handling or model obedience; keep these separate from deterministic evidence and require explicit live-test authority.
