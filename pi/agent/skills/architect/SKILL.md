---
name: architect
description: Use when defining or revising the high-level design, boundaries, quality attributes, major trade-offs, and specification decomposition of an entire system or cross-cutting feature before feature specifications are written.
---

# Architect

Create a high-level architecture that settles system-shape decisions and decomposes the intended outcome into independently specifiable slices.

Do not write feature specifications, implementation plans, or code while using this skill. If the request is one bounded change with no material system-shape decision, use `specify` instead.

## Outcomes

Produce an architecture that:

- Defines system boundaries, responsibilities, major interfaces, and cross-cutting constraints.
- Records structural decisions, alternatives, evidence, and material trade-offs.
- Covers security, operations, compatibility, migration, and recovery at the appropriate scale.
- Decomposes the design into at least two outcome-oriented specifications with explicit dependencies.
- Defers feature-level behavior to named specifications rather than silently deciding it.
- Is Ready for multiple `specify` runs without blocking architecture questions.

## Process

Read [`../clarify/references/protocol.md`](../clarify/references/protocol.md) completely and apply it at architecture scale.

### Establish the architecture scope

Restate the system or cross-cutting feature being designed. Identify existing architecture inputs, governing constraints, intended outcomes, and whether this work supersedes an earlier architecture.

Treat an architecture as warranted when at least one of these applies:

- Multiple independently implementable outcomes need a shared system shape.
- Component ownership, trust boundaries, major interfaces, or deployment topology must change.
- A cross-cutting quality such as security, reliability, performance, or compatibility drives the design.
- Migration, rollout, or build-versus-buy choices materially constrain several downstream changes.

If none applies and the outcome fits one coherent implementation plan, route to `specify`.

### Research the current system

Follow the protocol's research rules. For substantial work, investigate independent branches in parallel when possible:

- current components, entry points, boundaries, and conventions,
- data, control, trust, and deployment flows,
- operational, migration, compatibility, and failure constraints,
- external platform or standards constraints, and
- risks, alternatives, and likely specification seams.

Use repo-relative paths and URLs as evidence in the architecture when useful.

### Build the architecture ambiguity map

Classify:

- **Context and outcomes:** stakeholders, system purpose, success measures, non-goals.
- **Boundaries and ownership:** system boundary, actors, components, responsibilities, trust zones.
- **Data and control flow:** sources, sinks, identity, lifecycle, consistency, and state ownership.
- **Interfaces and integration:** contracts, protocols, dependencies, compatibility, and versioning.
- **Quality attributes:** security, privacy, reliability, performance, scalability, accessibility, and supportability.
- **Operations:** deployment, observability, failure isolation, recovery, and capacity constraints.
- **Migration and rollout:** coexistence, data migration, reversibility, and deprecation.
- **Trade-offs:** alternatives, rejected options, lock-in, cost, and future-change consequences.
- **Decomposition:** independently valuable specification slices, shared constraints, and dependencies.

Ask only questions whose answers can change the high-level design or decomposition. Explicitly defer detailed workflows, copy, validation rules, and other feature behavior to the appropriate specification unless they constrain architecture.

### Synthesize and challenge

Define the simplest architecture that satisfies the settled outcomes and quality attributes. Decompose by independently observable outcomes, not by internal component tasks.

For substantial or risky designs, use `challenge` to stress-test boundaries, trade-offs, failure modes, migration, and verification before marking the artifact Ready. Repair material findings without expanding into implementation planning.

### Write the durable architecture

Save new architectures under `.design/architectures/YYYY-MM-DD-<short-slug>.md`; update an existing architecture only when it is already in that directory. Use repo-relative paths only. Do not write elsewhere. If the user requests canonical tracked architecture documentation, stop and route that to a separate documentation task; promotion is outside this skill.

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
  mkdir -p "$repo_root/.design/architectures"
```

If the local exclude cannot be updated, stop and report the failure. After writing a new architecture in a Git repository, verify it is ignored with `git check-ignore -q <architecture-path>`.

Use this structure, omitting inapplicable detail rather than leaving placeholders:

```md
# <Title> Architecture

## Lineage

- Status: Ready
- Supersedes: <path or None>

## Context and Intended Outcomes

## Goals and Non-Goals

## Constraints and Quality Attributes

## System Boundaries

## Components and Responsibilities

## Data and Control Flows

## Interfaces and Integration Boundaries

## Security and Operational Model

## Key Decisions and Alternatives

## Migration and Rollout

## Risks and Mitigations

## Architecture Invariants

## Specification Decomposition

- S1: <outcome-oriented specification, boundary, inherited constraints, and dependencies>
- S2: <another independently specifiable outcome and its dependencies>

## Deferred to Specifications

## Handoff
```

A Ready architecture must define at least two independently bounded specification slices. It may defer decisions owned by those named specifications, but it must not contain blocking system-shape questions. If only one coherent slice remains, route it to `specify` instead of finalizing an architecture. If the user stops early, a saved artifact must say `Status: Draft` and list the blocking architecture decisions explicitly; `specify` must not treat it as authoritative.

Hidden `.design/` artifacts are local workflow material. When an architecture becomes canonical project knowledge, promote the relevant decisions to the repository's tracked architecture documentation or ADRs.

### Hand off

Summarize:

- architecture path and status,
- major decisions and trade-offs,
- specification decomposition and dependency order,
- architecture-level risks, and
- the first recommended `specify` prompt.

Do not continue into specification or planning unless the user explicitly asks.

## Quality rules

- Keep architecture high-level enough to support multiple specifications.
- Do not create one specification per component; decompose by observable outcomes.
- Do not hide system-shape decisions in downstream assumptions.
- Do not prescribe file-level tasks, exact diffs, or test commands.
- Do not mark the artifact Ready with unresolved architecture-owned decisions.
