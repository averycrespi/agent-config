# Dynamic Workflows Extension Plan

## Goal

Build a Pi `workflows` extension that lets the parent agent execute deterministic JavaScript workflow scripts that orchestrate isolated subagents for fan-out/fan-in work. Prioritize a safe foreground MVP first, built on the existing `subagents` programmatic API, then layer in structured output, persistence, commands, and advanced workflow modes only after the core primitive is tested.

## Background / Repo Context

- Pi extensions in this repo live under `pi/agent/extensions/<name>/` with `index.ts`, `README.md`, usually `DESIGN.md`, and colocated `*.test.ts` files for meaningful logic.
- `pi/agent/extensions/subagents/api.ts` is the stable integration point for other extensions. It currently exports `spawnSubagent`, `formatSpawnFailure`, `createSubagentActivityTracker`, and related types.
- `pi/agent/extensions/subagents/API.md` explicitly says anything not exported from `api.ts` should be treated as internal, so workflows should avoid importing `subagents/loader.ts` or `subagents/types.ts` directly unless those exports are promoted intentionally.
- `spawnSubagent` already handles child Pi process spawning, JSONL event streaming, cancellation, logs, extension resolution, recursion depth, and final assistant text extraction.
- `subagents` intentionally optimizes for read-mostly exploration/research/review. Built-in agent definitions are read-only by convention, while custom agents may broaden tools.
- Shared helpers to reuse where relevant:
  - `pi/agent/extensions/_shared/spillover.ts` for large tool output.
  - `pi/agent/extensions/_shared/render.ts` for width-aware compact tool rendering.
  - `pi/agent/extensions/_shared/logging.ts` for retained diagnostics.
  - `pi/agent/extensions/_shared/config.ts` if user-facing workflow settings are introduced.
- Prior art:
  - `pi-dynamic-workflows` uses a `workflow` tool, AST validation, Node `vm`, globals like `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and `budget`, plus foreground live progress.
  - `@quintinshaw/pi-dynamic-workflows` adds production features: background runs, `/workflows` TUI, journaled resume, model tiers, worktree isolation, saved workflows, retries, and quality-pattern helpers.
- Repo verification conventions: before reporting Pi extension changes complete, run both `make typecheck` and `make test`.

## Acceptance Criteria

- AC-1: A new `pi/agent/extensions/workflows/` directory exists with `index.ts`, `README.md`, `DESIGN.md`, runtime/tool/display modules as needed, and focused tests.
- AC-2: The extension registers a foreground `workflow` tool that accepts a raw JavaScript `script` string and optional JSON `args`; the tool returns a compact final result and streams useful progress via partial updates.
- AC-3: Workflow scripts are parsed and validated before execution: they must start with literal `export const meta = { name, description }`, cannot use imports/require/filesystem/network/timer APIs, cannot use nondeterministic APIs such as `Date.now`, `new Date`, or `Math.random`, and must call `agent()` at least once.
- AC-4: The runtime exposes MVP globals `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and `cwd`, with deterministic semantics and bounded concurrency. Script execution runs in an explicitly killable boundary, either a separate worker/process or an AST interpreter with equivalent cancellation guarantees; same-process `vm` alone is not sufficient for Phase 1.
- AC-5: `agent()` uses a narrow wrapper around `spawnSubagent(...)` with safe defaults: `inheritSession: "none"`, no arbitrary env passthrough, explicit agent/tool/extension selection, propagated cancellation, and a read-mostly default agent type.
- AC-6: `parallel()` and `pipeline()` preserve input ordering, aggregate branch failures into `null` plus workflow logs where appropriate, and abort promptly when the workflow signal is aborted.
- AC-7: The MVP defaults prevent accidental parallel workspace mutation by using read-only built-in agent types unless a later explicit opt-in design is implemented.
- AC-8: Large workflow results use shared spillover behavior; retained logs/output behavior is documented clearly as potentially containing raw tool/model output.
- AC-9: `pi/README.md` lists the new extension with a concise user-facing purpose, and `README.md` / `DESIGN.md` document usage, configuration/logging behavior, architecture, boundaries, and prior art.
- AC-10: Unit tests cover parser acceptance/rejection, sandbox restrictions, runtime global behavior, concurrency/failure handling, abort propagation, subagent wrapper restrictions, rendering, and spillover behavior where practical.
- AC-11: `make typecheck` and `make test` pass.

