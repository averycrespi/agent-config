---
name: plan
description: Use when turning one Ready specification into an execution-ready implementation plan that a fresh coding agent can complete autonomously, especially before running /goal.
---

# Plan

Create an execution-ready implementation plan from exactly one Ready specification. Optimize for a durable handoff that a fresh agent can implement autonomously and verify against the specification's acceptance criteria.

Do not implement the plan while using this skill. Stop after writing or updating the plan and summarizing the handoff.

If no Ready specification exists, use `specify` first. If planning reveals a missing requirement, return to `specify`; if it reveals a conflict in system boundaries or architecture invariants, return to `architect`. Do not invent upstream decisions to keep planning moving.

## Outcomes

Produce a plan that:

- Links to one Ready source specification and preserves its acceptance criteria as the canonical rubric.
- Maps every acceptance criterion to implementation intent and concrete verification.
- Captures the chosen implementation approach, constraints, risks, affected repo areas, and documentation impact.
- Includes enough evidence and repository context for a fresh engineer or `/goal` run.
- Avoids line-by-line implementation choreography; the implementer owns local coding choices.
- Has no blocking questions and does not contradict its specification or parent architecture.

## Process

### 1. Validate the source specification

Read the source specification completely. Confirm that:

- exactly one source path resolves under `.design/specs/`,
- its lineage says `Status: Ready`,
- it describes one coherent outcome,
- its acceptance criteria have stable IDs and observable evidence,
- it has no `TBD`, `TODO`, or blocking requirement questions, and
- any parent architecture resolves under `.design/architectures/`, is Ready, and has its relevant invariants represented.

Stop and use `specify` when requirement behavior, scope, failure policy, acceptance, or compatibility remains unresolved. Stop and use `architect` when the conflict affects system boundaries, responsibilities, trust zones, major interfaces, deployment shape, or multiple specifications.

One plan consumes exactly one specification. If the source combines unrelated outcomes, repair or split the specification rather than producing several plans from it.

### 2. Research before asking

Gather the implementation evidence needed to plan accurately. For non-trivial work, dispatch independent read-only research branches in one parallel call when possible.

Use whichever sources apply:

- **Codebase:** read repository instructions, the source specification and parent architecture, relevant source, tests, configuration, tracked documentation, and nearby conventions.
- **Subagents:** use read-only exploration for localization, convention discovery, risk review, and external-doc research.
- **Web:** research current APIs, libraries, standards, and examples when they constrain implementation.
- **Memory:** use configured memory tools when prior decisions or preferences may matter.

Default research bundle for substantial work:

- **Code and conventions:** entry points, likely files, existing patterns, tests, and docs.
- **Risk and edge cases:** implementation failure modes, migration hazards, security concerns, and difficult acceptance criteria.
- **External constraints:** current library or platform behavior with cited URLs when relevant.

Do not ask questions that repository or external evidence can answer.

### 3. Synthesize the implementation shape

Determine:

- what behavior changes and what remains invariant,
- which repository areas and conventions govern the work,
- which implementation choices materially affect correctness or maintainability,
- how each source acceptance criterion will be achieved,
- which deterministic and manual checks can prove each criterion,
- what documentation or migration work is required, and
- which risks need mitigation or explicit acceptance.

Planning may resolve local technical choices from evidence. Ask at most one focused question at a time when a material implementation trade-off genuinely depends on user preference. More than one or two upstream questions means the source specification or architecture is not Ready; return to the owning skill.

Only encode an assumption when it is low-impact, reversible, non-user-visible, and safe for an implementer to rely on. Never assume requirement behavior, scope, acceptance, security posture, data semantics, architecture boundaries, or risk tolerance.

### 4. Write the durable plan

Save new plans under `.design/plans/YYYY-MM-DD-<short-slug>.md`; update an existing plan only when it is already in that directory. Use repo-relative paths only. Do not write elsewhere. If the user requests a canonical tracked implementation document, stop and route that to a separate documentation task; promotion is outside this skill.

