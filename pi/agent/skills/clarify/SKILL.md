---
name: clarify
description: Use when material ambiguity must be resolved but the appropriate architecture, specification, plan, or implementation workflow is not yet clear, or when the user wants clarification without a durable artifact.
---

# Clarify

Resolve ambiguity and route the work to the correct next workflow without producing an architecture, specification, implementation plan, or code change.

Use `architect` directly when the user already wants high-level system design. Use `specify` directly when the user already wants a durable contract for one bounded change. Those skills apply the same clarification protocol at their own scales.

## Outcomes

Produce a shared understanding that:

- Makes the desired outcome, decision scale, and next artifact explicit.
- Separates evidence-backed facts from user-owned choices.
- Resolves contradictions and the highest-impact uncertainties.
- Routes broad system-shape work to `architect`, bounded behavioral work to `specify`, and already specified work to `plan`.
- Remains stateless and leaves durable artifacts to an explicitly owning workflow.

## Process

Read [the clarification protocol](references/protocol.md) completely and follow it.

### Establish the destination

Restate the request and determine which destination is plausible:

- **`architect`:** the work concerns an entire system or a cross-cutting feature, includes major structural trade-offs, or should decompose into multiple independently specifiable outcomes.
- **`specify`:** the work is one bounded feature or change whose observable behavior, scope, policies, or acceptance criteria need to be settled.
- **`plan`:** a Ready specification already exists and implementation strategy is the remaining concern.
- **Other:** a ticket, prototype, investigation, direct implementation, or another explicitly requested outcome is more appropriate.

If the destination is already clear, stop routing and recommend the corresponding skill rather than running a redundant generic interview.

### Build the generic ambiguity map

Classify these categories using the protocol:

- **Goal and success:** target user, problem, expected outcome, success measure.
- **Decision scale:** system shape, bounded behavior, implementation strategy, or local mechanics.
- **Scope boundaries:** in-scope behavior, non-goals, migration, and rollout boundaries.
- **Observable behavior:** workflows, states, errors, accessibility, and compatibility expectations.
- **Domain and data:** entities, identity, lifecycle, retention, volume, and ownership.
- **Integration:** external systems, APIs, protocols, and dependency constraints.
- **Failure and risk:** negative cases, partial failure, recovery, security, privacy, and operational concerns.
- **Acceptance and verification:** observable completion criteria and expected evidence.
- **Terminology:** canonical names and conflicting definitions.

Ask only enough questions to determine the destination and resolve material ambiguity that must precede it. Do not perform the destination skill's full interview inside `clarify`.

### Summarize and route

End with:

- **Goal:** the clarified outcome.
- **Settled decisions:** decisions and brief rationale.
- **Boundaries:** explicit non-goals and scope limits.
- **Risks or assumptions:** only material risks and safe assumptions.
- **Recommended next step:** exactly one primary workflow, with a concrete prompt.

Examples:

```text
Use the architect skill to design the system and decompose it into specifications from the decisions above.
```

```text
Use the specify skill to write a Ready specification for this bounded change from the decisions above.
```

Do not write under `.design/`; `architect`, `specify`, and `plan` own those artifacts.

## Quality rules

- Do not become a mandatory ceremony before every other skill.
- Do not duplicate the full architecture or specification interview after the destination is known.
- Do not let plausible defaults hide user-owned decisions.
- Do not leave contradictions unresolved.
- Do not write implementation plans or change code.