## Non-Goals / Out of Scope

- No background workflow manager in the first implementation phase.
- No `/workflows` TUI navigator in the first implementation phase.
- No journaled resume or persisted run database in the first implementation phase.
- No git worktree isolation or parallel writable-agent coordination in the first implementation phase.
- No automatic saved workflow commands in the first implementation phase.
- No broad quality stdlib (`judgePanel`, `loopUntilDry`, etc.) in the first implementation phase.
- No direct import of unexported `subagents` internals unless the subagents public API is deliberately expanded and documented.

## Constraints

- Keep docs and examples public-safe: no internal company/project names, private URLs, or secrets.
- Follow repo extension conventions from `AGENTS.md`: directory-based extension, `README.md` for user-facing behavior, `DESIGN.md` for maintainers, config/logging docs, and tests for logic.
- Treat the workflow script as untrusted model-generated code. Prompt guidance is not a security boundary.
- Do not expose raw `spawnSubagent` power through workflow scripts. The runtime owns policy.
- Prefer deterministic code orchestration over LLM-as-router behavior.
- Preserve subagent recursion and cancellation safeguards.
- Use process-based `spawnSubagent` for MVP even though it is heavier than in-memory sessions; optimize later only if needed.

## Chosen Approach

Implement the work in phases. Phase 1 should deliver the safe core primitive: a foreground `workflow` tool with deterministic script parsing/execution, read-mostly subagent fan-out, compact progress, and tests. Phase 2 can improve ergonomics and structured outputs after the wrapper and runtime are stable. Persistence, background UI, saved workflows, model tiers, retries, and worktree isolation should come later because they significantly expand state, safety, and UI complexity.

This approach intentionally reuses the existing `subagents` child-process boundary rather than duplicating subagent execution. It accepts MVP overhead in exchange for integration with existing logs, cancellation, extension resolution, and agent definitions.

## Recommended Phases

### Phase 0: Public API preparation

Purpose: make `subagents` safe to consume without importing internals.

- Review whether workflows needs agent-definition loading or can use a small internal mapping initially.
- If workflows needs dynamic agent definitions, promote the minimum necessary exports from `pi/agent/extensions/subagents/api.ts` and update `pi/agent/extensions/subagents/API.md`.
- Candidate exports: `loadAgents`, `AgentDefinition`, `BuiltinTool`, and maybe a helper for resolving a safe spawn invocation from an agent type.
- Keep exports narrow; do not expose `runParallelSpawn` wholesale unless it is truly reusable.

### Phase 1: Foreground MVP workflow tool

Purpose: ship the core dynamic-workflow primitive.

