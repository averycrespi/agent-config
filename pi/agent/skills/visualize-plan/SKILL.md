---
name: visualize-plan
description: Use when turning an implementation plan, project plan, design plan, roadmap, migration plan, or execution checklist into a visual HTML document for easier human review.
---

# Visualize Plan

## Purpose

Transform a plan into a standalone HTML artifact that helps humans understand, critique, and approve the work. Preserve the plan's substance, but do not merely reformat Markdown into HTML. Use visual structure, diagrams, timelines, dependency maps, risk views, and review affordances when they make the plan easier to evaluate.

## Required dependency

Before creating the artifact, load and follow the `create-html-artifact` skill. Treat this skill as the plan-specific layer on top of that workflow.

Use `create-html-artifact` for:

- standalone HTML constraints
- accessibility and responsive behavior
- CSS, JavaScript, and dependency policy
- privacy and source-grounding rules
- validation and final reporting requirements

Use this skill for:

- plan-specific interpretation
- choosing review-oriented visual aids
- preserving plan facts
- surfacing risks, dependencies, assumptions, and decisions

## When to use

Use this skill when the user asks to:

- visualize a plan
- make a plan easier to review
- turn a plan into an HTML artifact
- create a visual execution plan
- make a roadmap, implementation plan, rollout plan, migration plan, or design plan more understandable

Do not use this skill for ordinary Markdown cleanup, final documentation, or plans that need to remain primarily coauthored in source form unless the user explicitly asks for an HTML companion.

## Workflow

### 1. Identify the review job

Determine:

- Who is reviewing the plan.
- What decision the artifact should support.
- Whether the artifact is personal, internal, or public.
- The source plan file, pasted plan text, issue, PR, design document, or notes to use.
- The desired output path, defaulting to a clear filename such as `visual-plan.html` or `{plan-name}-visual.html`.

### 2. Preserve the plan as source of truth

Use the original plan as the factual source. Do not invent owners, dates, estimates, dependencies, metrics, requirements, risks, or acceptance criteria.

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

### 4. Make the artifact useful for reviewers

Include reviewer-oriented affordances when helpful:

- sticky table of contents
- section anchors
- collapsible detail sections
- status tags such as `confirmed`, `assumption`, `risk`, and `open question`
- filters for phase, risk level, or review area
- copyable checklist or review notes
- print-friendly styling
- source appendix containing the original plan or a link/path to it

The artifact should help a reviewer answer:

- What is being proposed?
- Why now?
- What changes?
- What depends on what?
- What could go wrong?
- How will success be verified?
- What decisions or approvals are needed?

### 5. Design for comprehension

Follow `create-html-artifact` defaults unless the user requests otherwise:

- Create a single standalone `.html` file.
- Inline CSS and small inline JavaScript only.
- Avoid external dependencies unless explicitly approved.
- Use semantic, accessible HTML.
- Use dark-mode-first styling with print-friendly report styles.
- Ground claims with source references where available.

Avoid generic decoration, fake charts, decorative icons, vague gradients, and dashboard theater. Do not add a visual just because the artifact feels sparse; add visuals only when they clarify the plan.

### 6. Validate

Before reporting completion:

- Read the generated file to check for truncation, placeholders, malformed HTML, and accidental source leaks.
- Run a lightweight HTML syntax check when available, such as `python3 -m html.parser path/to/file.html`.
- Render the artifact in a browser or with Playwright when available, especially for interactive elements.
- Check narrow-width layout for clipping, overlap, unreadable text, or broken diagrams.
- Confirm no unsupported claims were introduced.

## Final response

Report:

- HTML file path.
- Source plan used.
- Key visual aids included.
- Verification performed, including whether it was rendered in a browser.
- Any assumptions, open questions, or rendering limitations.
