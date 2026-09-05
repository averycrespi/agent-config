# Plan-Execute-Review

## The pattern

A three-phase loop that most serious Claude Code / AI coding workflows have converged on:

1. **Plan** — Turn a fuzzy request into an explicit artifact: a spec, design doc, or task list. Often preceded by a Socratic brainstorming step to pin down requirements.
2. **Execute** — Implement and fix in the owning session by default. Use writable delegation only when explicitly requested by the user through an explicit execution workflow with bounded scope, one writer, orchestrator-owned state and evidence, a structured handoff, and independent verification.
3. **Review** — Validate the output against the plan and against quality bars (correctness, security, style). The orchestrator verifies each delegated task directly; independent review is most useful as a holistic risk-appropriate pass before merge rather than an automatic reviewer chain after every task.

## The convergence

Independently developed workflows all landed in roughly the same place:

- **[Superpowers](https://github.com/obra/superpowers)** (Jesse Vincent) — brainstorm → plan → isolated-worktree execution → two-stage review (spec, then code quality). Test-first is mandatory.
- **[spec-kit](https://github.com/github/spec-kit)** (GitHub) — constitution → specify → plan → tasks → implement → validate. Agent-agnostic; upstream "constitution" encodes project principles.
- **[GSD](https://crtlaltclaude.com/)** — questionnaire-driven setup → research → planning → roadmap execution → checkpoint verification.
- **My own skills** — optional research-first `clarify`, `challenge` for proposed approaches, and `review` for completed changes. Ticket delivery uses `shape-ticket` and explicitly authorized `work-ticket`, with canonical acceptance criteria, one implementation owner, a durable working plan and revision-bound evidence, optional Loop continuation, and risk-proportionate independent review before PR handoff. Plan → implement → verify → handoff is a working sequence, not a mandatory phase machine.

## Why it works

The shape isn't arbitrary — the workflow's phases map onto natural seams in how agents actually operate:

- **Composition points.** Phase boundaries make delegation possible, not mandatory. Delegate a self-contained question when parallelism, substantial context isolation, or independent judgment clearly outweighs startup, handoff, and verification costs.
- **Artifact handoff.** Plans, specs, and task lists survive context resets, but do not preserve every implicit decision. Carry relevant decisions and evidence across any necessary handoff; do not assume a plan replaces the implementer's accumulated understanding.
- **Context quality.** Isolate noisy intermediate material when doing so helps the owner. Keep tightly coupled implementation in the owning session rather than rotating fresh writers merely to shorten its context.
- **Tunable.** The workflow has many independent knobs — review depth, subagent isolation vs. inline, TDD on/off, how granular plans get, whether verification is parallel or sequential. Each can be adjusted without restructuring the whole loop.

## References

- [Superpowers](https://github.com/obra/superpowers) — Jesse Vincent's Claude Code skills collection
- [spec-kit](https://github.com/github/spec-kit) — GitHub's spec-driven development toolkit
- [GSD for Claude Code](https://crtlaltclaude.com/) — Getting Shit Done workflow
- `pi/agent/skills/` in this repo — my own implementation
