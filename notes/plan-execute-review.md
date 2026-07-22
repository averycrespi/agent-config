# Plan-Execute-Review

## The pattern

A three-phase loop that most serious Claude Code / AI coding workflows have converged on:

1. **Plan** — Turn a fuzzy request into an explicit artifact: a spec, design doc, or task list. Often preceded by a Socratic brainstorming step to pin down requirements.
2. **Execute** — Work the plan task-by-task, usually in isolated contexts (subagents, worktrees, fresh sessions) so each unit of work starts clean.
3. **Review** — Validate the output against the plan and against quality bars (correctness, security, style). Often layered: per-task review during execution, then a holistic pass before merge.

## The convergence

Independently developed workflows all landed in roughly the same place:

- **[Superpowers](https://github.com/obra/superpowers)** (Jesse Vincent) — brainstorm → plan → isolated-worktree execution → two-stage review (spec, then code quality). Test-first is mandatory.
- **[spec-kit](https://github.com/github/spec-kit)** (GitHub) — constitution → specify → plan → tasks → implement → validate. Agent-agnostic; upstream "constitution" encodes project principles.
- **[GSD](https://crtlaltclaude.com/)** — questionnaire-driven setup → research → planning → roadmap execution → checkpoint verification.
- **My own skills** (`clarify` → `plan` → `challenge-plan` → `/goal` → `review` → `complete-work`) — a stateless clarify interview, an acceptance-criteria-to-verification plan, a pre-execution challenge pass, bounded autonomous execution via the native `/goal` command, then a non-destructive multi-dimension review before PR.

## Why it works

The shape isn't arbitrary — the workflow's phases map onto natural seams in how agents actually operate:

- **Cleave points for composition.** Each phase boundary is a place you can swap in a different model, dispatch to a subagent, or hand off to a fresh session. Planning benefits from a strong model; execution can often use a cheaper one; review wants independence from the author.
- **Artifact handoff.** Plans, specs, and task lists are durable — they survive context resets and can be passed between agents without losing fidelity. Handing over a plan file is much higher-bandwidth than trying to serialize a live conversation.
- **Context efficiency.** Long work is the enemy of quality. Splitting at plan boundaries lets each subagent start with minimal, task-specific context instead of dragging the full history forward.
- **Tunable.** The workflow has many independent knobs — review depth, subagent isolation vs. inline, TDD on/off, how granular plans get, whether verification is parallel or sequential. Each can be adjusted without restructuring the whole loop.

## References

- [Superpowers](https://github.com/obra/superpowers) — Jesse Vincent's Claude Code skills collection
- [spec-kit](https://github.com/github/spec-kit) — GitHub's spec-driven development toolkit
- [GSD for Claude Code](https://crtlaltclaude.com/) — Getting Shit Done workflow
- `claude/skills/` in this repo — my own implementation
