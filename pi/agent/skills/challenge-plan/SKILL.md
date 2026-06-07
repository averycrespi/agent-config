---
name: challenge-plan
description: Use when stress-testing, challenging, reviewing, repairing, or grilling a plan before execution.
---

# Challenge Plan

Stress-test a plan before execution. Optimize for finding material problems early, not for producing a long review.

## Core rule

Challenge the plan against the user's goal, acceptance criteria, repo reality, verification path, and autonomous handoff readiness. Report meaningful blockers and risks only. Do not nitpick wording or invent theoretical issues.

## Process

### 1. Read the plan and context

Read the referenced plan or plan-like artifact. If no plan path is provided, identify the relevant plan from the conversation or ask for it.

Then gather only the repo context needed to judge the plan:

- relevant `.plans/*.md` files
- acceptance criteria or issue text
- files named in the plan
- nearby implementation patterns
- tests, docs, or config that the plan depends on

If a claim can be checked in the repo, check it instead of asking the user. If the plan was produced by the `plan` skill and already includes research evidence, reuse that evidence instead of duplicating work unless something looks stale, missing, or contradictory.

### 2. Use read-only challengers when useful

For non-trivial plans, prefer `spawn_agents` with read-only review or exploration agents. When independent checks can run concurrently, spawn them in one parallel `spawn_agents` call instead of serial calls. Ask challengers to evaluate the plan against this rubric:

- Does the plan satisfy every acceptance criterion?
- Are success criteria observable and testable?
- Does the plan conflict with current repo structure, conventions, or constraints?
- Are assumptions hidden, stale, or unverified?
- Are tasks ordered so dependencies come before dependents?
- Are tasks vertical and independently verifiable where possible?
- Is verification strong enough to catch likely failures?
- Is scope too broad, speculative, or missing an explicit out-of-scope boundary?
- Are documentation or migration impacts missing?
- Is the plan executable by a fresh autonomous agent, such as a `/goal` run, without requiring more user decisions?
- Are blocking open questions absent, with only safe non-blocking assumptions remaining?
- Does the handoff summary or equivalent section include a clear implementation objective and concrete completion evidence expectations?

Keep subagent prompts read-only. Ask for evidence-backed findings, not edits.

### 3. Report findings by actionability

Return a concise challenge report:

1. **Blockers** — issues that should be resolved before execution
2. **Risks** — plausible failure modes worth addressing or accepting
3. **Questions** — human decisions needed to proceed
4. **Handoff readiness** — whether the plan is ready for autonomous execution, especially via `/goal`, and what must change before handoff
5. **Suggested plan edits** — concrete changes, grouped by plan section

For each finding, include why it matters and the evidence. If no material issues are found, say the plan is ready enough to execute and list any residual uncertainty.

### 4. Ask one question at a time

If human input is needed, ask one focused question at a time. Include the recommended answer. Resolve upstream decisions before downstream details.

Use `ask_user` when there are multiple valid choices with different trade-offs.

### 5. Revise only when asked or clearly in Plan mode

Do not edit the plan by default. If the user asks for revisions, or if the current Plan-mode task is explicitly to repair the plan, update the plan with the available plan-editing tools.

Keep revisions minimal. Preserve good plan structure. Do not turn a plan into a line-by-line diff; plans should capture intent, constraints, acceptance criteria, implementation notes or task groups, documentation impact, verification, risks, assumptions, and handoff guidance.
