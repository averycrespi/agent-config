---
name: plan
description: Use when turning a clarified implementation request, feature idea, bugfix, refactor, workflow change, or design discussion into an execution-ready plan that a fresh coding agent can implement autonomously, especially before running /goal.
---

# Plan

Create an execution-ready plan from clarified intent and repo research. Optimize for a durable handoff artifact that another agent can pick up in a fresh session and implement autonomously until complete.

Do not implement the plan while using this skill. Stop after writing or updating the plan and summarizing the handoff.

If the user's goal, scope, product behavior, edge-case policy, acceptance criteria, or risk tolerance is still fuzzy, use the `clarify` skill first. Do not turn user-owned decisions into silent assumptions just to produce a plan.

## Outcomes

Produce a plan that:

- Captures the clarified goal, constraints, acceptance criteria, chosen approach, risks, and verification path.
- Records the material decisions needed for autonomous execution and the evidence or user input behind them.
- Includes enough repo context, file areas, commands, and evidence expectations for a fresh engineer or `/goal` run.
- Avoids line-by-line implementation choreography; the implementer owns local coding choices.
- Has no blocking open questions. If high-impact user-owned decisions remain, switch to `clarify` before finalizing.

## Process

### 1. Research before asking

Start by gathering evidence. Prefer answering questions through research instead of asking the user.

For non-trivial planning, spawn parallel subagents for independent read-only research that can run concurrently. Use one `spawn_agents` call containing all independent research agents instead of serial subagent calls. Skip parallel subagents only for trivial work or when the needed research is inherently sequential.

Use whichever sources apply:

- **Codebase:** read `AGENTS.md`, `CLAUDE.md`, `README.md`, design docs, existing `.plans/`, relevant source files, tests, configs, and nearby conventions.
- **Subagents:** use `spawn_agents` for read-only exploration, localization, convention discovery, risk review, and external-doc research that can run in parallel. Keep subagents read-only and ask for evidence-backed findings with file paths or URLs.
- **Web:** use `web_search` / `web_fetch` when behavior depends on current external docs, libraries, APIs, standards, or examples.
- **Memory:** use Hindsight per `AGENTS.md` when prior preferences, repo history, recurring decisions, or external context may matter. Make Hindsight MCP calls in the main context by default; use subagents for memory only when they are explicitly configured with `mcp-broker` access and the prompt authorizes the operation.

Default parallel research bundle for substantial work:

- **Code / conventions:** locate relevant files, entry points, existing patterns, tests, docs, and likely integration points.
- **Risk / edge cases:** identify missing requirements, ambiguous behavior, likely failure modes, security or migration concerns.
- **External docs:** summarize current library/API constraints and cite URLs when web research matters.

Add, remove, or merge agents based on the task, but preserve the principle: independent research should run in parallel and return concise, evidence-backed findings.

### 2. Synthesize the design shape

Convert research into a concise internal picture:

- What problem is being solved?
- What behavior changes, and what stays the same?
- Which repo areas and conventions govern the work?
- What design choices materially affect implementation?
- What edge cases or failure modes need explicit treatment?
- What acceptance criteria would prove the work is done?
- What verification commands or manual checks are realistic?

If the answer is already clear from evidence, do not ask the user.

### 3. Run a clarity gate

Before writing the plan, classify the request:

- **Clear enough to plan:** the goal, scope, user-visible behavior, material edge cases, acceptance criteria, and verification path are settled by user input or evidence.
- **Needs a residual planning question:** one or two focused decisions remain and the answers materially affect the plan.
- **Needs clarification interview:** several high-impact user-owned decisions remain, or the user's intent is still fuzzy enough that a plan would encode guesses.

Use the `clarify` skill instead of continuing when unresolved ambiguity affects:

- Product or UX behavior with multiple valid outcomes.
- Edge-case policy, failure handling, or security/privacy posture.
- Scope boundaries, non-goals, migration, or rollout choices.
- Acceptance criteria or completion evidence.
- Risk trade-offs where the best choice depends on user preference.
- Terminology or domain conflicts where multiple sources disagree.

For residual planning questions:

- Ask exactly one focused question at a time and wait for the answer.
- Provide the recommended answer first, with a brief reason.
- Prefer `ask_user` for multiple valid options with different trade-offs.
- If the question can be answered by exploring the codebase, web, or memory, research instead of asking.
- If more than one or two high-impact questions emerge, stop and run the `clarify` flow before planning.

