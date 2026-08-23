# Plan-Execute-Review

## The pattern

A three-phase loop that most serious Claude Code / AI coding workflows have converged on:

1. **Plan** — Turn a fuzzy request into an explicit artifact: a spec, design doc, or task list. Often preceded by a Socratic brainstorming step to pin down requirements.
2. **Execute** — Work the plan task-by-task with one writer at a time, using fresh subagent contexts, worktrees, or sessions while the orchestrator retains durable state and verification authority.
3. **Review** — Validate the output against the plan and against quality bars (correctness, security, style). The orchestrator verifies each delegated task directly; independent review is most useful as a holistic risk-appropriate pass before merge rather than an automatic reviewer chain after every task.

## The convergence

Independently developed workflows all landed in roughly the same place:

- **[Superpowers](https://github.com/obra/superpowers)** (Jesse Vincent) — brainstorm → plan → isolated-worktree execution → two-stage review (spec, then code quality). Test-first is mandatory.
- **[spec-kit](https://github.com/github/spec-kit)** (GitHub) — constitution → specify → plan → tasks → implement → validate. Agent-agnostic; upstream "constitution" encodes project principles.
- **[GSD](https://crtlaltclaude.com/)** — questionnaire-driven setup → research → planning → roadmap execution → checkpoint verification.
- **My own skills** (`clarify` → `architect` / `specify` → `plan` → `challenge` → `execute-plan` / `execute-next-milestone` → `review`) — clarification and routing; optional high-level architecture decomposed into bounded specifications; acceptance-criteria-driven planning and challenge; direct one-milestone execution or goal-driven full-plan continuation through sequential profile-routed task workers with durable evidence; then risk-appropriate independent review.

## Why it works

The shape isn't arbitrary — the workflow's phases map onto natural seams in how agents actually operate:

- **Cleave points for composition.** Each phase boundary is a place you can swap in a different model, dispatch to a subagent, or hand off to a fresh session. Planning benefits from a strong model; execution can often use a cheaper one; review wants independence from the author.
- **Artifact handoff.** Plans, specs, and task lists are durable — they survive context resets and can be passed between agents without losing fidelity. Handing over a plan file is much higher-bandwidth than trying to serialize a live conversation.
- **Context efficiency.** Long work is the enemy of quality. Splitting at plan and task boundaries lets each subagent start with minimal, task-specific context while the orchestrator verifies the actual diff and retains the durable execution record.
- **Tunable.** The workflow has many independent knobs — review depth, subagent isolation vs. inline, TDD on/off, how granular plans get, whether verification is parallel or sequential. Each can be adjusted without restructuring the whole loop.

## References

- [Superpowers](https://github.com/obra/superpowers) — Jesse Vincent's Claude Code skills collection
- [spec-kit](https://github.com/github/spec-kit) — GitHub's spec-driven development toolkit
- [GSD for Claude Code](https://crtlaltclaude.com/) — Getting Shit Done workflow
- `pi/agent/skills/` in this repo — my own implementation
