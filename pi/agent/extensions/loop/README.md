# Loop Extension

The loop extension provides one shared, bounded continuation loop for the active Pi session branch. It carries no objective and makes no completion judgment: it only decides whether Pi should receive another continuation message after the current agent run fully settles.

Loops may be controlled by the agent tool, user commands, or the public extension API. All callers share the same loop and obey the same configured hard ceilings.

## Lifecycle

A loop is in one of three states:

- `running` — schedule another continuation whenever Pi settles successfully.
- `yielded` — wait for the next non-extension user message, then return to `running`.
- `stopped` — schedule nothing until an explicit resume.

Clearing removes the loop. Starting requires no existing loop, and normal user messages leave a running loop running. Running-time limits exclude time spent yielded or stopped.

Stopped loops cannot be changed to yielded because that would bypass explicit resume. Resume preserves elapsed running time and continuation usage. If a limit is exhausted, extend the corresponding absolute limit before resuming.

## Agent tool

The extension registers one `loop` tool:

| Action   | Parameters                                      | Behavior                                                        |
| -------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `get`    | None                                            | Return current loop state and precise usage.                    |
| `start`  | `message`, optional limits and `delay_seconds`  | Create a running loop. Configured defaults fill omitted values. |
| `yield`  | `reason`                                        | Wait for the next real user message.                            |
| `stop`   | Optional `reason`                               | Stop until explicit resume.                                     |
| `resume` | None                                            | Resume without resetting usage.                                 |
| `extend` | `max_continuations` and/or `max_active_minutes` | Loosen absolute limits without resuming or resetting usage.     |
| `clear`  | None                                            | Remove the loop and invalidate stale continuation callbacks.    |

The tool should only start a loop when the user, a loaded skill, or an established workflow explicitly requests one. Ordinary multi-step work does not require it: Loop schedules further owning-agent turns after Pi settles.

For explicitly requested waiting on a gateway condition expressible as a deterministic check, prefer [`monitor`](../monitor/README.md) when available. Use polling loops only when continued model reasoning or tools unavailable to Monitor are needed, within the existing loop authorization rule. Polling loops should set `delay_seconds` and perform at most one polling batch per continuation. Repeated `extend` calls cannot exceed configured hard ceilings.

### Tool rendering

Collapsed tool calls use an action-first summary such as `loop start · 3 continuations · 5m`, `loop yield · waiting for user`, or `loop extend · 10 continuations`. The `loop` title is emphasized, the action is muted, and long or sensitive continuation messages are not echoed. Results show the resulting state and precise continuation and active-time usage; expanded results add the lifecycle transition, such as `absent → running` or `running → yielded`.

## Continuation message

Each automatic continuation is a custom `loop-continuation` message. The custom message type supplies the visible `[loop-continuation]` label, while its content contains:

```text
<caller-specified message>

The loop is still running. Use `loop` with `action: "yield"` if progress requires user input, `action: "stop"` when another automatic continuation would not be useful, or `action: "get"` to inspect its state and remaining limits.
```

The message deliberately omits exact continuation counts and elapsed or remaining minutes. Precise values remain available through `loop(get)`, commands, the API, and the widget.

Continuation is scheduled from `agent_settled`, after Pi has handled retries, compaction recovery, and queued messages. When the loop has a nonzero delay, the scheduler waits that many seconds, then rechecks loop generation, lifecycle state, idleness, pending messages, and limits before claiming the continuation. The wait counts toward active running time. Stop, yield, clear, session replacement, and shutdown cancel pending waits. Accounting is persisted before the message is enqueued. Provider errors that remain after settlement and aborted runs stop the loop. Countdown scheduling runs outside the awaited settlement/command handlers, so submitted input and `/loop-stop` remain usable while waiting. Unexpected scheduler failures stop the loop with a diagnostic rather than leaving a rejected background task.

## Commands

- `/loop` — show the loop and precise usage.
- `/loop-start <message>` — start with configured default limits and delay, then trigger the first continuation.
- `/loop-yield <reason>` — wait for the next real user message.
- `/loop-stop [reason]` — stop until explicit resume.
- `/loop-resume` — resume and trigger a continuation without resetting usage.
- `/loop-extend <max-continuations|-> <max-active-minutes|->` — loosen one or both limits; `-` retains the current value.
- `/loop-clear` — remove the loop.
- `/loop-config` — show effective parsed configuration.

## Extension API

Other extensions can perform the same lifecycle operations through [`api.ts`](api.ts) and subscribe to typed events. See [API.md](API.md) for imports and contracts. Mutations are also emitted on `pi.events` as `loop:started`, `loop:continued`, `loop:yielded`, `loop:stopped`, `loop:resumed`, `loop:extended`, `loop:cleared`, and `loop:exhausted`.

