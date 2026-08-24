# Goal Extension

The goal extension keeps one session-scoped, fork-safe objective for the current Pi session tree. It can also run a bounded in-session continuation loop so headless commands like `pi "/goal <objective>"` keep making progress until completion, user interruption, or a configured stop condition.

## Commands

- `/goal <objective>` — create or replace the current goal as active, start bounded auto-run, and send the initial agent message.
- `/goal` — show the current goal, usage counters when enabled, and auto-run state.
- `/goal-show` — show the current goal, usage counters when enabled, completion evidence when present, or report that none is set.
- `/goal-set <objective>` — create or replace the current goal as active without starting auto-run.
- `/goal-pause` — pause the current goal and stop auto-run.
- `/goal-resume` — resume a paused or completed goal as active without starting auto-run.
- `/goal-renew` — renew auto-run for the current active goal without changing the objective.
- `/goal-clear` — clear the current goal and stop auto-run.

Objectives are trimmed, must be non-empty, and are bounded by `objectiveMaxChars`.

## Auto-run

Auto-run is session-local and bounded. It only continues while the Pi process is alive, the goal remains active, and no user input or pending work should take precedence.

After each `agent_end`, the extension schedules one follow-up user message when:

- a goal exists and is `active`
- auto-run is `running`
- `autoRunEnabled` is true
- `autoRunMaxContinuations` and `autoRunMaxActiveMinutes` have not been exhausted
- the last assistant message completed successfully
- Pi reports no pending messages, when that API is available

Provider errors are evaluated only after Pi reports that the agent has settled, so Pi's built-in retries and compaction recovery can run first. A successful retry clears the pending error and auto-run continues. If the provider error remains when the agent settles, auto-run stops. An aborted assistant stops auto-run immediately rather than being treated as a retryable provider failure.

The loop stops when the goal is completed, paused, cleared, interrupted by user input, disabled by configuration, aborted, left with a provider error after settlement, yielded by the agent, or a continuation/time bound is exhausted. Yielding and operational stop conditions do not complete the goal; the goal remains `active`, and auto-run records a reason such as `agent_yield`, `turn_budget`, `time_budget`, `provider_error`, or `aborted`. Agent yields also retain a bounded reason for `/goal-show` and tool output.

Use `/goal-renew` to start or restart auto-run for the current active goal without changing the objective. Renewal creates a fresh auto-run session: it resets the continuation count and auto-run time budget, but it does not reset goal usage counters such as active goal time, tokens, or assistant turns.

While auto-run is running, the extension blocks `ask_user` tool calls when that tool is available. Headless continuation cannot answer interactive prompts, so agents should choose the safest reversible default, continue with documented assumptions, or call `goal` with `action: "yield"` when progress requires intervention. This guard is only applied at tool-call time and does not require the `ask_user` tool to be loaded.

## Agent tool

The extension registers one `goal` tool with three actions:

| Action     | Parameters | Behavior                                                                                       |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `get`      | None       | Read the current goal and auto-run state without mutation.                                     |
| `complete` | `evidence` | Complete the active goal with concise audited evidence bounded by `evidenceMaxChars`.          |
| `yield`    | `reason`   | Stop auto-run with a bounded reason while leaving the goal active for user-controlled renewal. |

Completion is intentionally conservative. Agents should use `complete` only after mapping every explicit requirement in the objective to concrete evidence from files, command output, tests, UI state, or other real artifacts. The config-aware injected prompt and runtime validation enforce the effective `evidenceMaxChars` limit; the registration-time tool schema deliberately omits a numeric maximum so it cannot disagree with configuration loaded at session start. Evidence should summarize logs/results and cite artifacts rather than paste raw output. TODO completion, tests passing, implementation effort, a plausible final answer, or context pressure are not sufficient by themselves.

Validated evidence completes the active goal immediately, freezes its usage counters, and stops a running auto-run with `goal_complete`. Yielding is not completion: it leaves the goal active, stops auto-run with `agent_yield`, persists the reason, and requires the user to invoke `/goal-renew` before automation continues. The agent cannot renew its own continuation budget.

## State and persistence

Goal state is scoped to Pi's session tree branch, not the git branch. The extension restores the latest valid snapshot from the active session branch on session start, resume, and tree navigation; starting a fresh Pi session in the same git branch does not restore the goal. For plan-driven work, keep the `.design/plans/` file as the durable implementation artifact and use the goal as the current session's steering state.

