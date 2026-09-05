# Clarification Protocol

Use this protocol to resolve material ambiguity without making silent user-owned decisions. The calling skill supplies the ambiguity taxonomy, completion gate, and output contract appropriate to its scale, which may be a conversational brief rather than a durable artifact.

## 1. Establish

Restate the intended outcome in one or two sentences. Identify what is already known, the decision scale, and the likely next artifact or action.

Treat supplied tickets, plans, specifications, architecture documents, sketches, and prior conversation as evidence, not automatically as settled truth. Call out contradictions between sources.

## 2. Research answerable questions

Gather enough evidence before asking for the user's attention.

Use whichever sources apply:

- **Codebase:** read repository instructions, existing design artifacts, relevant source, tests, configuration, and nearby conventions.
- **Subagents:** for substantial or unfamiliar questions, run independent read-only research branches in one parallel dispatch when possible.
- **Web:** research current external APIs, libraries, standards, and public examples when they constrain the decision.
- **Memory:** use configured memory tools when prior preferences or decisions may matter.

Do not ask a question that research can answer. When evidence only suggests a default for a user-owned choice, ask and recommend that default.

## 3. Map ambiguities privately

Classify each category in the calling skill's taxonomy as **Clear**, **Partial**, **Missing**, or **Not Applicable**. For every Partial or Missing category, classify the gap as:

- answerable through more research,
- a material user-owned decision,
- safe to record as a non-blocking assumption,
- intentionally deferred to a named downstream action or artifact, or
- out of scope.

A safe assumption must be low-impact, reversible, and not user-visible. Do not assume scope, observable behavior, acceptance criteria, security posture, data semantics, system boundaries, or risk tolerance when multiple reasonable choices exist.

## 4. Ask one decision-tree question at a time

Ask exactly one focused question, wait for the answer, then choose the next question from the updated dependency tree.

- Resolve parent decisions before child details.
- Prioritize the highest `impact × uncertainty` gap.
- Ask only when the answer can materially change the outcome, scope, architecture, behavior, verification, risk, or next action.
- Prefer `ask_user` with 2–5 options when several valid choices have different trade-offs.
- Put the recommended option first and explain the recommendation briefly.
- Constrain short-answer questions to a clear answer shape.
- Resolve ambiguous answers before moving to another branch.

Default format:

```text
Recommended: <answer> — <brief reason>.
Question: <one decision to resolve?>
Options: <2–5 choices, or a short-answer constraint>
```

Stop asking when all decisions owned by the current skill are settled, explicitly deferred to the correct downstream action or artifact, or safely recorded as non-blocking assumptions.

## 5. Maintain a decision ledger

After each answer, record internally:

- **Decision:** the chosen outcome.
- **Rationale:** user preference or supporting evidence.
- **Implications:** affected boundaries, behavior, artifacts, tests, rollout, or risks.
- **Follow-ups:** child questions unlocked by the decision.

Use the ledger to avoid repeated questions, detect contradictions, and write a coherent final artifact or summary.

## 6. Run the calling skill's completion gate

Before finalizing, verify that:

- every decision owned at the current scale is settled,
- downstream deferrals are explicit and correctly scoped,
- no assumption hides a material user-owned choice,
- success can be evaluated at the current scale, and
- the recommended next action or artifact is unambiguous.

If the user stops before the gate passes, report the settled decisions and remaining blockers. Only write a Draft artifact when the calling skill permits it; never label an artifact Ready while blocking decisions remain.
