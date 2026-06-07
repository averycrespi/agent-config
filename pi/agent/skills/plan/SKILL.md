---
name: plan
description: Use when turning a fuzzy implementation request, feature idea, bugfix, refactor, workflow change, or design discussion into an execution-ready plan that a fresh coding agent can implement autonomously, especially before running /goal.
---

# Plan

Create an execution-ready plan through a research-first, question-driven flow. Optimize for a durable handoff artifact that another agent can pick up in a fresh session and implement autonomously until complete.

Do not implement the plan while using this skill. Stop after writing or updating the plan and summarizing the handoff.

## Outcomes

Produce a plan that:

- Captures the user's goal, constraints, acceptance criteria, chosen approach, risks, and verification path.
- Resolves every material design decision needed for autonomous execution.
- Includes enough repo context, file areas, commands, and evidence expectations for a fresh engineer or `/goal` run.
- Avoids line-by-line implementation choreography; the implementer owns local coding choices.
- Has no blocking open questions. If uncertainty remains, encode a safe explicit assumption or ask another question before finalizing.

## Process

### 1. Research before asking

Start by gathering evidence. Prefer answering questions through research instead of asking the user.

For non-trivial planning, spawn parallel subagents for independent read-only research that can run concurrently. Use one `spawn_agents` call containing all independent research agents instead of serial subagent calls. Skip parallel subagents only for trivial work or when the needed research is inherently sequential.

Use whichever sources apply:

- **Codebase:** read `AGENTS.md`, `CLAUDE.md`, `README.md`, design docs, existing `.plans/`, relevant source files, tests, configs, and nearby conventions.
- **Subagents:** use `spawn_agents` for read-only exploration, localization, convention discovery, risk review, and external-doc research that can run in parallel. Keep subagents read-only and ask for evidence-backed findings with file paths or URLs.
- **Web:** use `web_search` / `web_fetch` when behavior depends on current external docs, libraries, APIs, standards, or examples.
- **Memory:** use Hindsight when prior preferences, repo history, recurring decisions, or external context may matter. Hindsight MCP calls must happen in the main context, not in subagents.

Hindsight recall pattern:

1. Use `mcp_search` for `hindsight` if tool availability is uncertain.
2. Use `mcp_describe` for `hindsight.recall` before first use in a session if the schema is not already known.
3. Call `mcp_call` with `name: "hindsight.recall"` and a focused query. Include repo tags such as `scope:repo` and `repo:<name>` when known; include global tags only when cross-repo preferences or tool knowledge may apply.
4. Treat memory as evidence, not authority. Current repo state and current user messages override memory.

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

### 3. Ask only material questions

Ask the user only for things the agent cannot infer responsibly, such as:

- Product or UX decisions with multiple valid outcomes.
- Edge-case policy choices.
- Scope boundaries or non-goals.
- Conflicts between the user's request, repo conventions, web docs, or memory.
- Risk trade-offs where the best choice depends on user preference.

Question discipline, adapted from `grill-me`:

- Walk down the decision tree one dependency at a time.
- Ask one focused question at a time and wait for the answer.
- Provide the recommended answer first, with a brief reason.
- Prefer `ask_user` for multiple valid options with different trade-offs.
- If a question can be answered by exploring the codebase, web, or memory, research instead of asking.
- For terminology or domain conflicts, call out the contradiction directly and ask which source should win.
- Keep asking until the implementation shape is clear enough that the final plan has no blocking open questions.

Do not ask permission to continue with obvious research or mechanical plan writing. Ask only when the decision materially changes the outcome.

### 4. Write the durable plan

Save the plan under `.plans/YYYY-MM-DD-<short-slug>.md` unless the user asks for a different path or an existing plan should be updated. Use repo-relative paths only; never include absolute local paths.

If `write_plan` / `edit_plan` tools are available, use them. Otherwise create `.plans/` and use normal file tools.

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
- Mark assumptions only when they are safe and non-blocking.
- Do not leave `TBD`, `TODO`, or blocking open questions in the final plan.
- Do not over-plan speculative features; apply YAGNI.

### 5. Challenge before finalizing when risk is non-trivial

For substantial or risky plans, run a read-only challenge pass before finalizing. If the challenge can run independently from other research, include it in the same parallel `spawn_agents` bundle; otherwise run it after the draft exists. Use a review agent or invoke the existing `challenge-plan` skill if appropriate.

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
