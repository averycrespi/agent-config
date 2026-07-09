---
name: clarify
description: Use when requirements, scope, product behavior, edge-case policy, acceptance criteria, or design intent are fuzzy and need an interview before planning or implementation.
---

# Clarify

Run a focused clarification interview until the user's intent is explicit enough to plan or implement without silently inventing user-owned decisions.

Do not write an implementation plan or change code while using this skill. Stop after summarizing settled decisions, open non-blocking assumptions, and the recommended next step.

## Outcomes

Produce a shared understanding that:

- Makes product, UX, scope, edge-case, security, data, and verification decisions explicit.
- Separates evidence-backed facts from user-owned choices.
- Converts vague goals into observable acceptance criteria candidates.
- Leaves no blocking ambiguity for the next `plan`, `/goal`, ticket, or implementation step.
- Avoids batching a long questionnaire; decisions are resolved one dependency at a time.

## Process

### 1. Establish the starting point

Restate the goal in one or two sentences. Identify what is already known from the user's request and what kind of artifact or action likely comes next, such as a `.plans/` handoff, Jira ticket, prototype, bugfix, refactor, or direct implementation.

If the user supplied a plan, spec, ticket, design sketch, or prior conversation context, treat it as input to clarify, not as settled truth.

### 2. Research answerable questions first

Before asking, gather enough evidence to avoid wasting the user's attention.

Use whichever sources apply:

- **Codebase:** read `AGENTS.md`, `CLAUDE.md`, `README.md`, design docs, existing `.plans/`, relevant source files, tests, configs, and nearby conventions.
- **Subagents:** for substantial or unfamiliar repo questions, run independent read-only subagents in parallel whenever possible to localize files, discover conventions, identify risks, or summarize external docs. Use one `spawn_agents` call for all independent research branches instead of serial subagent calls.
- **Web:** use web research when behavior depends on current external APIs, libraries, standards, or public examples.
- **Memory:** use Hindsight per `AGENTS.md` when prior preferences, repo history, recurring decisions, or external context may matter.

If research proves an answer, do not ask the user. If research only suggests a plausible default for a user-owned decision, ask with that default as the recommendation.

### 3. Build a private ambiguity map

Scan for unresolved decisions across this taxonomy. Mark each category internally as Clear, Partial, Missing, or Not Applicable:

- **Goal and success:** target user, problem, success criteria, expected outcome.
- **Scope boundaries:** in-scope behavior, non-goals, migration or rollout boundaries.
- **Product / UX behavior:** workflows, user-visible states, empty/error/loading behavior, accessibility or localization expectations.
- **Domain and data:** entities, identity rules, lifecycle/state transitions, retention, volume, ownership.
- **Integration and compatibility:** external services, APIs, protocols, backwards compatibility, dependency constraints.
- **Failure handling:** negative cases, retries, conflicts, partial failure, rate limits, degradation.
- **Security and privacy:** authN/Z, sensitive data, permissions, compliance, abuse cases.
- **Operational concerns:** performance, observability, deployability, support/debugging needs.
- **Acceptance and verification:** observable acceptance criteria, tests, manual checks, evidence expected at completion.
- **Terminology:** canonical names, overloaded words, domain conflicts.

For each Partial or Missing category, decide whether the gap is:

- answerable by more research,
- a material user-owned decision,
- safe to record as a non-blocking assumption, or
- out of scope.

A safe assumption must be low-impact, reversible, and not user-visible. Do not assume scope, UX, acceptance criteria, security posture, data semantics, or risk tolerance when multiple reasonable options exist.

### 4. Ask one decision-tree question at a time

Ask exactly one focused question, wait for the answer, then decide the next question based on that answer. Never dump a batch of questions.

Question rules:

- Walk down the dependency tree: settle parent decisions before child details.
- Prefer the highest `impact × uncertainty` question first.
- Ask questions only when the answer materially changes scope, architecture, task breakdown, tests, UX behavior, operational readiness, risk, or acceptance criteria.
- For multiple valid options, prefer `ask_user` with 2–5 options.
- Put the recommended option first, with a brief reason.
- Include a concise fallback such as "accept the recommendation" so the user can answer quickly.
- For short-answer questions, constrain the answer shape, such as "Answer in <=5 words".
- If the user's answer is ambiguous, ask a quick disambiguation before moving on; do not count that as a new branch.

Default question format:

```text
Recommended: <answer> — <one-sentence reason>.
Question: <single decision to resolve?>
Options: <2-5 choices, or a short-answer constraint>
```

Keep asking until every material user-owned decision is resolved, explicitly deferred, or intentionally out of scope. For substantial fuzzy tasks, ask at least one user-owned clarification question unless research proves all high-impact categories are clear.

Stop early only when:

- no material ambiguities remain,
- the user says to stop, proceed, or accept defaults,
- the remaining gaps are safe non-blocking assumptions, or
- the conversation is better continued by writing a plan or ticket from the settled decisions.

### 5. Maintain a living decision ledger

After each accepted answer, update the internal decision ledger:

- **Decision:** the clarified choice.
- **Rationale:** why it was chosen, including user preference or evidence.
- **Implications:** affected scope, files, tests, docs, rollout, or risks.
- **Follow-ups:** any child questions unlocked by this answer.

Use the ledger to avoid re-asking, detect contradictions, and produce the final summary.

If the clarification session is long or the user asks for durable notes, write or update an appropriate existing artifact only when explicitly useful, such as clarification notes, a ticket draft, ADR, or project context doc. Otherwise keep `clarify` stateless.

### 6. Summarize the clarified intent

End with a concise handoff summary:

- **Goal:** the clarified outcome.
- **Settled decisions:** bullet list of decisions and rationale.
- **Acceptance criteria candidates:** observable checks that should appear in the next plan or ticket.
- **Non-goals / boundaries:** explicit scope limits.
- **Risks / edge cases:** material risks and chosen policies.
- **Assumptions:** only safe, non-blocking assumptions.
- **Recommended next step:** usually `plan`, `/goal`, ticket creation, prototype, or implementation.

If the next step is `plan`, recommend a concrete prompt such as:

```text
Use the plan skill to write an execution-ready plan from the clarified decisions above.
```

## Quality rules

- Do not interrogate trivial implementation details that repo conventions can decide.
- Do not let plausible defaults hide user-owned decisions.
- Do not optimize for speed over alignment when the request is fuzzy.
- Do not leave contradictions unresolved; call them out and ask which source wins.
- Do not write a full plan unless the user explicitly switches to planning.
