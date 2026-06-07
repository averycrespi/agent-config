# Workflow patterns

This document covers multi-phase agent workflow design — the patterns deterministic orchestrators use to drive a sequence of LLM calls toward a complete artifact (a PR, a refactor, a migration). Single-agent harness patterns are in `platforms.md` and `models.md`; this document is about what happens between agents.

The reference architecture is a code-orchestrated pipeline of fresh subagents with validated machine-readable output at each phase boundary: strict JSON where the API supports it, parsed tags where CLI ergonomics make JSON brittle.

## The canonical phase sequence

The richest pipelines surveyed in 2026 use some subset of:

```
extract-AC  →  localize  →  plan  →  plan-repair  →  implement  →  validate  →  review  →  fix  →  emit-report
```

Most production pipelines collapse adjacent phases. Don't add a phase unless the cost of skipping it is clear.

Brief description of each:

| Phase       | Input                  | Output                                                        | Notes                                                                                       |
| ----------- | ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| extract-AC  | Ticket / design doc    | `ac.json` — list of `{id, criterion, verifies_via}`           | Production case studies all do this. Plays the role of contract for downstream phases.      |
| localize    | AC + repo state        | Ranked file list + entry points                               | Largest single contributor on top SWE-bench scaffolds. Read-only, parallelizable.           |
| plan        | AC + localization      | 1–15 outline-level tasks                                      | Plan = intent, not diff. The implementer owns code-level details.                           |
| plan-repair | Plan + repo state + AC | Revised plan or "plan is good"                                | One bounded revision allowed. Catches plan/repo drift before it becomes implementer thrash. |
| implement   | One task + AC + plan   | Code changes (commit)                                         | Sequential per task. Fresh subagent each. Sticky completion — no edge out of `done`.        |
| validate    | All commits            | Pass/fail of deterministic gates (tests, types, lints, build) | Cheap, fast, infallible-on-true-pass.                                                       |
| review      | All commits + AC       | Per-criterion verdicts + any findings                         | Multiple reviewers, diverse lenses, ideally cross-family. Read-only.                        |
| fix         | Review findings        | Code changes                                                  | 2-round cap. Sticky completion.                                                             |
| emit-report | Everything             | Structured JSON + human-readable summary                      | Always emits. No unbounded verify→implement loopback.                                       |

## Acceptance criteria as the canonical rubric

