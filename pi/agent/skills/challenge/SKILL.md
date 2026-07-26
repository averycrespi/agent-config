---
name: challenge
description: Use when stress-testing a concrete plan, proposal, design, architecture decision, or implementation approach before implementation. Challenges material assumptions, failure modes, alternatives, and evidence gaps; use review for completed changes.
---

# Challenge

Stress-test a concrete proposed approach before implementation. Optimize for finding material reasons to revise, investigate, or explicitly accept risk, not for producing dissent or a long critique.

## Core rule

Challenge only claims that, if false, would change whether to proceed, what to build, or how success will be proven.

Make every finding constructive: name the challenged claim, a concrete failure scenario, the supporting evidence, the consequence, and a recommended resolution or mitigation. Validate strong proposals when the evidence supports them. Target the artifact, never the person.

## Boundaries

Use this skill for concrete pre-implementation artifacts or decisions, including plans, proposals, specifications with a proposed approach, designs, architecture decisions, and implementation strategies.

Route adjacent work deliberately:

- Use `clarify` when the desired outcome or user-owned requirements are still fuzzy.
- Use `plan` when no concrete approach exists yet or the task is to create one.
- Use `review` for completed code, diffs, branches, pull requests, or implementation behavior. Do not use `challenge` as a substitute for post-implementation review.

Do not impersonate every domain specialist. Identify when security, infrastructure, legal, data, or other specialist review is warranted, and explain the material concern that justifies it.

## Process

### 1. Establish the target and stakes

Read the referenced artifact or identify the concrete approach from the conversation. Establish:

- the decision being tested
- the intended outcome and success criteria
- the governing constraints
- the implementation state
- the impact, reversibility, uncertainty, and blast radius

Ask for the artifact or decision only when it cannot be recovered from context. If a claim can be checked through repository or external evidence, investigate instead of asking.

Gather only the context needed to test material claims, such as repository instructions, relevant source and tests, existing architecture, documentation, configuration, requirements, tickets, prior plans, and current external documentation. Reuse cited research unless it appears stale, incomplete, or contradictory.

### 2. Calibrate the challenge

Match depth to the stakes:

- **Low stakes and easily reversible:** use a light pass focused on major blind spots.
- **Moderate stakes or effort:** run a focused assumption audit and pre-mortem.
- **High stakes, difficult rollback, security, data, migration, or compatibility impact:** investigate deeply and identify any specialist validation needed.

For substantial challenges, prefer one parallel `spawn_agents` call with independent read-only exploration or challenge agents. Request concise, evidence-backed findings rather than edits.

### 3. Steel-man briefly

Restate the proposal and its rationale fairly before criticizing it. Name genuine strengths or evidence in its favor. Keep this brief when the proposal is straightforward; the purpose is to prevent straw-manning, not to add ceremony.

### 4. Apply relevant challenge lenses

Use only lenses that could change the decision:

- **Assumption audit:** Find high-impact assumptions with weak or uncertain evidence.
- **Pre-mortem:** Assume the proposal failed and work backward to the likely cause, missed warning signs, and cascading effects.
- **Inversion:** Test a simpler, opposite, existing, or do-nothing alternative when it exposes a hidden constraint or unjustified choice.
- **Second-order effects:** Trace operational, maintenance, compatibility, organizational, and future-change consequences.
- **Reversibility:** Examine rollback, migration, lock-in, and recovery paths.
- **Evidence audit:** Verify material claims against current repository or external reality.
- **Verification audit:** Determine whether success and failure will be observable.

Apply artifact-specific checks when relevant:

- **Plans:** acceptance-criteria coverage, dependency ordering, scope boundaries, verification, documentation and migration impact, unresolved decisions, and autonomous handoff readiness.
- **Designs and architecture:** boundaries, trade-offs, failure modes, compatibility, security, operations, recovery, and maintainability.
- **Proposals and decisions:** objective fit, alternatives, opportunity cost, success measures, exit criteria, and the cost of doing nothing.

### 5. Classify and resolve findings

Report only material findings:

- **Blocker:** Must be resolved before proceeding.
- **Risk:** Can be mitigated or accepted explicitly.
- **Evidence gap:** Requires investigation before confidence is justified.
- **Decision needed:** Requires a user-owned choice.

Resolve evidence-checkable questions through investigation. For a plan deficiency, identify the exact repair needed. Record acceptable uncertainty as a risk with a mitigation, owner, or trigger. Ask the user only about genuinely blocking user-owned decisions.

### 6. Report the outcome

Use this compact structure and omit empty sections:

```md
## Challenge framing

**Decision:** …
**Stakes:** …
**Steel-man:** …

## Material findings

### [Blocker | Risk | Evidence gap] — <summary>

- **Claim challenged:** …
- **Failure scenario:** …
- **Evidence:** …
- **Consequence:** …
- **Recommendation:** …

## Decision needed

<One focused question and recommended answer.>

## Verdict

**<Ready to proceed | Proceed with mitigations | Revise before proceeding | Investigate before deciding>**

**Next action:** …
```

Use exactly one verdict:

- **Ready to proceed:** No material unresolved concern remains.
- **Proceed with mitigations:** Remaining risks have concrete safeguards or explicit acceptance.
- **Revise before proceeding:** The approach has blockers or material deficiencies.
- **Investigate before deciding:** Evidence is insufficient to choose or validate the approach.

Include autonomous handoff readiness only when challenging an executable implementation plan. If no material findings remain, say so directly and note only meaningful residual uncertainty.

### 7. Ask one question at a time

When human input is required, ask one focused question at a time and recommend an answer. Resolve upstream decisions before downstream details. Use `ask_user` when multiple valid options have materially different trade-offs.

### 8. Revise only when asked

Do not edit the challenged artifact by default. If revision is requested, make the smallest changes needed to address the findings or hand plan creation and repair back to `plan`. Preserve sound decisions and avoid turning a plan or design into a line-by-line implementation script.

## Anti-patterns

Avoid:

- contrarianism for its own sake
- enumerating every theoretical assumption
- vague warnings without a concrete failure scenario
- inflating severity to appear rigorous
- reopening settled constraints without contradictory evidence
- objecting without a mitigation, alternative, or investigation path
- treating pre-implementation challenge as post-implementation review
