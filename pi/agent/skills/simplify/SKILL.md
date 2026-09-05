---
name: simplify
description: Use when explicitly asked to stress-test a concrete specification, plan, design, proposal, or implementation approach for unnecessary scope, complexity, ceremony, or prescription before execution.
disable-model-invocation: true
---

# Simplify

Stress-test a concrete pre-implementation artifact by finding what can be removed, merged, or deferred without weakening its required outcome. Keep this skill explicit-only; invoke it with `/skill:simplify` and identify the artifact or approach to assess.

## Core rule

Preserve required outcomes, acceptance criteria, constraints, and material safeguards. Remove everything that does not help achieve or verify them.

Do not optimize for brevity alone. Optimize for the smallest artifact and approach that remain correct, verifiable, and safe.

## Boundaries

Use this skill for specifications, plans, designs, architecture decisions, proposals, and implementation approaches that are concrete enough to assess.

Route adjacent work deliberately:

- Use `clarify` when the desired outcome or governing requirements remain unclear.
- Use `challenge` when the primary question is what could materially fail.
- Use `review` for completed code or behavior.
- Clarify material requirement or system-boundary changes before revision; use `shape-ticket` when the target is a Plane delivery contract. Revise other artifacts directly only when authorized.

Do not create a replacement artifact or edit the target unless explicitly asked.

## Process

### 1. Establish the preservation baseline

Read the target and its governing inputs. Identify:

- the required outcome;
- acceptance criteria and success evidence;
- explicit scope and non-goals;
- inherited architecture, compatibility, security, and operational constraints; and
- repository evidence that materially constrains the approach.

Treat these as protected unless they conflict or remain genuinely unresolved. Do not reopen settled decisions merely because a simpler product could exist.

### 2. Build a traceability test

For each material requirement, section, task, milestone, component, abstraction, dependency, configuration surface, migration step, and verification activity, ask what justifies it.

An item earns its place only when it traces to at least one of:

- an acceptance criterion or explicit requested outcome;
- an inherited or repository constraint;
- current repository evidence;
- a concrete, material failure mode; or
- evidence needed to prove completion.

Treat “might be useful,” generic best practice, hypothetical future reuse, and unsupported edge cases as insufficient justification.

### 3. Apply the relevant simplification lenses

Use only lenses relevant to the target:

- **Scope:** Remove behavior, policy, rollout, migration, or follow-up work not required now.
- **Structure:** Remove layers, components, interfaces, dependencies, and abstractions that existing patterns or direct code can handle.
- **Configurability:** Prefer fixed behavior when no current variation requirement exists.
- **Decomposition:** Merge milestones or tasks that share a dependency boundary, outcome, and verification gate.
- **Prescription:** Remove file-by-file or line-by-line choreography that a competent implementer should decide from local context.
- **Verification:** Remove duplicate checks and checks that prove no acceptance criterion; retain the narrowest sufficient evidence.
- **Duplication:** Consolidate repeated requirements, rationale, risks, and implementation notes without losing their canonical source.
- **Speculation:** Defer extensibility, optimization, integrations, and operational machinery unsupported by present evidence.

Artifact-specific emphasis:

- **Specifications:** protect observable behavior and policies; remove implementation strategy and hypothetical requirements.
- **Plans:** protect acceptance-criterion coverage and executable gates; reduce milestone, task, abstraction, and file-list inflation.
- **Designs:** protect system invariants and quality attributes; remove unjustified components, indirection, and future-proofing.
- **Proposals:** protect the decision and success measure; remove optional benefits and unsupported solution scope.

### 4. Classify candidate changes

Classify each material candidate:

- **Remove:** unsupported, redundant, or irrelevant.
- **Merge:** justified but unnecessarily fragmented or repeated.
- **Defer:** plausible future work that is not required for the current outcome.
- **Keep:** complexity that is necessary and might otherwise look removable.

Prioritize high-leverage reductions. Do not enumerate cosmetic edits unless they obscure intent or execution.

For every recommended reduction, state:

- the exact target;
- why its justification is insufficient;
- what protected outcome or criterion remains satisfied; and
- the smallest concrete repair.

### 5. Check against underengineering

Before reporting, verify that the simplified shape still:

- covers every acceptance criterion;
- preserves security, privacy, compatibility, data-integrity, and recovery safeguards that address real risks;
- retains enough context for its intended consumer;
- has deterministic or observable completion evidence; and
- does not hide unresolved requirements behind “YAGNI.”

If simplification would require changing a protected requirement, classify it as a requirement decision rather than a recommendation.

### 6. Report compactly

Use this structure and omit empty sections:

```md
## Simplification baseline

**Target:** …
**Protected:** …

## Recommended reductions

### [Remove | Merge | Defer] — <target>

- **Why:** …
- **Preserves:** …
- **Repair:** …

## Complexity to keep

- <Necessary item and its justification>

## Verdict

**<Already minimal | Simplify before proceeding | Requirements need clarification>**

**Next action:** …
```

Use exactly one verdict:

- **Already minimal:** No material reduction is justified.
- **Simplify before proceeding:** One or more reductions preserve the protected baseline.
- **Requirements need clarification:** Simplification depends on an unresolved requirement-owned decision.

If explicitly asked to revise the artifact, make only the accepted reductions, preserve its lineage and status rules, and run any existing structural validator or focused checks before reporting completion.

## Anti-patterns

Avoid:

- replacing evidence-backed safeguards with optimism;
- treating line count as the objective;
- proposing a different product instead of simplifying the requested one;
- inventing new edge cases while auditing speculative scope;
- adding abstractions to make the artifact appear cleaner;
- turning every observation into a finding;
- rewriting sound content when a small deletion or merge is sufficient; and
- declaring complexity unnecessary without showing that protected outcomes remain covered.
