# Stack decisions

Read the [shared managed decision protocol](../../spin-out/references/decisions.md). It owns mailbox reporting, durable incorporation-before-ack, conversational questions, exact correlation, provenance and uncertain Herdr relay. Do not maintain a separate implementation or launch mode.

A pending question retains the current child as sole owner and blocks successor launch. Cancel/reconcile continuation for affected blocked work; do not open modal UI or automatically replace the child. Record answers and relay intent in the shared project record; submission alone does not prove application. Preserve unanswered and answered-awaiting-confirmed-relay questions across replacement, without resetting budgets or replaying prompts.

Advance only after all existing work-stack delivery-boundary and predecessor checks pass. There is no automatic migration or intermediate manager.
