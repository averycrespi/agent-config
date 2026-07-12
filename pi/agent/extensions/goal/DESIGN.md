# Goal Extension Design

`goal` keeps one session-scoped, fork-safe objective for the current Pi session tree and can drive a bounded in-session continuation loop. It is designed to steer long-running work without letting the agent declare completion based on weak proxy signals.

## Architecture

- `index.ts` wires commands, lifecycle event handlers, prompt injection, auto-run continuation, widget updates, compaction, and branch restoration.
- `state.ts` owns the goal, completion-review, and auto-run state machines, compare-and-apply transitions, validation/parsing of persisted snapshots, usage accounting helpers, and text formatting.
- `review.ts` resolves the configured reviewer, builds untrusted-data-delimited prompts, validates structured results, and owns timeout/cancellation composition without mutating goal state.
- `tools.ts` registers `goal_get` and `goal_update`, persists provisional and settled review states, and keeps completion conservative.
- `config.ts` loads and validates user-facing settings from Pi settings plus environment overrides.
- `render.ts` renders the sticky goal widget as pure width-aware lines.
- `*.test.ts` files cover config parsing, state transitions, rendering, tools, and extension behavior.

The extension uses in-memory state during a Pi process, then reconstructs branch state from persisted session entries when sessions start, resume, or navigate.

## State model

There is at most one goal per active branch. The top-level state has two independent parts:

- `goal`: objective, lifecycle status, timestamps, completion evidence, optional usage counters, and optional completion-review substate.
- `autoRun`: in-session automation lifecycle, continuation count, timestamps, and stop reason.

Goal statuses are `active`, `paused`, and `complete`. Auto-run statuses are `idle`, `running`, and `stopped`. Keep these separate: auto-run can stop because a budget is exhausted or user input arrives while the goal remains active for manual continuation.

Review statuses are `reviewing`, `fix_required`, `passed`, `exhausted`, `unavailable`, and `overridden`; they remain separate from the goal's three lifecycle statuses. A review stores its attempt token/count, fix rounds used, latest claim evidence, bounded summary/findings or failure metadata, timestamps, and optional human override reason.

State transitions should go through `createGoalStore()` rather than being assembled in command handlers. The store clones state on reads and notifications so callers do not mutate internal state accidentally. Review application is compare-and-apply: goal ID, attempt token, active goal status, and `reviewing` substate must all match. Every superseding transition invalidates the token.

## Persistence and restoration

Goal state is persisted into the Pi session branch, not a standalone database:

- command and auto-run mutations append custom `goal-state` entries when `pi.appendEntry` is available;
- `goal_update` returns the full state in tool result `details`, which is also used as a restoration source.

`restoreFromBranch()` scans the current branch in order and keeps the latest valid snapshot from either custom entries or `goal_update` tool results. Invalid snapshots are ignored through `parsePersistedGoalState()`. Legacy snapshots without review data remain parseable. Because a child cannot survive process/session restoration, `replaceState()` atomically converts a restored `reviewing` goal to paused/unavailable and stops paired running auto-run state with `review_unavailable`. This also protects same-ID tree navigation from deferred results.

Because state is scoped to the Pi session tree branch rather than the git branch, navigation can legitimately restore a different goal or no goal, and a fresh Pi session in the same git branch starts without that prior goal. Do not introduce project-global or git-branch-global goal state without redesigning this assumption.

## Auto-run lifecycle

`/goal <objective>` creates an active goal, starts auto-run, and sends the first user message. `/goal-renew` starts a fresh auto-run session for an existing active goal without changing usage counters or the objective.

After each `agent_end`, the extension schedules one follow-up only when all gates pass:

- auto-run is enabled in config;
- a goal exists and is active;
- auto-run status is `running`;
- the last assistant message completed successfully;
- Pi has no pending messages, when that API is available;
- continuation and elapsed-time budgets are not exhausted.

`agent_end` occurs before Pi decides whether to retry a failed provider request. The extension therefore remembers provider errors without stopping auto-run, clears the pending error when a later attempt succeeds, and stops only if the error remains at `agent_settled`. Aborted assistant runs stop immediately because they commonly represent explicit cancellation rather than a transient provider failure.

User input stops auto-run unless the input source is `extension`, which prevents the extension's own follow-up messages from stopping the loop. Budget exhaustion, settled provider errors, and aborts stop auto-run but do not mark the goal failed or complete.

## Prompt steering and completion rule

When `injectActiveGoal` is enabled and the goal is active, `before_agent_start` appends goal steering to the system prompt. The objective is explicitly framed as user-provided data, not higher-priority instructions. The injected text reminds the agent to continue focused progress and to complete only after an evidence audit. Auto-run steering says configured continuation/time bounds apply but does not expose exact remaining values; deterministic state still enforces those limits without creating context-pressure signals for the model.

