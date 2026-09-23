# Parent-managed child decisions

Read the [shared managed decision protocol](../../spin-out/references/decisions.md) completely. It owns child-only parent-mode launch, durable non-answer requests, exact correlation, provenance, continuation intent and acknowledgment. Read it before child startup; provide its resolved readable path in the handoff. No diverging stack-specific copy is maintained.

## Child-only launch

Use the shared protocol's child-only launch after the [shared exact-base procedure](../../spin-out/references/launch.md). Preserve work-stack ordering: startup/readiness, exact session/incarnation correlation, bounded attention registration, then one non-waiting initial prompt. Retain the stable `agent_settled`, `ask-user:input_requested` and `session_shutdown` filters. Parent mode emits no fictional input events.

## Parent reconciliation and continuation

Keep work-stack serial: a pending `decision_required` child retains sole implementation ownership and blocks successor launch. This is not adoption into repo coordination. Retain existing stack checkpoints and recovery unchanged; no automatic migration or intermediate manager.

On attention, reconcile the receipt and current child checkpoint, then apply the shared correlation/authority protocol. Cancel/reconcile the corresponding attention/continuation job before asking the human. A cancelled/unanswered question leaves this child blocked; do not launch a substitute or successor. A parent decision is allowed only within delegated authority and must be labelled honestly.

Record continuation intent in the existing stack `Current intent` section; register attention within retained parent allowances before prompting the same child once. Submission alone does not prove application. Retain uncertain effects; do not replay. After matching acknowledgment retain the child-owned resolution reference, not a second decision history. Answers never reset parent observation or child CI/repair allowances. Advance only after all existing work-stack delivery-boundary and predecessor checks pass.
