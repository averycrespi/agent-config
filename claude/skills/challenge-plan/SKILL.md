---
name: challenge-plan
description: Use when stress-testing, challenging, reviewing, or repairing a plan before execution, especially before an autonomous /goal run.
---

# Challenge Plan

Stress-test a plan before execution. Optimize for finding material problems early, not for producing a long review.

Sits between `Skill(plan)` and `/goal`: the plan skill produces a plan, this skill grills it, and `/goal` executes it autonomously once it passes.

**Announce at start:** "I'm using the challenge-plan skill to stress-test this plan."

## Core rule

Challenge the plan against the user's goal, acceptance criteria, repo reality, verification path, and autonomous handoff readiness. Report meaningful blockers and risks only. Do not nitpick wording or invent theoretical issues.

## Process

### 1. Read the plan and context

Read the referenced plan or plan-like artifact. If no plan path is provided, identify the relevant plan from the conversation or ask for it (usually a `.plans/*.md` file).

Then gather only the repo context needed to judge the plan:

- the plan file itself, and any linked `.designs/*.md` spec it implements
- acceptance criteria or issue text it references
- files named in the plan
- nearby implementation patterns
- tests, docs, or config the plan depends on

If a claim can be checked in the repo, check it instead of asking the user. If the plan already includes research evidence (from the `plan` skill or elsewhere), reuse that evidence instead of re-deriving it — only re-verify a claim if it looks stale, missing, or contradicted by what you see in the repo.

### 2. Use read-only challengers when useful

For non-trivial plans, dispatch read-only Task subagents as challengers instead of reviewing everything alone. Use `Explore` for pure location/verification lookups (e.g. "does this file/function still look like the plan assumes?") and `general-purpose` for challengers that need to reason about trade-offs or cross-reference multiple files. When independent checks can run concurrently, launch them as multiple `Agent` tool calls in a single message rather than one at a time.

Ask each challenger to evaluate the plan against this rubric:

1. **Acceptance-criteria coverage** — does the plan satisfy every acceptance criterion?
2. **Observable/testable criteria** — are success criteria observable and testable, not vague?
3. **Conflicts with repo reality** — does the plan conflict with current repo structure, conventions, or constraints?
4. **Hidden or stale assumptions** — are assumptions hidden, stale, or unverified?
5. **Task ordering/dependencies** — are tasks ordered so dependencies come before dependents, and are they vertical and independently verifiable where possible?
6. **Verification strength** — is verification strong enough to catch likely failures?
7. **Scope bounding** — is scope too broad or speculative, or missing an explicit out-of-scope boundary?
8. **Docs/migration impact** — are documentation or migration impacts missing?
9. **Autonomous executability** — is the plan executable by a fresh autonomous agent under a `/goal` run, without requiring more user decisions mid-flight?
10. **No blocking open questions** — are blocking open questions absent, with only safe non-blocking assumptions remaining?
11. **Handoff completeness** — does the plan's handoff or summary section state a clear implementation objective and concrete completion evidence expectations?

Keep subagent prompts read-only — they must not edit the plan or repo. Ask for evidence-backed findings (file paths, line numbers, quotes), not opinions or edits.

### 3. Report findings by actionability

Return a concise challenge report in the conversation:

1. **Blockers** — issues that should be resolved before execution
2. **Risks** — plausible failure modes worth addressing or explicitly accepting
3. **Questions** — human decisions needed to proceed
4. **Handoff readiness** — whether the plan is ready for autonomous execution via `/goal`, and what must change before handoff if not
5. **Suggested plan edits** — concrete changes, grouped by plan section

For each finding, include why it matters and the evidence behind it. If no material issues are found, say the plan is ready enough to execute and list any residual uncertainty.

### 4. Ask one question at a time

If human input is needed, use `AskUserQuestion` and ask one focused question at a time. Label the recommended option "(Recommended)". Resolve upstream decisions (does the approach hold?) before downstream details (does this one task need a tweak?).

### 5. Revise only when asked or clearly in Plan mode

Do not edit the plan by default. If the user explicitly asks for revisions, or the current Plan-mode task is to repair the plan, update the plan file directly.

Keep revisions minimal. Preserve good plan structure. Do not turn a plan into a line-by-line diff — plans should still read as intent and constraints: acceptance criteria, task breakdown, documentation impact, verification, risks, assumptions, and handoff guidance.

## After the challenge

- **Blockers or unresolved questions remain:** hand back to `Skill(plan)` (or the user) to repair the plan, then re-run challenge-plan before proceeding to `/goal`.
- **Plan is ready:** tell the user it's ready for autonomous execution and that `/goal` can run it.
