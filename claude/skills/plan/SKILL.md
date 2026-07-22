---
name: plan
description: Use when turning clarified intent into a research-grounded, execution-ready implementation plan a fresh agent or /goal run can execute autonomously.
---

# Plan

Turn clarified intent into a durable, execution-ready plan that a fresh agent — or a native `/goal` run — can pick up in a new session and implement autonomously until complete.

This skill sits in the middle of the workflow: `clarify` → **`plan`** → `challenge-plan` → `/goal` → `review` → `completing-work`. Because the upstream `clarify` skill no longer emits a design document, the design shape and chosen approach are synthesized **here**, as part of planning.

Do not implement the plan while using this skill. Stop after writing the plan and summarizing the handoff. Do not start a `/goal` run automatically.

## Outcomes

Produce a plan that:

- Captures the clarified goal, constraints, acceptance criteria, chosen approach, design decisions, risks, and a verification path.
- Synthesizes the design shape from research and evidence — this plan is the design artifact.
- Records the material decisions needed for autonomous execution and the evidence or user input behind each.
- Includes enough repo context, file areas, commands, and evidence expectations for a fresh engineer or `/goal` run.
- Avoids line-by-line choreography; the implementer owns local coding choices.
- Has no blocking open questions. If high-impact user-owned decisions remain, bounce back to `Skill(clarify)` before finalizing.

## Phase 1: Research before asking

Gather evidence first. Prefer answering questions through research instead of asking the user.

For non-trivial planning, dispatch **parallel read-only research subagents** in a SINGLE message with multiple `Agent` tool calls. Use `subagent_type: "Explore"` for read-only code/convention/risk exploration; use `"general-purpose"` when a broader multi-step investigation is needed. Skip parallelism only for trivial work or when the research is inherently sequential.

Default parallel research bundle for substantial work:

- **Code / conventions** (Explore): locate relevant files, entry points, existing patterns, tests, docs, configs, and likely integration points. Return evidence-backed findings with repo-relative file paths.
- **Risk / edge cases** (Explore): identify missing requirements, ambiguous behavior, likely failure modes, and security, privacy, or migration concerns.
- **External docs** (general-purpose, with `WebSearch`/`WebFetch`): summarize current library/API/standard constraints and cite URLs, when behavior depends on external references.

Other sources to use as they apply:

- **Repo context:** read `CLAUDE.md`, `README.md`, existing `.plans/` and `.designs/`, relevant source files, tests, configs, and nearby conventions.
- **Memory / tickets:** use the `mcp__mcp-broker__*` tools when prior decisions, repo history, or external context (a ticket like `ABC-123`) may matter. Per the repo MCP convention, delegate any verbose or multi-call MCP lookup to a subagent that returns a concise summary.

Keep every research subagent read-only and ask for concise, evidence-backed findings with file paths or URLs. Add, remove, or merge agents based on the task, but preserve the principle: independent research runs in parallel and returns tight summaries.

## Phase 2: Synthesize the design shape

Convert research into a concise internal picture before writing anything:

- What problem is being solved?
- What behavior changes, and what stays the same?
- Which repo areas and conventions govern the work?
- What design choices materially affect implementation? What are the credible alternatives, and why is the chosen one preferred?
- What edge cases or failure modes need explicit treatment?
- What acceptance criteria would prove the work is done?
- What verification commands or manual checks are realistic?

This synthesis is the design work. Do not defer it to the implementer, and do not ask the user for anything already settled by evidence.

## Phase 3: Clarity gate

Before writing the plan, classify the request into exactly one of three states:

- **(a) Clear enough to plan** — the goal, scope, user-visible behavior, material edge cases, acceptance criteria, and verification path are all settled by user input or evidence. Proceed to Phase 4.
- **(b) Needs one residual question** — one or two focused decisions remain and their answers materially affect the plan. Ask, then proceed.
- **(c) Needs a full interview** — several high-impact user-owned decisions remain, or the intent is fuzzy enough that a plan would encode guesses. Stop and bounce back to `Skill(clarify)`.

Bounce to `Skill(clarify)` when unresolved ambiguity affects any of:

- Product or UX behavior with multiple valid outcomes.
- Edge-case policy, failure handling, or security/privacy posture.
- Scope boundaries, non-goals, migration, or rollout choices.
- Acceptance criteria or completion evidence.
- Risk trade-offs where the best choice depends on user preference.
- Terminology or domain conflicts where sources disagree.

For a residual planning question (state b):

- Ask exactly one focused question per message, and wait for the answer.
- Use `AskUserQuestion` when there are 2-4 discrete options with different trade-offs; label the recommended option "(Recommended)" and list it first. Use plain text for open-ended or yes/no questions.
- If the question can be answered by exploring the codebase, web, or memory, research instead of asking.
- If more than one or two high-impact questions emerge, treat it as state (c) and run `Skill(clarify)`.

Only encode an assumption when it is low-impact, reversible, non-user-visible, and safe for an implementer to rely on. Never use assumptions for scope, UX, acceptance criteria, security posture, data semantics, or risk tolerance. Do not ask permission to continue with obvious research or mechanical plan writing.

## Phase 4: Write the durable plan

