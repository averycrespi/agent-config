---
name: clarify
description: Use when material ambiguity in goals, requirements, scope, or trade-offs needs focused clarification before work proceeds, or when the user explicitly wants to be questioned about an idea. Research answerable questions first; return a concise brief without creating artifacts.
---

# Clarify

Resolve material ambiguity through research and focused questions. Return a shared understanding, not a design document, implementation plan, ticket, or code change. This is not a mandatory phase before implementation or ticket delivery and grants no delivery authority.

## Process

Read [the clarification protocol](references/protocol.md) completely and follow it.

1. **Frame the outcome.** Identify the intended result and what is already settled from the conversation and supplied evidence.
2. **Research first.** Inspect relevant repository context and authoritative external sources when needed. Resolve answerable questions without asking the user to do the research.
3. **Identify material gaps.** Consider goal and success, scope and non-goals, observable behavior, data and integration constraints, risks, trade-offs, and verification. Use only categories relevant to the request; do not turn them into a mandatory questionnaire.
4. **Ask one focused question at a time.** Prioritize decisions whose answers change the outcome. Recommend an option with its trade-offs, use the answer to choose the next question, and challenge contradictions or weak assumptions constructively. Do not reopen settled decisions without new evidence.
5. **Stop when the brief is actionable.** Leave routine implementation choices to execution. If material uncertainty remains because the user stops or evidence is unavailable, report it rather than inventing a decision.

## Output

Return a concise brief with the clarified outcome, settled decisions and rationale, scope boundaries, material assumptions or unresolved questions, and a concrete recommended next action. Omit empty sections.

When the request is already clear, say so and recommend the next action without a redundant interview. Use `shape-ticket` only when a Plane delivery ticket is the intended next artifact; direct implementation, further research, or a design discussion may be more appropriate.

Do not create or edit files, tickets, or other durable artifacts. Another explicitly authorized task or workflow owns any subsequent action.