Only encode an assumption when it is low-impact, reversible, non-user-visible, and safe for an implementer to rely on. Do not use assumptions for scope, UX, acceptance criteria, security posture, data semantics, or risk tolerance.

Do not ask permission to continue with obvious research or mechanical plan writing. Ask only when the decision materially changes the outcome.

### 4. Write the durable plan

Save the plan under `.plans/YYYY-MM-DD-<short-slug>.md` unless the user asks for a different path or an existing plan should be updated. Use repo-relative paths only; never include absolute local paths.

Create `.plans/` if needed and use normal file tools to write or update the plan.

The plan should be complete enough for a fresh agent to run something like:

```text
/goal Implement .plans/YYYY-MM-DD-<short-slug>.md. Complete only after every acceptance criterion is satisfied with concrete evidence.
```

For small mechanical work, simplify the template while preserving Goal, Acceptance Criteria, Handoff, and Verification. For substantial work, use this structure:

```md
# <Short Title> Plan

## Goal

<One or two sentences describing the intended outcome and user-visible value.>

## Background / Repo Context

- <Relevant repo conventions, architecture, existing patterns, and files.>
- <Important evidence from code, docs, web, or memory. Include file paths / URLs when useful.>

## Acceptance Criteria

- AC-1: <Observable criterion verified by a test, command, file state, or UI/API behavior.>
- AC-2: <Observable criterion verified by a test, command, file state, or UI/API behavior.>
- AC-3: <Observable criterion verified by a test, command, file state, or UI/API behavior.>

## Non-Goals / Out of Scope

- <Explicit boundary that prevents scope creep.>

## Constraints

- <Hard constraints, repo rules, compatibility requirements, security constraints, or user preferences.>

## Chosen Approach

<The selected design and why it is preferred. Mention major alternatives only when the trade-off matters for future readers.>

## Design Decisions

- D1: <Decision and rationale.>
- D2: <Decision and rationale.>

## Implementation Notes

- <Relevant files or areas to modify, by repo-relative path.>
- <Important dependencies, sequencing constraints, existing patterns to copy, and gotchas.>
- <Task groups are allowed when helpful, but avoid step-by-step handholding.>

## Documentation Impact

<State exactly which docs, READMEs, examples, changelogs, or user-facing references need updates, or state that no documentation updates are required and why.>

## Testing / Verification

- V1: <Command or check for AC-1, with expected result.>
- V2: <Command or check for AC-2, with expected result.>
- V3: <Review/documentation check.>

## Risks and Mitigations

- <Likely failure mode and mitigation or acceptance.>

## Assumptions

- <Non-blocking assumption the implementer may rely on. Do not leave unresolved questions here.>

## Handoff Summary

<Concise instructions for the autonomous implementer, including the suggested `/goal` objective and completion evidence expectations.>
```

Plan quality rules:

- Acceptance criteria must be observable, not vibes.
- Verification must map back to acceptance criteria.
- Documentation impact must be a conscious decision.
- Include enough context to survive a fresh session, but do not paste large code excerpts unless essential.
- Prefer implementation intent over exact diffs.
- Mark assumptions only when they are safe, non-blocking, low-impact, reversible, and not user-visible.
- Do not use assumptions for scope, UX, acceptance criteria, security posture, data semantics, or risk tolerance.
- Do not leave `TBD`, `TODO`, or blocking open questions in the final plan.
- Do not over-plan speculative features; apply YAGNI.

### 5. Challenge before finalizing when risk is non-trivial

For substantial or risky plans, run a read-only challenge pass before finalizing. If the challenge can run independently from other research, include it in the same parallel `spawn_agents` bundle; otherwise run it after the draft exists. Invoke the `challenge` skill when a concrete draft is ready for a dedicated pre-implementation stress test.

Review against:

- Does every acceptance criterion have an implementation path and verification check?
- Are repo conventions and constraints respected?
- Are edge cases and failure modes explicit enough?
- Is scope bounded?
- Can a fresh `/goal` agent execute without asking the user more questions?
- Are docs and migration impacts handled?

Repair material issues before presenting the plan. Do not nitpick wording.

### 6. Summarize and hand off

After writing the plan, give the user:

- Plan path.
- One-paragraph summary of the chosen approach.
- Key decisions made.
- Suggested `/goal` command or objective.
- Any residual non-blocking assumptions.

Do not start execution unless the user explicitly asks.
