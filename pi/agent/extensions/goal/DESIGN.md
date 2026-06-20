# Goal Extension Design

`goal` keeps one branch-scoped durable objective for the current Pi session and can drive a bounded in-session continuation loop. It is designed to steer long-running work without letting the agent declare completion based on weak proxy signals.

## Architecture

- `index.ts` wires commands, lifecycle event handlers, prompt injection, auto-run continuation, widget updates, compaction, and branch restoration.
- `state.ts` owns the goal and auto-run state machine, validation/parsing of persisted snapshots, usage accounting helpers, and text formatting.
- `tools.ts` registers `goal_get` and `goal_update`, appends persistent state entries after completion, and keeps completion conservative.
- `config.ts` loads and validates user-facing settings from Pi settings plus environment overrides.
- `render.ts` renders the sticky goal widget as pure width-aware lines.
- `*.test.ts` files cover config parsing, state transitions, rendering, tools, and extension behavior.

The extension uses in-memory state during a Pi process, then reconstructs branch state from persisted session entries when sessions start, resume, or navigate.

## State model

There is at most one goal per active branch. The top-level state has two independent parts:

- `goal`: objective, lifecycle status, timestamps, completion evidence, and optional usage counters.
- `autoRun`: in-session automation lifecycle, continuation count, timestamps, and stop reason.

Goal statuses are `active`, `paused`, and `complete`. Auto-run statuses are `idle`, `running`, and `stopped`. Keep these separate: auto-run can stop because a budget is exhausted or user input arrives while the goal remains active for manual continuation.

State transitions should go through `createGoalStore()` rather than being assembled in command handlers. The store clones state on reads and notifications so callers do not mutate internal state accidentally.

## Persistence and restoration

Goal state is persisted into the Pi session branch, not a standalone database:

- command and auto-run mutations append custom `goal-state` entries when `pi.appendEntry` is available;
- `goal_update` returns the full state in tool result `details`, which is also used as a restoration source.

`restoreFromBranch()` scans the current branch in order and keeps the latest valid snapshot from either custom entries or `goal_update` tool results. Invalid snapshots are ignored through `parsePersistedGoalState()`.

Because state is branch-scoped, navigation can legitimately restore a different goal or no goal. Do not introduce project-global goal state without redesigning this assumption.

## Auto-run lifecycle

`/goal <objective>` creates an active goal, starts auto-run, and sends the first user message. `/goal-renew` starts a fresh auto-run session for an existing active goal without changing usage counters or the objective.

After each `agent_end`, the extension schedules one follow-up only when all gates pass:

- auto-run is enabled in config;
- a goal exists and is active;
- auto-run status is `running`;
- the last assistant message did not terminate with provider error or abort;
- Pi has no pending messages, when that API is available;
- continuation and elapsed-time budgets are not exhausted.

User input stops auto-run unless the input source is `extension`, which prevents the extension's own follow-up messages from stopping the loop. Budget exhaustion and provider errors stop auto-run but do not mark the goal failed or complete.

## Prompt steering and completion rule

When `injectActiveGoal` is enabled and the goal is active, `before_agent_start` appends goal steering to the system prompt. The objective is explicitly framed as user-provided data, not higher-priority instructions. The injected text reminds the agent to continue focused progress and to complete only after an evidence audit.

`goal_update` intentionally supports only `status: "complete"`. Completion requires non-empty bounded evidence. The agent-facing contract is stricter than the type schema: every explicit requirement in the objective should map to concrete artifacts such as files, command output, tests, UI state, or other observed evidence. TODO completion, effort, passing tests alone, or context pressure are not sufficient.

Preserve this conservative completion design. Adding more statuses or softer completion paths would weaken the extension's main purpose.

## Commands, tools, and UI

Commands are the user control plane: set, show, pause, resume, renew, clear, and config inspection. Agent tools are narrower: read current goal state and mark complete with evidence.

The widget is informational only. It shows status, truncated objective, usage, and auto-run state. Completion evidence stays in `/goal-show` and tool results rather than the fixed-size widget.

While auto-run is running, `tool_call` blocks `ask_user`. Headless continuation cannot answer interactive prompts; the agent should choose a safe reversible default, document assumptions, or stop and report a blocker.

## Usage counters

Usage counters are observational, not enforcement mechanisms:

- active elapsed time accrues only while the goal is active;
- assistant turns are counted from assistant `message_end` events;
- token totals are best-effort sums from assistant usage events.

Auto-run budgets use auto-run state, not the total goal usage counters. Renewing auto-run resets continuation/time budget for automation but not overall goal usage.

## Compaction

When enabled, the extension provides a custom `session_before_compact` summary containing goal status, objective, completion evidence, and the anti-early-completion rule. Pi currently keeps one custom compaction result, so this behavior is not composable with other extensions that also provide compaction content. Treat that as a known v1 trade-off.

Because extension-provided compaction can replace Pi's default compaction result, do not assume default file/change tracking survives compaction when this feature is enabled.

## Security and boundaries

The goal objective is user-provided data. Prompt injection protections in the steering text must keep it below system/developer instructions. Do not move raw objectives into higher-priority instruction channels.

The extension should not push, commit, or edit files itself. Checkpoint commit guidance is only model-visible guidance. Actual git operations remain agent/user actions governed by normal repository rules.

## Non-goals

- No background scheduler after Pi exits.
- No project-global or cross-branch goals.
- No hard token/cost enforcement.
- No automatic TODO creation from goals.
- No failure status or automatic completion.
- No composable compaction merger.

## Change guidance

When changing goal behavior, update state tests first. Keep lifecycle transitions centralized in `state.ts`, keep persisted snapshots parseable and version-tolerant, and verify branch restoration. Any user-visible command, prompt, widget, config, or completion semantics change must be reflected in `README.md`.