Save the plan to `.plans/YYYY-MM-DD-<short-slug>.md` (create `.plans/` if needed) unless the user asks for a different path or an existing plan should be updated. Use repo-relative paths throughout; never write an absolute local path into the plan, since it may be executed from a worktree at a different location.

For small mechanical work, simplify the template while preserving Goal, Acceptance Criteria, Testing/Verification, and Handoff Summary. For substantial work, use this structure:

```md
# <Short Title> Plan

## Goal

<One or two sentences: the intended outcome and its user-visible value.>

## Background / Repo Context

- <Relevant repo conventions, architecture, existing patterns, and files (repo-relative paths).>
- <Key evidence from code, docs, web, or memory. Include paths / URLs when useful.>

## Acceptance Criteria

- AC-1: <Observable, testable criterion verified by a test, command, file state, or UI/API behavior.>
- AC-2: <...>
- AC-3: <...>

## Non-Goals / Out of Scope

- <Explicit boundary that prevents scope creep.>

## Constraints

- <Hard constraints, repo rules, compatibility requirements, security constraints, or user preferences.>

## Chosen Approach

<The selected design and why it is preferred. Name major alternatives only when the trade-off matters to a future reader.>

## Design Decisions

- D1: <Decision and rationale.>
- D2: <Decision and rationale.>

## Implementation Notes

- <Files or areas to modify, by repo-relative path, grouped into right-sized tasks (see Task sizing below).>
- <Dependencies, sequencing constraints, existing patterns to copy, and gotchas.>
- <Documentation Task: see rule below.>

## Documentation Impact

<State exactly which docs, READMEs, examples, or changelogs need updates — or state that none are required and why.>

## Testing / Verification

- V-1: <Command or check proving AC-1, with expected result.> (verifies AC-1)
- V-2: <Command or check proving AC-2, with expected result.> (verifies AC-2)
- V-3: <Review/documentation check.> (verifies AC-N)

## Risks

- <Likely failure mode and its mitigation or explicit acceptance.>

## Assumptions

- <Non-blocking, safe assumption the implementer may rely on. No open questions here.>

## Handoff Summary

<Concise instructions for the autonomous implementer: the suggested /goal objective and the completion evidence expected.>
```

### Task sizing (for Implementation Notes)

Group work into tasks, each a self-contained, single-PR-scope unit — what would naturally land as one commit and be reviewable on its own. Do not decompose into "write the test / run it / implement" micro-steps; that choreography belongs to the implementer, not the plan.

- **Simple** — renames, version bumps, doc tweaks, applying an existing pattern, one-line config. Bundle related simple work into one task.
- **Standard** (the default) — a new function with tests, a new endpoint following existing patterns, refactoring one module, adding a config option. One task.
- **Complex or risky** — auth, security, or data-integrity changes; new abstractions; cross-cutting refactors; anything you couldn't draft acceptance criteria for without thinking hard. Keep tasks tight and split aggressively; touching more than ~5 files or introducing a new abstraction is a signal to split.

**When in doubt, size up.** The cost of over-sizing is one extra review pass; the cost of bundling something risky with something simple is shipping a bug inside a too-large diff.

### Documentation Task rule

Before finalizing tasks, scan the docs that could go stale (`README.md`, `CLAUDE.md`, `docs/`, examples, changelogs). If any need updating, add a final documentation task listing the exact files and sections to change. If none do, say so explicitly in Documentation Impact so it is a conscious decision, not an oversight.

### Plan quality rules

- Acceptance criteria must be observable and testable, not vibes.
- **Every verification item maps back to an acceptance criterion** — this AC → V mapping is the spine of the plan. No AC without a V; no V without an AC.
- Documentation impact must be a conscious decision.
- Include enough context to survive a fresh session, but do not paste large code excerpts unless essential; prefer implementation intent over exact diffs.
- Mark assumptions only when safe, non-blocking, low-impact, reversible, and not user-visible.
- Do not leave `TBD`, `TODO`, or blocking open questions in the final plan.
- Apply YAGNI — do not plan speculative features.

## Phase 5: Save, and optionally challenge

Save the plan file with normal file tools. **Do not commit it** — the repo rule is to commit only when the user asks. Mention the path and note the user may commit it when ready.

For substantial or risky plans, suggest a read-only challenge pass via `Skill(challenge-plan)` before execution. It stress-tests whether every AC has an implementation path and a verification check, whether conventions and constraints are respected, whether edge cases are explicit, whether scope is bounded, and whether a fresh `/goal` agent could execute without asking more questions. Repair material issues before presenting; do not nitpick wording.

## Phase 6: Hand off

After writing the plan, give the user:

- The plan path (and a note that they may commit it).
- A one-paragraph summary of the chosen approach.
- Key decisions made and any residual non-blocking assumptions.
- An offer to challenge the plan via `Skill(challenge-plan)` first, for risky work.
- A concrete `/goal` handoff whose completion condition derives from the acceptance criteria and verification, for example:

```text
/goal all of AC-1..AC-4 are satisfied and the checks in the Verification section pass
```

Note that the run can be bounded by appending "... or stop after N turns". `/goal` runs the objective autonomously and evaluates completion independently, so the completion condition must be phrased in terms of the observable ACs and verification checks.

Do not start execution. Wait for the user to launch `/goal` themselves.