The single highest-leverage pattern from 2026 production case studies. Every ticket-to-PR pipeline that works at scale ([Bitmovin](https://bitmovin.com/blog/ai-developer-workflows-jira-to-pull-request/), [Kinde](https://www.kinde.com/learn/ai-for-software-engineering/workflows/from-jira-ticket-to-production-code-ai-powered-spec-workflows/), the [70-Jira-tickets writeup](https://dev.to/taras-lysyi/how-i-completed-70-jira-tickets-using-ai-agents-and-slept-through-it-3knb), [OpenAI's internal Codex pipeline](https://openai.com/index/harness-engineering/)) extracts AC up front and threads them through every later phase.

What "threading AC through every phase" means concretely:

- **Plan phase** prompt receives the AC list and is instructed to produce tasks that collectively achieve all of them.
- **Implementer** prompt receives the AC the current task is meant to satisfy.
- **Reviewer** prompt receives the AC list and produces a per-criterion verdict (✅ / ❌ / N/A + evidence).
- **Validator** is invoked with a code-built prompt that reads AC from disk — NOT from the implementer's output (see "validator information barrier" below).
- **Final report** maps each AC to test/code locations.

Format: Gherkin (Given/When/Then) is the most common, but any structured `{id, criterion, verifies_via}` works. The `verifies_via` field is what makes the criterion testable rather than aspirational.

In this repo, the Pi `plan` skill persists AC in a dedicated `## Acceptance Criteria` section of `.plans/*.md` handoff documents, and the `goal` extension requires concrete evidence before marking an objective complete.

## Localization

A read-only fan-out phase that produces a ranked file list and entry points before planning starts. Top SWE-bench scaffolds (AutoCodeRover, SWE-agent, Augment) all have localization-style machinery; public analyses often identify it as one of the largest scaffold contributors.

Implementation:

- 2–3 retrieval subagents in parallel: one BM25, one symbol-graph walk, one ripgrep concept search.
- Each returns a ranked list of files with one-line justification per file.
- Orchestrator merges with rank fusion (or just dedupe + concat) into a single `localization.json`.
- Plan phase receives this instead of letting the planner do its own ad-hoc grepping.

`roach-pi`'s parallel `explorer` subagents are a worked example of the pattern.

## Plan-repair gate

A cheap subagent between plan-emit and implement-loop that re-validates the plan against current repo state and the AC list. One bounded revision allowed.

Why: the [Long-Horizon Task Mirage](https://arxiv.org/html/2604.11978v1) paper found 72.5% of agent failures are process-level — subplan errors and history-error accumulation dominate. The paper's caveat is that it studies Web/OS/Embodied/DB, not coding, so treat this as a high-leverage hypothesis rather than measured-on-coding fact.

Implementation:

- Receives the plan + AC + a fresh repo snapshot.
- Returns either "plan is good" or a revised plan with reasoning.
- One revision cycle max — if the revised plan also fails some other check, halt and surface to the user.

Maps to `ralph-meets-rex`'s "planner can reject upfront" pattern, applied between phases.

## Sequential implement, parallel review

The default pattern for most coding workflows.

**Sequential implement**, because actions carry implicit decisions ([Cognition principle 2](https://cognition.ai/blog/dont-build-multi-agents)). Two implementers working on different tasks in parallel will fork micro-decisions that conflict at merge. The exception is **worktree-per-task with no overlap**, but this is rarely as cheap as it sounds — shared ports, databases, services bite hard.

**Parallel review**, because review is read-only and benefits from diversity. The lens-based pattern:

| Lens              | What it looks for                                                     |
| ----------------- | --------------------------------------------------------------------- |
| Plan-completeness | Every plan task did what it claimed; AC are met                       |
| Integration       | Code fits the codebase (imports, naming, conventions, file placement) |
| Security          | OWASP-class issues, credential leakage, untrusted input handling      |
| Test quality      | Coverage of new behavior; no flaky / brittle / mock-heavy tests       |
| Performance       | Hot paths, N+1 queries, unbounded loops                               |

`roach-pi` runs 5 lenses × 2 seeds = 10 reviewers. `ruizrica/agent-pi` runs 5 lenses. Several high-performing SWE-bench scaffolds use multiple review/evaluation passes.

Cap fix-loops at **2 rounds**. Without a cap, verifiers nitpick on style indefinitely. Sticky completion: once a phase reaches `done`, no edge out — failing checks become "known issues" in the report.

## Two-seed reviewers (cheap diversity)

[`roach-pi`](https://github.com/tmdgusya/roach-pi)'s pattern: each reviewer role runs **twice with different seeds**, where seed 2 is told "focus on what seed 1 might miss by examining alternative paths." Doubles reviewer cost, lower-variance findings, cheaper than maintaining 6 distinct reviewer roles.

When you can afford it, **cross-family verification beats two-seed same-model**. See `verification.md` for self-preference bias evidence. When you can't afford cross-family (cost, infrastructure), two-seed is the cheapest diversity you can buy.

## Validator information barrier

Anti-collusion technique from [`roach-pi`](https://github.com/tmdgusya/roach-pi). Verified in upstream repo:

- [`extensions/agentic-harness/agents/plan-validator.md`](https://github.com/tmdgusya/roach-pi/blob/main/extensions/agentic-harness/agents/plan-validator.md) carries an explicit "## Information Barrier" section: "You do NOT know what the worker did, what approach they took, or what their output was."
- [`extensions/agentic-harness/validator-template.ts`](https://github.com/tmdgusya/roach-pi/blob/main/extensions/agentic-harness/validator-template.ts) is a 79-line code-built prompt that interpolates `task.acceptanceCriteria`, `task.files`, and `task.testCommands` from the parsed plan with no worker output.

The implementer agent's prose never reaches the validator. The validator only sees:

- The acceptance criteria (read from disk).
- The files it should inspect.
- The test commands it should run.
- The current repo state.

Why it matters: an implementer agent that writes "I implemented X by doing Y, which satisfies criterion Z" effectively trains the validator's expectations. Even an honest validator will be biased toward agreement. Reading AC directly from disk eliminates this channel.

Adapt for your harness: have the verify subagent's prompt populated by orchestrator code from `<workflowDir>/ac.json`, not from any prior subagent's output. Note that `roach-pi`'s validator runs **per task against the plan file**, not as a final-stage reviewer over the whole change — pick whichever scope fits your pipeline.

## Worktree per run

A strong emerging pattern for parallel write-capable agents: one worktree per agent run, shared `.git` object store, isolated working tree and branch. References: [Augment](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution), [appxlab](https://blog.appxlab.io/2026/03/31/multi-agent-ai-coding-workflow-git-worktrees/), [Penligent](https://www.penligent.ai/hackinglabs/git-worktrees-need-runtime-isolation-for-parallel-ai-agent-development/).

What you get:

- Multiple agent runs in parallel without stepping on each other's working trees.
- "Clean tree required" pre-flight goes away.
- Clean rollback path on failure.

Caveats:

- **Worktrees isolate code, not runtime.** Shared ports, databases, services bite hard. Solve this separately.
- **Disk cost is real.** Reports of ~10GB consumed in 20 minutes on a 2GB codebase via auto-worktree.
- **Branch naming + cleanup matters.** `agent/<task-id>/<timestamp>` plus a janitor.
- **At the time of writing, issue reports say Claude Code's `isolation: worktree` silently no-ops outside a git repo** ([issue #39886](https://github.com/anthropics/claude-code/issues/39886)) and **branches from `origin/main`, not parent's HEAD** ([issue #50850](https://github.com/anthropics/claude-code/issues/50850)). Build accordingly.

Pattern for ticket→PR: worktree created at plan-acceptance time, branch name encodes the ticket ID, orchestrator pushes the branch on success and either deletes the worktree or hands it to a janitor.

## Structured note-taking artifacts

Anthropic's most-cited under-appreciated pattern from [Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): write workflow state to known files referenced _by path_ in subagent prompts, not inlined.

The canonical artifact pattern for this skill lives in `context-engineering.md`. In workflow terms, the minimum useful set is usually:

- `ac.json`
- `localization.json`
- `PLAN.md`
- `DECISIONS.md`
- `KNOWN_ISSUES.md`
- `PR_BODY.md`

The important part is the prompt shape: tell subagents to read `<workflowDir>/PLAN.md` rather than embedding the plan inline. That cuts token cost, survives compaction, and gives the human a forensic trail.

`roach-pi` uses this pattern with a shared diff artifact. `pi-coordination` shows the same idea in a different form: a large context document plus a smaller synthesized meta-prompt.

For crash-safe execution, pair these artifacts with a durable state machine: current phase, attempt count, completed task IDs, commit/diff handles, gate results, reviewer findings, and cleanup handles. See `operations-safety.md` for resume and rollback rules.

## Diff budgets and idle-iteration kill switches

Two independent guardrails that catch the "implementer wandered off" failure mode mechanically, before fix-loops kick in.

**Diff budget**: hard cap on per-task diff (e.g., 500 lines added/changed). Patches over the cap are rejected at apply time — the implementer must shrink. Catches gold-plating and unrelated refactors.

**Idle-iteration kill**: abort if no file delta in N iterations. Catches thrash where the agent keeps "reasoning" without producing changes.

Reference: [Tests-First Agent Loop / diff budgets](https://medium.com/@Micheal-Lanham/stop-burning-tokens-the-tests-first-agent-loop-that-cuts-thrash-by-50-d66bd62a948e). Caveat: the post's headline "50% thrash reduction" is a single anecdotal comparison (12 → 7 iterations on one task), not a measured benchmark; the post's primary advocacy is for _tests-first_ prompting, with diff budgets as a supporting guardrail.

The two are independently useful — diff caps physically reject oversize patches; idle-iteration kills are a separate thrash detector. Use both.

## Termination discipline

The orchestrator's job is to **terminate**. Always emit a final report — pass, fail-with-known-issues, or canceled — and exit. The user's job is to decide what to do with a partial result.

Don't:

- Allow unbounded `verify → implement` loopback. The exact open-ended loop GPT-5/Claude-4-class models thrash in.
- Allow free-text completion markers. `<promise>COMPLETE</promise>` is fragile.
- Skip the report on cancel. A canceled run that emits a "what was done so far" report is salvageable; one that doesn't is throwaway work.

Do:

- Use validated machine-readable completion signals (JSON schemas or parsed tagged outputs).
- Cap fix loops at 2 rounds by default, then record remaining findings as known issues.
- Make completion sticky — no edge out of `done`.
- Halt instead of skip on first task failure (`ralph-meets-rex` halts at `human_intervention_required`; `roach-pi` halts after 3 clarification rounds).

## The single richest source of patterns

[`tmdgusya/roach-pi`](https://github.com/tmdgusya/roach-pi). Its `autonomous-dev` extension is one of the closest open-source examples of a full ticket-to-PR Pi workflow. Worth reading the whole `extensions/agentic-harness/` directory; in particular:

- `agents/plan-validator.md` — validator information barrier prompt.
- `validator-template.ts` — code-built prompt construction.
- The whole `agentic-harness` for compaction-aware workflow state preservation.
- The phase-gated state machine in `agentic-harness` vs the code-orchestrated label-driven worker in `autonomous-dev` — same author, different orchestration philosophies, useful contrast.

Other Pi extensions worth studying for specific patterns:

- [`pi-supervisor`](https://github.com/tintinweb/pi-supervisor) — external in-memory LLM observer with `continue | steer | done` actions and a "5-strike lenient mode" stagnation safeguard. The reference for verify-loop nitpick mitigation.
- [`pi-boomerang`](https://github.com/nicobailon/pi-boomerang) — cleanest implementation of "amnesiac sub-tasks." Conversation sub-tree collapses to a one-line summary; file changes persist. `--rethrow N` for Ralph-style iterative refinement.
- [`pi-coordination`](https://github.com/nicobailon/pi-coordination) — task graph with P0–P3 priorities, formal dependency types, parallel workers, file reservations, inter-worker contracts. Most sophisticated of the surveyed extensions.
- [`overstory`](https://github.com/jayminwest/overstory) — runtime-adapter abstraction over 11 different coding agents. **Tool-call guards backing role contracts** — scouts physically can't call `Write` even if the prompt says they could. SQLite mailbox for inter-agent messages.
- [`oh-my-pi`](https://github.com/can1357/oh-my-pi) — hash-anchored edits with cited 10× edit-success improvement on some models. LSP diagnostics fire automatically after every edit.

## Ticket-to-PR specifics

Patterns from production deployments not in most pipelines today:

- **Acceptance-criteria extraction** as a first-class phase (covered above).
- **Requirement clarification gate.** Before planning, ask: "are the AC unambiguous and testable?" If not, halt with specific clarifying questions, or commit a `CLARIFICATIONS.md` / `OPEN_QUESTIONS.md` documenting assumptions.
- **Ticket comment as audit trail.** Post plan summary + diff stats + verifier rubric outcome back to the ticket on completion.
- **PR description generated from the plan, not the diff.** The diff lies; the plan tells the story.
- **AC-traceability in the PR body.** Each AC item explicitly mapped to test/code locations.
- **Repo-aware operating procedure file.** GitHub Copilot Agent's `copilot_instructions.md` pattern; `AGENTS.md` for Codex; `CLAUDE.md` for Claude Code. Explicit ticket-to-PR conventions belong in whichever your harness reads.

The Pi-ecosystem repo most aligned with the destination is [`roach-pi`'s `autonomous-dev`](https://github.com/tmdgusya/roach-pi) (label-driven GitHub issue worker) — and even its maintainer ships it gated behind `PI_AUTONOMOUS_DEV` with a known-issues doc. That gating itself is a useful pattern: ship behind an env var with a known-issues doc, like roach-pi did.
