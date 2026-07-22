---
name: clarify
description: Use when interviewing through fuzzy requirements, scope, behavior, edge cases, and acceptance criteria before planning or implementation.
---

# Clarify

Run a focused clarification interview until the user's intent is explicit enough to plan or implement without silently inventing user-owned decisions.

This skill is stateless. It produces no durable artifact by default — no `.plans/` file, no `.designs/` doc, no committed notes. The only output is an in-conversation handoff summary. Design synthesis belongs to the `plan` skill, not here.

Do not write an implementation plan or change code while using this skill. Stop after the handoff summary and an explicit recommended next step.

## Outcomes

Produce a shared understanding that:

- Makes product, UX, scope, edge-case, security, data, and verification decisions explicit.
- Separates evidence-backed facts from user-owned choices.
- Converts vague goals into observable acceptance-criteria candidates.
- Leaves no blocking ambiguity for the next `plan`, `/goal`, ticket, or implementation step.
- Resolves decisions one dependency at a time instead of batching a long questionnaire.

## Process

### 1. Establish the starting point

Restate the goal in one or two sentences. Identify what is already known from the user's request and what kind of action likely comes next, such as a `.plans/` handoff, ticket, prototype, bugfix, refactor, or direct implementation.

If the user supplied a plan, spec, ticket, design sketch, or prior context, treat it as input to clarify, not as settled truth.

### 2. Research answerable questions first

Before asking the user anything, gather enough evidence to avoid wasting their attention. If research proves an answer, do not ask. If research only suggests a plausible default for a user-owned decision, ask with that default as the recommendation.

Dispatch read-only exploration in parallel: send multiple Agent calls with `subagent_type: "Explore"` in a SINGLE message, one per independent research branch (localize files, discover conventions, identify risks, summarize a doc). Use `subagent_type: "general-purpose"` only when a branch needs tools beyond read-only search. Subagents cannot ask the user — only the main agent uses `AskUserQuestion`.

Sources to draw on:

- **Codebase:** read `CLAUDE.md`, `AGENTS.md`, `README.md`, design docs, existing `.plans/`, relevant source, tests, configs, and nearby conventions.
- **Web:** research when behavior depends on current external APIs, libraries, standards, or public examples (use placeholders like `example.com` and `ABC-123` in any shared examples).
- **Broker/MCP:** when a decision depends on a ticket, PR, or external system, use the relevant `mcp__mcp-broker__*` tool (delegate verbose lookups to a subagent that returns a concise summary).

### 3. Build a private ambiguity map

Scan for unresolved decisions across this taxonomy. Mark each category internally as Clear, Partial, Missing, or Not Applicable:

- **Goal and success:** target user, problem, success criteria, expected outcome.
- **Scope boundaries:** in-scope behavior, non-goals, migration or rollout limits.
- **Product / UX behavior:** workflows, user-visible states, empty/error/loading behavior, accessibility or localization expectations.
- **Domain and data:** entities, identity rules, lifecycle/state transitions, retention, volume, ownership.
- **Integration and compatibility:** external services, APIs, protocols, backwards compatibility, dependency constraints.
- **Failure handling:** negative cases, retries, conflicts, partial failure, rate limits, degradation.
- **Security and privacy:** authN/Z, sensitive data, permissions, compliance, abuse cases.
- **Operational concerns:** performance, observability, deployability, support/debugging needs.
- **Acceptance and verification:** observable acceptance criteria, tests, manual checks, evidence expected at completion.
- **Terminology:** canonical names, overloaded words, domain conflicts.

For each Partial or Missing category, decide whether the gap is answerable by more research, a material user-owned decision, safe to record as a non-blocking assumption, or out of scope.

A safe assumption must be low-impact, reversible, and not user-visible. Do not assume scope, UX, acceptance criteria, security posture, data semantics, or risk tolerance when multiple reasonable options exist.

### 4. Ask one decision-tree question at a time

Ask exactly one focused question, wait for the answer, then choose the next question based on that answer. Never dump a batch of questions.

Question rules:

- Walk down the dependency tree: settle parent decisions before child details.
- Order by highest `impact × uncertainty` first.
- Ask only when the answer materially changes scope, architecture, task breakdown, tests, UX behavior, operational readiness, risk, or acceptance criteria.
- For 2–4 discrete options, use `AskUserQuestion`. Put the recommended option first, labeled "(Recommended)", with a one-line reason. Include an "accept the recommendation" path so the user can answer fast.
- For open-ended or yes/no questions, ask in plain text and constrain the shape when useful (e.g. "answer in <=5 words").
- If an answer is ambiguous, ask a quick disambiguation before moving on; do not count it as a new branch.

Keep asking until every material user-owned decision is resolved, explicitly deferred, or intentionally out of scope. For a substantial fuzzy task, ask at least one user-owned clarification unless research proves all high-impact categories are clear.

Stop early only when no material ambiguities remain, the user says to proceed or accept defaults, the remaining gaps are safe non-blocking assumptions, or the work is better continued by writing a plan from the settled decisions.

### 5. Maintain a living decision ledger

After each accepted answer, update an internal decision ledger:

- **Decision:** the clarified choice.
- **Rationale:** why it was chosen, including user preference or evidence.
- **Implications:** affected scope, files, tests, docs, rollout, or risks.
- **Follow-ups:** any child questions unlocked by this answer.

Use the ledger to avoid re-asking, detect contradictions, and produce the final summary. Keep it in-conversation — do not write it to disk.

### 6. Summarize the clarified intent

End with a concise in-conversation handoff summary:

- **Goal:** the clarified outcome.
- **Settled decisions:** decisions with rationale.
- **Acceptance-criteria candidates:** observable checks that should appear in the next plan or ticket.
- **Non-goals / boundaries:** explicit scope limits.
- **Risks / edge cases:** material risks and chosen policies.
- **Assumptions:** only safe, non-blocking assumptions.
- **Recommended next step:** normally `Skill(plan)`; sometimes `/goal`, ticket creation, prototype, or direct implementation.

When the next step is planning, invoke it as `Skill(plan)` and offer a concrete suggested prompt, such as:

```text
Skill(plan): write an execution-ready plan from the clarified decisions above —
goal, settled decisions, acceptance-criteria candidates, non-goals, and risks.
```

## Quality rules

- Do not interrogate trivial implementation details that repo conventions already decide.
- Do not let plausible defaults hide user-owned decisions.
- Do not optimize for speed over alignment when the request is fuzzy.
- Do not leave contradictions unresolved; call them out and ask which source wins.
- Do not write a plan, design doc, or code unless the user explicitly switches to that step.