## Persistence

Loop snapshots are stored as branch-scoped Pi session entries and in `loop` tool-result details. There is one shared loop per active session branch, not per git branch or project.

A loop restored from a persisted `running` snapshot becomes `stopped` with reason `session_restored`. This preserves state without unexpectedly restarting work after reload, session resume, or tree navigation. Resume it explicitly.

## Widget

When enabled and a loop exists, exactly one width-bounded line appears below the editor, without icons, bold text, a message line, or a horizontal rule. The muted lowercase prefix and dim separators follow the [below-editor status convention](../../../../.pi/skills/create-extension/SKILL.md#below-editor-status-widgets). Activity is accent-colored (including scheduled waiting), yielded is warning-colored, ordinary stops are muted, and provider-error stops are error-colored. Values use normal text; labels and reasons are muted.

```text
loop running · 3/10 continuations · 8m/60m active · delay 30s
loop waiting · next 12s · 3/10 continuations · 8m/60m active
loop yielded · waiting for user · Choose the target environment
loop stopped · continuation limit reached
```

These are alternative states of the same row. Running shows continuation usage and active-time usage in whole minutes, followed by any configured nonzero delay. During a scheduler delay, `waiting` replaces `running` and a leading `next` countdown replaces the configured delay. It updates once per second, rounds positive fractions upward, and uses `12s`, `1m`, or `1m 12s`. Waiting is presentation only: lifecycle remains `running` and active time continues to accrue.

The TUI widget is mounted once while visible and repainted in place, preserving its position relative to Monitor and other widgets across countdown updates. Yielded/stopped rows show the reason inline and remain visible until cleared. The continuation message is available through `/loop` and `loop get`, not the widget. Dynamic reasons are terminal-safe and truncated; secondary telemetry drops from the right on narrow terminals, preserving the waiting countdown ahead of usage counters.

## Configuration

Settings live under `extension:loop`. Environment variables override settings. All callers, including imported API users, obey the same hard ceilings.

| Field                     | Default | Environment override              | Description                                                   |
| ------------------------- | ------: | --------------------------------- | ------------------------------------------------------------- |
| `showWidget`              |  `true` | `LOOP_SHOW_WIDGET`                | Show the sticky below-editor widget.                          |
| `defaultMaxContinuations` |    `10` | `LOOP_DEFAULT_MAX_CONTINUATIONS`  | Continuation limit used when start omits one.                 |
| `defaultMaxActiveMinutes` |    `60` | `LOOP_DEFAULT_MAX_ACTIVE_MINUTES` | Running-time limit used when start omits one.                 |
| `hardMaxContinuations`    |   `100` | `LOOP_HARD_MAX_CONTINUATIONS`     | Maximum limit accepted from any caller.                       |
| `hardMaxActiveMinutes`    |   `480` | `LOOP_HARD_MAX_ACTIVE_MINUTES`    | Maximum running-time limit accepted from any caller.          |
| `defaultDelaySeconds`     |     `0` | `LOOP_DEFAULT_DELAY_SECONDS`      | Delay before each continuation when start omits one.          |
| `hardMaxDelaySeconds`     |  `3600` | `LOOP_HARD_MAX_DELAY_SECONDS`     | Maximum accepted delay; capped at `2147483` for timer safety. |
| `messageMaxChars`         |  `4000` | `LOOP_MESSAGE_MAX_CHARS`          | Maximum caller-specified continuation message length.         |
| `reasonMaxChars`          |  `1000` | `LOOP_REASON_MAX_CHARS`           | Maximum yield or stop diagnostic length.                      |

Boolean environment overrides accept `1`/`true` and `0`/`false`.

```json
{
  "extension:loop": {
    "showWidget": true,
    "defaultMaxContinuations": 10,
    "defaultMaxActiveMinutes": 60,
    "hardMaxContinuations": 100,
    "hardMaxActiveMinutes": 480,
    "defaultDelaySeconds": 0,
    "hardMaxDelaySeconds": 3600,
    "messageMaxChars": 4000,
    "reasonMaxChars": 1000
  }
}
```

## Logging

The extension writes no standalone logs. State, limits, reasons, and counters are persisted in Pi session history. Caller-specified messages and reasons may therefore appear in the session file.

## Limitations

- No background scheduling after Pi exits.
- No objective, completion evidence, verification, or progress interpretation.
- No project-global or cross-session loop.
- No automatic restart after session restoration.
- No token or cost limits; stop criteria cover continuations and running time.
