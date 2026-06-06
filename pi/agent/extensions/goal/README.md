# Goal Extension

The goal extension keeps one branch-scoped durable objective for the current Pi session. It can also run a bounded in-session continuation loop so headless commands like `pi "/goal <objective>"` keep making progress until completion, user interruption, or a configured stop condition.

## Commands

- `/goal <objective>` — create or replace the current goal as active, start bounded auto-run, and send the initial agent message.
- `/goal` — show the current goal, usage counters when enabled, and auto-run state.
- `/goal-show` — show the current goal, usage counters when enabled, or report that none is set.
- `/goal-set <objective>` — create or replace the current goal as active without starting auto-run.
- `/goal-pause` — pause the current goal and stop auto-run.
- `/goal-resume` — resume a paused or completed goal as active without starting auto-run.
- `/goal-stop` — stop auto-run while keeping the goal active for steering.
- `/goal-clear` — clear the current goal and stop auto-run.

Objectives are trimmed, must be non-empty, and are bounded by `objectiveMaxChars`.

## Auto-run

Auto-run is session-local and bounded. It only continues while the Pi process is alive, the goal remains active, and no user input or pending work should take precedence.

After each `agent_end`, the extension schedules one follow-up user message when:

- a goal exists and is `active`
- auto-run is `running`
- `autoRunEnabled` is true
- `autoRunMaxTurns` and `autoRunMaxActiveMinutes` have not been exhausted
- Pi reports no pending messages, when that API is available

The loop stops when the goal is completed, paused, cleared, explicitly stopped, interrupted by user input, or a turn/time bound is exhausted. Budget exhaustion does not change goal status; the goal remains `active`, and auto-run records a stop reason such as `turn_budget` or `time_budget`.

While auto-run is running, the extension blocks `ask_user` tool calls when that tool is available. Headless continuation cannot answer interactive prompts, so agents should choose the safest reversible default, continue with documented assumptions, or stop and report a blocker instead. This guard is only applied at tool-call time and does not require the `ask_user` tool to be loaded.

## Agent tools

The extension registers two tools:

- `goal_get` reads the current goal state without mutation.
- `goal_update` can only mark the current goal `complete` and requires non-empty completion evidence bounded by `evidenceMaxChars`.

Completion is intentionally conservative. Agents should call `goal_update` only after mapping every explicit requirement in the objective to concrete evidence from files, command output, tests, UI state, or other real artifacts. TODO completion, tests passing, implementation effort, a plausible final answer, or context pressure are not sufficient by themselves.

## State and persistence

Goal state is branch-scoped. The extension restores the latest valid snapshot from the active branch on session start, resume, and tree navigation.

Snapshots include goal lifecycle state and, when present, auto-run lifecycle state. Auto-run state is separate from goal status so automation can stop while the goal remains active for steering and manual continuation.

When `showUsage` is enabled, snapshots also include observational usage counters: active elapsed time, assistant turns, and best-effort total tokens reported by Pi message usage events. Active elapsed time counts only while the goal is active; pausing stops the timer, resuming starts it again, and completion freezes it.

Snapshots are persisted through:

- custom `goal-state` entries for command-driven and auto-run mutations
- tool result details for `goal_update`

There is at most one goal per active branch.

## Prompt steering

When the current goal is active and `injectActiveGoal` is enabled, each agent turn receives concise steering with:

- the user-provided objective
- a reminder to continue unless paused, blocked, or complete
- checkpoint commit guidance when `checkpointCommits` is enabled
- a completion audit checklist
- a warning that proxy signals are insufficient completion evidence
- remaining auto-run turn/time bounds when auto-run is running

No goal context is injected when the goal is paused, complete, absent, or injection is disabled. When checkpoint guidance is enabled, the agent is told to create git commits at logical verified checkpoints, stage files by name, and never push unless explicitly asked.

## Widget

When `showWidget` is enabled and a goal exists, a compact widget appears above the editor. It shows the goal status and truncated objective. When `showUsage` is enabled, it also shows one usage line. Completed goals also show one truncated evidence line.

