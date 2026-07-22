---
name: visualize-plan
description: Use when turning an implementation, project, roadmap, or migration plan into a visual HTML document for easier human review.
---

# Visualize Plan

## Purpose

Transform a plan into a standalone HTML document that helps humans understand, critique, and approve the work. Preserve the plan's substance, but do not merely reformat Markdown into HTML. Use visual structure, diagrams, timelines, dependency maps, risk views, and review affordances when they make the plan easier to evaluate.

## Required dependency

Before building the HTML, load `Skill(create-html-artifact)` and follow it for:

- standalone HTML constraints (single file, no build step, dependency policy)
- accessibility and responsive behavior
- CSS, JavaScript, and styling discipline
- privacy and source-grounding rules
- validation and final-reporting requirements

Use this skill for the layer on top of that workflow:

- plan-specific interpretation
- choosing review-oriented visual aids
- preserving plan facts
- surfacing risks, dependencies, assumptions, and decisions

If the finished document should get a shareable link rather than stay a local file, publish it with the `Artifact` tool after building it (load the `artifact-design` skill first, as `create-html-artifact` and `Artifact` direct). Otherwise write it to disk as a normal file — publishing is optional, not the default.

## When to use

Use this skill when the user asks to:

- visualize a plan
- make a plan easier to review
- turn a plan into an HTML document or artifact
- create a visual execution plan
- make a roadmap, implementation plan, rollout plan, migration plan, or design plan more understandable

Do not use this skill for ordinary Markdown cleanup, final documentation, or plans that need to remain primarily coauthored in source form unless the user explicitly asks for an HTML companion.

## Workflow

### 1. Identify the review job

Determine:

- Who is reviewing the plan.
- What decision the artifact should support.
- Whether the output is personal, internal, or public (this gates whether `Artifact` publishing is appropriate).
- The source plan file (typically under `.plans/`), pasted plan text, issue, PR, design document, or notes to use.
- The desired output path, defaulting to a clear filename such as `visual-plan.html` or `{plan-name}-visual.html`.

Ask at most one focused question — via `AskUserQuestion` if the answer is one of a few known options, otherwise in plain text — only when missing information would materially change the artifact. Otherwise make a reasonable assumption and state it in the final response.

### 2. Preserve the plan as source of truth

Use the original plan as the factual source. Do not invent owners, dates, estimates, dependencies, metrics, requirements, risks, or acceptance criteria.

If the plan references other files, code, or context needed to represent it faithfully (e.g., a dependency map over modules the plan touches, or the current state of code being migrated), dispatch a read-only `Agent` with `subagent_type: "Explore"` to gather that context rather than guessing. Give it the specific files or symbols to check and have it report facts back, not conclusions.

If the plan is ambiguous, represent ambiguity explicitly as:

- assumptions
- open questions
- decision points
- missing evidence
- unresolved dependencies

### 3. Convert prose into reviewable structure

Choose visual aids based on the plan content:

- **Executive summary** for the decision being requested.
- **Phase timeline** for sequential implementation steps.
- **Dependency graph** for ordering constraints, prerequisites, and blocked work.
- **System or data-flow diagram** for architecture, integration, or migration plans.
- **Risk matrix** for likelihood, impact, mitigation, and owner or trigger if known.
- **Acceptance checklist** for testable completion criteria.
- **Review map** showing which sections need human approval.
- **Open questions panel** for unresolved items.
- **File or module impact map** for codebase implementation plans.
- **Rollback or validation path** for risky releases or migrations.

Prefer fewer, sharper visuals over a crowded dashboard. Every visual element should make the plan easier to evaluate.

### 4. Make the document useful for reviewers

Include reviewer-oriented affordances when helpful:

- sticky table of contents
- section anchors
- collapsible detail sections
- status tags such as `confirmed`, `assumption`, `risk`, and `open question`
- filters for phase, risk level, or review area
- copyable checklist or review notes
- print-friendly styling
- source appendix containing the original plan or a link/path to it

The document should help a reviewer answer:

- What is being proposed?
- Why now?
- What changes?
- What depends on what?
- What could go wrong?
- How will success be verified?
- What decisions or approvals are needed?

### 5. Validate the plan representation

Follow `create-html-artifact` for HTML construction, accessibility, privacy, rendering checks, and final reporting. Add these plan-specific checks:

- Every visual maps to source-plan facts or clearly labeled assumptions.
- Dependencies, ordering, risks, acceptance criteria, and decision points preserve the source meaning.
- Ambiguity and missing evidence remain visible rather than being smoothed over.
- No owner, date, estimate, metric, requirement, or status was invented.
- Decorative structure does not imply unsupported precision or progress.
- No internal company/project names, credentials, or private URLs leaked into the document if it will be shared or published (this repo's public-repository guidance and the `Artifact` tool's privacy rules both apply).

Report the source plan, key review aids, the output path (and publish link if applicable), and any plan ambiguity or unsupported visualization that could not be resolved.