Snapshots include goal lifecycle state and, when present, auto-run lifecycle state. Auto-run state is separate from goal status so automation can stop while the goal remains active for steering and manual continuation. Legacy snapshots remain valid; obsolete nested metadata is ignored, while an interrupted legacy completion claim is restored as paused and stops a paired running auto-run.

When `showUsage` is enabled, snapshots also include observational usage counters: active elapsed time, assistant turns, and best-effort total tokens reported by Pi message usage events. Active elapsed time counts only while the goal is active; pausing stops the timer, resuming starts it again, and completion freezes it.

Snapshots are persisted through:

- custom `goal-state` entries for command-driven and auto-run mutations
- tool result details for the unified `goal` tool, with legacy `goal_update` results still accepted during restoration

There is at most one goal per active branch.

## Prompt steering

When the current goal is active and `injectActiveGoal` is enabled, each agent turn receives concise steering with:

- the user-provided objective
- a reminder to continue unless paused, blocked, or complete
- checkpoint commit guidance when `checkpointCommits` is enabled
- a completion audit checklist
- the configured `evidenceMaxChars` cap for concise completion evidence and yield reasons
- a warning that proxy signals are insufficient completion evidence
- a qualitative reminder that configured continuation/time bounds apply when auto-run is running

No goal context is injected when the goal is paused, complete, absent, or injection is disabled. When checkpoint guidance is enabled, the agent is told to create git commits at logical verified checkpoints, stage files by name, and never push unless explicitly asked.

## Goal-driven plan execution

The `plan` skill emits an optional goal objective that names a Ready plan and invokes the goal-agnostic `advance-plan` skill exactly once per agent turn. `advance-plan` reports whether it progressed, stopped, or completed; the objective maps that outcome to normal continuation, `yield`, or an evidence-audited `complete` action.

Goal state never duplicates plan progress: `.design/runs/.../state.json` remains authoritative, including after an interrupted turn or a fresh Pi session. Resolve a yielded condition before `/goal-renew`; the next bounded advancement resumes the helper-reported task or milestone gate.

## Widget

When `showWidget` is enabled and a goal exists, a compact fixed-size widget appears below the editor. It shows the goal status and truncated objective. When `showUsage` is enabled, it also shows one usage line with active time, token/turn counters, and current auto-run state such as `auto-run enabled (3/10 continuations, 40m left)`, `auto-run disabled (user input)`, or `auto-run idle`. Completion evidence is available through `/goal-show` instead of the widget.

## Compaction

When `compactSummaryEnabled` is enabled and a goal exists, the extension provides a goal-aware custom compaction summary that preserves the objective, status, completion evidence when present, and the anti-early-completion rule.

This custom compaction behavior is intentionally not composable with other extensions that also return `session_before_compact` compaction content. Pi keeps one custom compaction result, so extension load order can determine which result wins when multiple compaction-providing extensions are active.

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
| `autoRunMaxContinuations` |    `10` | `GOAL_AUTO_RUN_MAX_CONTINUATIONS`  | Maximum continuation prompts scheduled by one auto-run.                                                                      |
| `autoRunMaxActiveMinutes` |    `60` | `GOAL_AUTO_RUN_MAX_ACTIVE_MINUTES` | Maximum active time for one auto-run session before auto-run stops.                                                          |

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
    "autoRunMaxContinuations": 10,
    "autoRunMaxActiveMinutes": 60
  }
}
```

## Logging

The goal extension writes no standalone logs. Goal objectives, usage counters, auto-run state, and completion evidence are persisted in Pi session history as described above.

## Prior art

- [Codex CLI `/goal`](https://developers.openai.com/codex/cli/slash-commands#set-or-view-an-experimental-task-goal-with-goal) — experimental long-running task goal command with persistent target tracking and feature-gated continuation behavior.
- [Codex CLI 0.128.0 adds `/goal`](https://simonwillison.net/2026/Apr/30/codex-goals/) — summary of the Codex goal loop and its continuation/budget prompt implementation.

## V1 omissions

This extension adapts the durable objective, lifecycle controls, bounded continuation loop, model-visible goal context, and conservative completion audit from Codex-style goal workflows. It includes observational time/token counters, but intentionally omits background scheduling after Pi exits, project-global goals, hard token enforcement, budget-limited goal status, automatic TODO creation, and automatic verification or fixes.