## Compaction

When `compactSummaryEnabled` is enabled and a goal exists, the extension provides a goal-aware custom compaction summary that preserves the objective, status, completion evidence when present, and the anti-early-completion rule.

This custom compaction behavior is intentionally not composable with other extensions that also return `session_before_compact` compaction content, including `dev-workflow`. Pi keeps one custom compaction result, so extension load order can determine which result wins when multiple compaction-providing extensions are active.

Because extension-provided compaction replaces Pi's default compaction result, default file/change tracking may not be preserved. This is an accepted v1 trade-off.

## Configuration

Settings live under `extension:goal`. Environment variables override settings. Use `/goal-config` to display the effective parsed config.

| Field                     | Default | Environment override               | Description                                                                                                                  |
| ------------------------- | ------: | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `injectActiveGoal`        |  `true` | `GOAL_INJECT_ACTIVE_GOAL`          | Inject active goal steering into each agent turn.                                                                            |
| `showWidget`              |  `true` | `GOAL_SHOW_WIDGET`                 | Show the sticky goal widget.                                                                                                 |
| `objectiveMaxChars`       |  `4000` | `GOAL_OBJECTIVE_MAX_CHARS`         | Maximum accepted goal objective length.                                                                                      |
| `evidenceMaxChars`        |  `4000` | `GOAL_EVIDENCE_MAX_CHARS`          | Maximum accepted completion evidence length.                                                                                 |
| `compactSummaryEnabled`   |  `true` | `GOAL_COMPACT_SUMMARY_ENABLED`     | Preserve goal state by providing a custom compaction summary. This may replace other extension/default compaction summaries. |
| `checkpointCommits`       |  `true` | `GOAL_CHECKPOINT_COMMITS`          | Tell the agent to create git commits at logical verified checkpoints while working on an active goal.                        |
| `showUsage`               |  `true` | `GOAL_SHOW_USAGE`                  | Show observational active time, token, and turn counters in goal output and the widget.                                      |
| `autoRunEnabled`          |  `true` | `GOAL_AUTO_RUN_ENABLED`            | Allow `/goal <objective>` and continuation scheduling to run automatically.                                                  |
| `autoRunMaxTurns`         |    `10` | `GOAL_AUTO_RUN_MAX_TURNS`          | Maximum continuation turns scheduled by one auto-run.                                                                        |
| `autoRunMaxActiveMinutes` |    `60` | `GOAL_AUTO_RUN_MAX_ACTIVE_MINUTES` | Maximum active goal time before auto-run stops.                                                                              |

Boolean environment overrides accept `1`/`true` and `0`/`false`.

Example:

```json
{
  "extension:goal": {
    "injectActiveGoal": true,
    "showWidget": true,
    "objectiveMaxChars": 4000,
    "evidenceMaxChars": 4000,
    "compactSummaryEnabled": true,
    "checkpointCommits": true,
    "showUsage": true,
    "autoRunEnabled": true,
    "autoRunMaxTurns": 10,
    "autoRunMaxActiveMinutes": 60
  }
}
```

## Logging

The extension writes no retained logs or diagnostic files. Goal objectives, usage counters, auto-run state, and completion evidence are persisted in Pi session history as described above.

## Prior art

- [Codex CLI `/goal`](https://developers.openai.com/codex/cli/slash-commands#set-or-view-an-experimental-task-goal-with-goal) — experimental long-running task goal command with persistent target tracking and feature-gated continuation behavior.
- [Codex CLI 0.128.0 adds `/goal`](https://simonwillison.net/2026/Apr/30/codex-goals/) — summary of the Codex goal loop and its continuation/budget prompt implementation.

## V1 omissions

This extension adapts the durable objective, lifecycle controls, bounded continuation loop, model-visible goal context, and conservative completion audit from Codex-style goal workflows. It includes observational time/token counters, but intentionally omits background scheduling after Pi exits, project-global goals, hard token enforcement, budget-limited goal status, and automatic TODO creation from goals.
