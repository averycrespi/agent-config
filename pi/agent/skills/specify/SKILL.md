---
name: specify
description: Use when turning one bounded feature or other change into a durable behavioral contract with explicit scope, edge-case policies, constraints, and observable acceptance criteria before implementation planning.
---

# Specify

Create a durable specification for one bounded feature or change. Define what must be true without prescribing the implementation strategy.

A specification may inherit constraints from one Ready architecture or stand alone for smaller work. Do not write an implementation plan or change code while using this skill.

## Outcomes

Produce a specification that:

- Defines one coherent user-visible or system-observable outcome.
- Settles scope, behavior, domain semantics, failure policy, compatibility, and security constraints.
- Contains observable acceptance criteria that can serve as the downstream completion rubric.
- Links to its parent architecture when one exists and preserves inherited invariants.
- Fits one implementation plan without hiding independently valuable changes inside it.
- Has no blocking requirement questions when marked Ready.

## Process

Read [`../clarify/references/protocol.md`](../clarify/references/protocol.md) completely and apply it at specification scale.

### Establish the specification boundary

Restate the bounded outcome and identify its source:

- When an architecture is supplied, require its path under `.design/architectures/`, read it completely, confirm it is Ready, identify the relevant decomposition item, and inherit its constraints.
- For smaller standalone work, record that no parent architecture exists.
- Treat tickets, sketches, and prior conversations as inputs rather than settled specifications.

Use `architect` instead when unresolved choices can change system boundaries, component responsibilities, trust zones, major interfaces, deployment shape, or several independently implementable outcomes. If the requested specification cannot fit one coherent implementation plan, split the outcome through `architect` rather than writing an oversized spec.

### Research the existing behavior

Follow the protocol's research rules. Investigate:

- current user and system behavior,
- domain entities, state transitions, and data ownership,
- APIs, compatibility promises, and integration constraints,
- failure modes, security boundaries, and operational expectations,
- existing tests, documentation, and likely verification surfaces, and
- parent-architecture invariants and dependencies when applicable.

Research implementation context only far enough to make requirements realistic and verifiable. Do not turn source exploration into a file-by-file plan.

### Build the specification ambiguity map

Classify:

- **Outcome and actors:** target users or systems, problem, value, and success measure.
- **Scope:** included behavior, explicit non-goals, dependencies, rollout, and migration boundary.
- **Behavior and states:** workflows, inputs, outputs, transitions, empty/loading/error states, and concurrency.
- **Domain and data:** entities, identity, validation, lifecycle, retention, consistency, and ownership.
- **Interfaces and compatibility:** API behavior, events, protocols, versioning, and backwards compatibility.
- **Failure policy:** invalid input, conflicts, partial failure, retries, timeouts, degradation, and recovery.
- **Security and privacy:** authentication, authorization, sensitive data, permissions, and abuse cases.
- **Operational constraints:** performance, observability, support, accessibility, and localization when relevant.
- **Acceptance and verification:** observable criteria, realistic evidence, and documentation impact.
- **Architecture conformance:** inherited invariants, permitted variation, and dependencies.

Ask only questions whose answers can change required behavior, scope, policy, acceptance, or inherited constraints. Defer implementation strategy, file selection, task ordering, and local code mechanics to `plan`.

### Run the one-plan scope gate

Before writing, verify that the specification describes one coherent outcome that can be implemented and verified through one plan.

Split or escalate when:

- parts can deliver value independently,
- parts require materially different rollout or risk decisions,
- acceptance criteria divide into unrelated behavior groups, or
- a structural choice affects other specifications.

Do not split merely because several components or files will change.

### Write the durable specification

Save new specifications under `.design/specs/YYYY-MM-DD-<short-slug>.md`; update an existing specification only when it is already in that directory. Use repo-relative paths only. Do not write elsewhere. If the user requests canonical tracked requirements documentation, stop and route that to a separate documentation task; promotion is outside this skill.

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
  mkdir -p "$repo_root/.design/specs"
```

If the local exclude cannot be updated, stop and report the failure. After writing a new specification in a Git repository, verify it is ignored with `git check-ignore -q <spec-path>`.

Use this structure, adapting behavior sections to the change rather than leaving placeholders:

```md
# <Title> Specification

## Lineage

- Status: Ready
- Parent architecture: <path and decomposition ID, or None — standalone change>
- Supersedes: <path or None>

## Outcome

## Actors and Use Cases

## Scope

## Non-Goals

## Required Behavior

## States and Transitions

## Data and Interface Requirements

## Failure and Edge-Case Policies

## Security and Operational Constraints

## Compatibility and Migration

## Architecture Conformance

## Acceptance Criteria

- AC-1: <observable criterion and expected evidence>
- AC-2: <observable criterion and expected evidence>

## Dependencies

## Risks and Assumptions

## Documentation Impact

## Handoff to Planning
```

Acceptance criteria are the canonical downstream rubric. Give each criterion a stable ID, make it observable, and state expected evidence when it is not obvious.

A Ready specification must not contain `TBD`, `TODO`, or blocking requirement questions. If the user stops early, a saved artifact must say `Status: Draft` and list the blockers explicitly; `plan` must not consume it.

Hidden `.design/` artifacts are local workflow material. Promote behavior that becomes a canonical public or maintainer contract to the repository's tracked documentation during implementation.

### Challenge and hand off

For substantial or risky specifications, use `challenge` to test scope, edge cases, compatibility, failure policy, security, and acceptance criteria before marking the artifact Ready. Repair material findings without adding implementation choreography.

Summarize:

- specification path and status,
- parent architecture or standalone status,
- settled behavior and boundaries,
- acceptance criteria and material risks, and
- the exact recommended planning prompt:

```text
Use the plan skill to write an execution-ready plan from .design/specs/YYYY-MM-DD-<short-slug>.md.
```

Do not start planning unless the user explicitly asks.

## Quality rules

- Specify observable outcomes and policies, not code structure.
- Keep one Ready specification scoped to one active plan.
- Do not contradict a parent architecture silently; return to `architect` when an invariant must change.
- Do not let acceptance criteria collapse into vague quality statements.
- Do not mark the artifact Ready with unresolved requirement-owned decisions.