- Add `pi/agent/extensions/workflows/` with runtime, tool, display, README, DESIGN, and tests.
- Register a `workflow` tool in `index.ts`.
- Implement parser/runtime with validated metadata and globals: `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `cwd`.
- Execute workflow script logic in a killable worker/process or an AST interpreter with equivalent cancellation guarantees. Do not rely on same-process Node `vm` as the sole runtime boundary.
- Implement a narrow `agent()` wrapper around `spawnSubagent(...)`.
- Default to read-mostly agent types; disallow arbitrary env, arbitrary extensions, and session inheritance.
- Add progress snapshots and compact rendering.
- Add output spillover for large final results.
- Add `before_agent_start` guidance that tells the parent model when to use workflows and how to write scripts.

### Phase 2: Ergonomics, budgets, and structured result contracts

Purpose: make workflows more reliable for machine-readable fan-in and explicit resource control.

- Add a `budget` global and optional `token_budget` tool/config setting after token accounting semantics are defined. The budget should specify how spent tokens are measured, how missing usage data is handled, and whether exhaustion blocks new `agent()` calls or aborts the run.
- Add optional `agent(prompt, { schema })` only after choosing a robust implementation.
- Preferred robust options:
  - add a child structured-output extension/tool that can be loaded by workflow subagents; or
  - create an in-memory workflow-agent runner using Pi session APIs if process-based structured tools are too awkward.
- Add bounded schema repair or clear failure behavior.
- Add configurable concurrency defaults if Phase 1's fixed limit is not enough for real use.
- Register `/workflows-config` if user-facing settings exist.

### Phase 3: Commands, persistence, and saved scripts

Purpose: make runs inspectable and reusable without making the MVP stateful too early.

- Store run history under a user-level workflow directory, not project-local `.pi/`, unless there is a strong reason otherwise.
- Add `/workflows list`, `/workflows status <id>`, and `/workflows stop <id>` before a full navigator.
- Add saved workflow scripts only after the runtime format has stabilized.
- Add journaling/resume only after deterministic call indexing and result hashing are designed and tested.

### Phase 4: Background UI and advanced orchestration

Purpose: add production-grade workflows once state and runtime semantics are proven.

- Add background execution and a sticky progress panel.
- Add interactive `/workflows` navigator.
- Add model tiers and per-agent routing.
- Add retries for recoverable subagent failures.
- Add quality helpers such as `verify`, `judgePanel`, and `completenessCheck`.
- Consider writable workflows only with explicit opt-in, serialization or worktree isolation, cleanup rules, and tests.

## Design Decisions

- D1: Build a separate `workflows` extension instead of expanding `subagents`. Rationale: workflows are a higher-level orchestration surface with distinct runtime, security, persistence, and UI concerns.
- D2: Use `spawnSubagent(...)` directly rather than the `spawn_agents` tool. Rationale: tool-calling would route through another LLM interface and lose structured runtime control; the programmatic API is the intended integration point.
- D3: Keep the MVP foreground and synchronous from the parent tool call. Rationale: it avoids state management and background-delivery complexity while proving the core primitive.
- D4: Default to read-mostly subagents. Rationale: parallel writes are explicitly a non-goal in existing subagents design and require worktree/merge policy.
- D5: Treat sandboxing as a code-enforced boundary. Rationale: workflow scripts are model-generated and must be constrained by parser/runtime policy, not prompts.
- D6: Defer structured output until the child-process integration has a robust tool mechanism. Rationale: prompting for JSON is weaker than a terminating structured-output tool and would become technical debt.

## Implementation Notes

- New files likely needed:
  - `pi/agent/extensions/workflows/index.ts`
  - `pi/agent/extensions/workflows/runtime.ts`
  - `pi/agent/extensions/workflows/workflow-tool.ts`
  - `pi/agent/extensions/workflows/display.ts`
  - `pi/agent/extensions/workflows/types.ts`
  - `pi/agent/extensions/workflows/README.md`
  - `pi/agent/extensions/workflows/DESIGN.md`
  - `pi/agent/extensions/workflows/*.test.ts`
- Existing files likely updated:
  - `pi/README.md`
  - `pi/agent/extensions/subagents/api.ts` and `pi/agent/extensions/subagents/API.md` if any public exports are promoted.
- Runtime validation should be implemented with AST-level checks rather than string matching where possible.
- Do not rely on same-process Node `vm` as the sole security/cancellation boundary. For Phase 1, run workflow logic in a separate killable worker/process or implement an AST interpreter with equivalent cancellation guarantees. Still combine that boundary with strict AST allow/deny checks, a minimal context, absent dangerous globals, wall-time limits, and abortable child subagents.
- `parallel()` should accept thunks, not already-started promises, so the runtime can apply concurrency limits.
- `pipeline(items, ...stages)` should fan items out while preserving sequential stages per item.
- Workflow snapshots should include at least metadata, current phase, phases, logs, agents, statuses, result previews, failure counts, and duration.
- Use shared width-aware rendering helpers for compact renderers and avoid raw multi-line output that wraps poorly in TUI.
- For config, avoid introducing settings in Phase 1 unless necessary. If settings are introduced, use `_shared/config.ts`, document environment overrides, and register `/workflows-config`.

## Documentation Impact

- Add `pi/agent/extensions/workflows/README.md` documenting user-facing behavior, tool schema, script format, globals, examples, configuration/logging behavior, limitations, troubleshooting, and prior art.
- Add `pi/agent/extensions/workflows/DESIGN.md` documenting architecture, runtime safety boundaries, subagents integration, state model, cancellation, rendering, non-goals, and change guidance.
- Update `pi/README.md` extension table with `workflows`.
- Update `pi/agent/extensions/subagents/API.md` if any exports are promoted for workflows.

## Testing / Verification

- V1: Parser tests verify accepted scripts and rejected scripts for missing metadata, nonliteral metadata, imports, require, filesystem/network access, `Date.now`, `new Date`, `Math.random`, and no `agent()` call. Maps to AC-3.
- V2: Runtime tests verify `phase`, `log`, `args`, `parallel`, and `pipeline` semantics, including input-order preservation, branch failure aggregation, bounded concurrency, and killable cancellation for runaway scripts. Maps to AC-4 and AC-6.
- V3: Wrapper tests stub `spawnSubagent` and verify `inheritSession: "none"`, safe defaults, no arbitrary env, propagated signal, selected model/thinking only through allowed options, and read-mostly default behavior. Maps to AC-5 and AC-7.
- V4: Tool tests verify partial updates, final result formatting, spillover, abort behavior, and user-facing errors. Maps to AC-2 and AC-8.
- V5: Render tests verify compact output fits TUI conventions and handles partial/final states. Maps to AC-2.
- V6: Documentation review verifies README/DESIGN/API/pi README updates and public-safe content. Maps to AC-9.
- V7: Run `make typecheck` and `make test`. Maps to AC-10 and AC-11.

## Risks and Mitigations

- Risk: Model-generated JS escapes the intended sandbox. Mitigation: strict AST validation, minimal globals, no Node imports/require/process except controlled `cwd`, and a killable worker/process or AST interpreter boundary for script execution.
- Risk: Workflow scripts hang the Pi event loop. Mitigation: enforce wall-time and concurrency limits, require thunk-based `parallel`, propagate abort signals, and use a killable execution boundary for script runtime in Phase 1.
- Risk: Parallel subagents mutate the same files. Mitigation: MVP defaults to read-mostly agents and documents writable workflows as out of scope.
- Risk: Direct `spawnSubagent` use bypasses `spawn_agents` guardrails. Mitigation: workflows exposes only a narrow wrapper and tests forbidden invocation fields.
- Risk: Logs and persisted outputs contain secrets. Mitigation: use managed owner-only temp artifacts, avoid persistence in MVP, cap/spill output, and document unsanitized logs/output.
- Risk: Scope creep into a full workflow manager before the primitive is stable. Mitigation: explicitly defer background manager, TUI navigator, resume, saved workflows, model tiers, and worktrees to later phases.

## Assumptions

- The first implementation should optimize for safe fan-out research/review/audit workflows, not parallel implementation workflows.
- Process-based subagents are acceptable for MVP even if slower than in-memory Pi sessions.
- The parent model can be guided to write raw JavaScript workflow scripts through tool descriptions and `before_agent_start` guidance.
- A separate killable worker/process is the default Phase 1 sandbox strategy unless the implementer chooses an AST interpreter with equivalent cancellation guarantees.

## Handoff Summary

Implement Phase 0 and Phase 1 first. The completion target is a safe, foreground `workflow` tool that executes deterministic JavaScript orchestration scripts and delegates subagent work through a narrow wrapper around `spawnSubagent(...)`. Do not implement persistence, background UI, saved workflow commands, model tiers, structured output, or worktree isolation until the MVP acceptance criteria pass. Suggested goal command: `/goal Implement .plans/2026-06-27-dynamic-workflows-extension.md through Phase 1 only. Complete only after every Phase 1 acceptance criterion is verified with tests, docs, make typecheck, and make test.`