Inside a Git repository, add the root-anchored `/.design/` pattern to the repository's local Git exclude file when absent. Do not add it to tracked `.gitignore`:

```bash
if repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  exclude_path="$(git rev-parse --path-format=absolute --git-path info/exclude)" &&
    mkdir -p "$(dirname "$exclude_path")" &&
    touch "$exclude_path" &&
    { grep -qxF '/.design/' "$exclude_path" ||
      printf '\n/.design/\n' >> "$exclude_path"; }
else
  repo_root="$(pwd -P)"
fi &&
  mkdir -p "$repo_root/.design/plans"
```

If the local exclude cannot be updated, stop and report the failure. After writing a new plan in a Git repository, verify it is ignored with `git check-ignore -q <plan-path>`.

There must be only one active Ready plan for a specification. When replacing a plan, link the previous path under `Supersedes` and make the replacement relationship explicit in the handoff.

For small mechanical work, simplify the template while preserving Lineage, Goal, Acceptance Criteria, Acceptance Criteria Coverage, Documentation Impact, Verification, and Handoff. For substantial work, use:

```md
# <Short Title> Plan

## Lineage

- Status: Ready
- Source specification: `.design/specs/<file>.md`
- Parent architecture: <path or None>
- Supersedes: <path or None>

## Goal

<One or two sentences describing the source specification's outcome.>

## Background and Repository Context

- <Relevant conventions, architecture, existing patterns, files, and evidence.>

## Acceptance Criteria

- AC-1: <copy the source criterion without changing its meaning>
- AC-2: <copy the source criterion without changing its meaning>

## Non-Goals and Constraints

## Chosen Approach

## Design Decisions

## Implementation Notes

- <Relevant files or areas, dependencies, sequencing constraints, patterns, and gotchas.>

## Acceptance Criteria Coverage

| Criterion | Implementation intent      | Verification                                  |
| --------- | -------------------------- | --------------------------------------------- |
| AC-1      | <how the plan achieves it> | <test, command, artifact, or manual evidence> |

## Documentation Impact

## Testing and Verification

## Risks and Mitigations

## Assumptions

## Handoff Summary
```

Copy acceptance criteria faithfully from the source specification so the plan remains a self-contained `/goal` handoff. If implementation research proves a criterion incorrect or unverifiable, repair the specification instead of silently rewriting it in the plan.

Plan quality rules:

- Every source acceptance criterion must appear in both `Acceptance Criteria` and `Acceptance Criteria Coverage`.
- Verification must map to acceptance criteria and state expected results.
- Documentation impact must be an explicit decision.
- Include enough context to survive a fresh session without pasting unnecessary code.
- Prefer implementation intent over exact diffs.
- Do not leave `TBD`, `TODO`, blocking questions, or requirement inventions.
- Apply YAGNI and avoid speculative follow-on work.

Hidden `.design/` artifacts are local workflow material. The implementation must update tracked project documentation when the specification changes a canonical contract.

The plan should support a handoff such as:

```text
/goal Implement .design/plans/YYYY-MM-DD-<short-slug>.md. Complete only after every acceptance criterion is satisfied with concrete evidence.
```

### 5. Challenge before finalizing when risk is non-trivial

For substantial or risky plans, use `challenge` after the draft is concrete. Stress-test:

- source-criterion coverage,
- conformance to the specification and parent architecture,
- repository conventions and constraints,
- edge cases, failure modes, migration, and security,
- scope and documentation impact, and
- autonomous handoff readiness.

Repair material findings before marking the plan Ready. Do not add implementation choreography merely to make the plan longer.

### 6. Summarize and hand off

Give the user:

- plan path and Ready status,
- source specification and parent architecture,
- chosen approach and key decisions,
- acceptance-criterion coverage summary,
- residual non-blocking assumptions, and
- the suggested `/goal` command.

Do not start execution unless the user explicitly asks.