`goal_update` intentionally supports only `status: "complete"`. Completion requires non-empty bounded evidence. The schema advertises the configured `evidenceMaxChars` cap, and agent-facing guidance should tell the model to summarize logs/results instead of pasting raw output. The agent-facing contract is stricter than the type schema: every explicit requirement in the objective should map to concrete artifacts such as files, command output, tests, UI state, or other observed evidence. TODO completion, effort, passing tests alone, or context pressure are not sufficient.

When review is disabled, this immediate path remains unchanged and does not resolve a reviewer. When enabled, `goal_update` persists a provisional `reviewing` claim before awaiting one fresh-context reviewer. `review.ts` forwards the resolved reviewer definition's complete policy and requests a fixed schema; goal code performs stricter semantic and size validation, drops findings below confidence 80, and derives the verdict itself. Only high-confidence blockers/important findings block; suggestions remain visible.

A blocking initial review either enters `fix_required` or immediately exhausts when the configured fix-round budget is zero. Each later `goal_update` is a full re-review with prior findings. Exhaustion pauses the goal and stops auto-run. Missing configuration, spawn/contract failure, timeout, or parent cancellation pauses as `unavailable`, consumes no fix round, and never retries automatically. `/goal-resume` resets the cycle without starting auto-run. `/goal-approve` is command-only, restricted to exhausted/unavailable pauses, and preserves the report while recording human authority.

Preserve this conservative completion design. Adding softer completion paths, an agent override, or unbounded retry loops would weaken the extension's main purpose.

## Commands, tools, and UI

Commands are the user control plane: set, show, pause, resume, approve, renew, clear, and config inspection. Agent tools are narrower: read current goal state and submit a completion claim with evidence. There is deliberately no approval tool.

The widget is informational only. It shows status, truncated objective, compact review phase, usage, and auto-run state. Completion evidence and full findings stay in `/goal-show` and tool results rather than the fixed-size widget.

While auto-run is running, `tool_call` blocks `ask_user`. Headless continuation cannot answer interactive prompts; the agent should choose a safe reversible default, document assumptions, or stop and report a blocker.

## Usage counters

Usage counters are observational, not enforcement mechanisms:

- active elapsed time accrues only while the goal is active;
- assistant turns are counted from assistant `message_end` events;
- token totals are best-effort sums from assistant usage events.

Auto-run budgets use auto-run state, not the total goal usage counters. Renewing auto-run resets continuation/time budget for automation but not overall goal usage.

## Compaction

When enabled, the extension provides a custom `session_before_compact` summary containing goal status, objective, completion evidence, actionable review state/findings, and the anti-early-completion rule. Pi currently keeps one custom compaction result, so this behavior is not composable with other extensions that also provide compaction content. Treat that as a known v1 trade-off.

Because extension-provided compaction can replace Pi's default compaction result, do not assume default file/change tracking survives compaction when this feature is enabled.

## Security and boundaries

The goal objective, completion evidence, prior findings, and reviewer output are untrusted data. Review prompts use shared boundary escaping, inherit no parent conversation, and preserve the reviewer's configured least-privilege tools/extensions/model/thinking/environment/system prompt/skill restrictions. The feature must not add write tools or automatic shell verification. Prompt injection protections in steering text must keep objectives below system/developer instructions. Do not move raw objectives into higher-priority instruction channels.

Timeout and parent cancellation compose into the child signal. The runner waits for `spawnSubagent()` to settle its process cleanup before returning, then clears timers/listeners. Raw child output stays in subagent diagnostics rather than persisted review state. Late outcomes are harmless because only the store can apply a matching token.

The extension should not push, commit, or edit files itself. Checkpoint commit guidance is only model-visible guidance. Actual git operations remain agent/user actions governed by normal repository rules.

## Non-goals

- No background scheduler after Pi exits.
- No project-global or cross-branch goals.
- No hard token/cost enforcement.
- No automatic TODO creation from goals.
- No goal failure lifecycle status or automatic completion.
- No multiple reviewers, reviewer fan-out, automatic verification/fixes, or background review after exit.
- No agent-controlled approval or unbounded fix loop.
- No composable compaction merger.

## Change guidance

When changing goal behavior, update state tests first. Keep lifecycle transitions centralized in `state.ts`, spawning in `review.ts`, and handlers free of ad hoc snapshots. Keep persisted snapshots parseable and version-tolerant; verify branch restoration, same-ID stale results, cancellation cleanup, semantic output bounds, and zero/default fix-round accounting. Use only `subagents/api.ts`, preserve the reviewer definition as policy source, and keep the disabled path before reviewer lookup. Any user-visible command, prompt, widget, config, logging, or completion semantics change must be reflected in `README.md`.
