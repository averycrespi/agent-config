# Scheduled Tasks Extension

`scheduled-tasks` lets Pi run recurring Markdown-defined tasks from cron or on demand. Each run starts a fresh child Pi process, writes an exact prompt and run artifacts, and uses an optional per-task handoff file for intentional cross-run memory.

V1 is conservative: Markdown task files only, no precheck scripts, no no-agent/script-only jobs, no catch-up replay, and no automatic handoff content in normal Pi sessions.

## Root layout

All persistent data lives under one configurable root directory:

```text
<root>/
  tasks/       # <task-id>.md definitions
  handoffs/    # <task-id>.md optional cross-run memory
  state/       # <task-id>.json scheduler state
  sessions/    # child Pi session directories by task
  runs/        # run artifacts by task/run ID
  locks/       # scheduler and per-task locks
```

The extension creates these directories as needed with owner-only permissions where practical.

## Configuration

Settings are read from `extension:scheduled-tasks` plus environment overrides. Environment variables override settings when set.

| Field                   | Default                          | Environment override                      | Description                                                                                                                              |
| ----------------------- | -------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`               | `~/.pi/scheduled-tasks`          | `SCHEDULED_TASKS_ROOT_DIR`                | Persistent root containing tasks, handoffs, state, sessions, runs, and locks.                                                            |
| `defaultTimeoutMinutes` | `30`                             | `SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES` | Default child Pi timeout when a task omits `timeoutMinutes`.                                                                             |
| `defaultTools`          | `["read", "grep", "find", "ls"]` | `SCHEDULED_TASKS_DEFAULT_TOOLS`           | Comma-separated default tool allowlist when a task omits `tools`. Empty means `--no-tools` unless handoff adds `scheduled_task_handoff`. |
| `piCommand`             | `pi`                             | `SCHEDULED_TASKS_PI_COMMAND`              | Executable path or command name used for child Pi runs and the managed cron entrypoint.                                                  |
| `cronEnvironment`       | `{}`                             | `SCHEDULED_TASKS_CRON_ENVIRONMENT`        | Environment variables scoped to the managed cron `piCommand`; env override is a JSON object of string values.                            |

Example:

```json
{
  "extension:scheduled-tasks": {
    "rootDir": "~/pi-scheduled",
    "defaultTimeoutMinutes": 20,
    "defaultTools": ["read", "grep", "bash"],
    "piCommand": "/usr/local/bin/pi",
    "cronEnvironment": {
      "PATH": "/usr/local/bin:/usr/bin:/bin"
    }
  }
}
```

Run `/scheduled-tasks-config` to inspect the effective parsed config. The extension writes no retained diagnostic logs outside the configured root, but run artifacts may include raw child output.

## Task files

Create tasks as `<root>/tasks/<task-id>.md`:

```md
---
id: dependency-audit
description: Check dependencies weekly
enabled: true
schedule: "0 9 * * 1"
cwd: /workspace/project
model: anthropic/claude-sonnet-4-5
thinking: medium
tools:
  - read
  - grep
  - bash
env:
  NODE_ENV: production
timeoutMinutes: 30
handoff: true
---

Review dependency status and summarize any issues.
```

Rules:

- `id` may be omitted only when the filename provides the ID. If present, it must match the filename.
- Task IDs allow letters, numbers, underscores, and hyphens only.
- `enabled: true` is required before scheduled execution.
- Enabled tasks require `schedule` and an absolute existing `cwd`.
- Runtime state stays in `state/*.json`; task frontmatter is not rewritten by normal runs.
- `tools` is an explicit allowlist. If omitted, `defaultTools` is used instead of Pi's broad default tools.
- `env` values are written in plain text in task files and are visible in management commands/tools and to agents or sessions with file read access. Task files are not secret storage.
- `handoff` is boolean only in v1.

Validation distinguishes errors from warnings. Errors include invalid frontmatter, unsafe IDs, missing bodies, missing enabled-task `schedule` or `cwd`, invalid cron expressions, invalid `tools`, invalid `env`, invalid `timeoutMinutes`, and invalid configured command/default-tool values. Warnings include disabled tasks, missing descriptions, missing handoff files, default tool fallback, sensitive-looking env keys, and PATH-dependent commands.

Use `/tasks-doctor [task-id]` or `scheduled_tasks({ "action": "validate", "task_id": "..." })` after editing task files.

## Commands

- `/tasks-list` lists task IDs, enabled state, and descriptions.
- `/tasks-show <task-id>` shows parsed metadata and the Markdown prompt body.
- `/tasks-run <task-id>` manually starts a fresh scheduled child Pi run.
- `/tasks-logs <task-id>` shows latest run status, artifact paths, and bounded output/log tails.
- `/tasks-doctor [task-id]` validates config, root, command health, and task files.
- `/tasks-tick [--dry-run]` runs one scheduler tick. `--dry-run` reports decisions without mutating scheduler state, acquiring task execution locks, spawning child Pi, or writing run artifacts.
- `/tasks-install-cron` installs or replaces only the managed crontab block.
- `/tasks-uninstall-cron` removes only the managed crontab block.
- `/scheduled-tasks-config` shows effective parsed config.

## Tools

`scheduled_tasks` is available in normal Pi sessions:

```json
{ "action": "list" | "read" | "validate" | "run" | "logs" | "doctor", "task_id": "dependency-audit" }
```

V1 intentionally omits structured `create` and `update` actions. Create or edit task Markdown using normal file tools, then validate.

`scheduled_task_handoff` is registered only in scheduled child runs. It is scoped by `PI_SCHEDULED_TASK_ID` and can read or update only that task's handoff file:

```json
{ "action": "read" }
{ "action": "update", "content": "Next run should continue from..." }
```

If handoff is disabled or the scheduled-run context is invalid, it returns a clear unavailable error. On update, the run marker is derived from `rootDir`, `PI_SCHEDULED_TASK_ID`, and `PI_SCHEDULED_TASK_RUN_ID`; `PI_SCHEDULED_TASK_RUN_DIR` is provided for child convenience but is not trusted for marker writes.

## Runs and artifacts

Manual runs and scheduler ticks share the same child Pi spawn path. Child runs set:

```text
SCHEDULED_TASKS_ROOT_DIR=<root>
PI_SCHEDULED_TASK_RUN=1
PI_SCHEDULED_TASK_ID=<task-id>
PI_SCHEDULED_TASK_RUN_ID=<run-id>
```

Each run writes:

```text
<root>/runs/<task-id>/<run-id>/prompt.md
<root>/runs/<task-id>/<run-id>/output.md
<root>/runs/<task-id>/<run-id>/result.json
<root>/runs/<task-id>/<run-id>/pi.log
```

`result.json` records task ID, run ID, status, timestamps, child exit/timeout data, discovered session file when available, and whether handoff was updated. Full raw child stdout/stderr is streamed to `pi.log` on disk. `output.md`, scheduler result summaries, and session metadata extraction use bounded in-memory stdout/stderr tails, so very verbose runs may have truncated summaries while `pi.log` keeps the raw process output. `/tasks-logs` and `scheduled_tasks({ "action": "logs" })` read bounded tails from `output.md` and `pi.log` instead of loading entire large artifact files. Raw logs and outputs can include model/tool output and may contain secrets from the child run; protect the root accordingly.

Normal Pi sessions never automatically include handoff content. Handoff content appears only in scheduled-run `prompt.md` when `handoff: true` and a handoff file exists.

## Scheduler and cron

`/tasks-tick` is the single scheduler entrypoint for cron. It scans enabled tasks, initializes missing `nextRunAt` to the next future occurrence without immediate execution, skips missed schedules outside the 90-second due window, and does not replay missed runs. Cron expressions use standard five-field day-of-month/day-of-week behavior: if one field is unrestricted, the restricted field controls matching; if both are restricted, either field may match.

Dry-run ticks are read-only: `/tasks-tick --dry-run` reports what would initialize, miss, or run without writing state, acquiring task execution locks, spawning child Pi, or writing run artifacts. If a due task is already running, the scheduler reports a locked skip and leaves `nextRunAt` unchanged so later ticks can retry while the due time remains inside the grace window.

`/tasks-install-cron` manages one marked block and leaves unrelated crontab entries untouched. The managed cron line changes to the project cwd captured when the command is run, then invokes Pi directly in non-interactive mode:

```cron
# BEGIN PI SCHEDULED TASKS
* * * * * cd '<project-cwd>' && env PATH='<optional-cron-path>' '<pi>' --mode json --no-session -p '/tasks-tick'
# END PI SCHEDULED TASKS
```

All configurable values in the cron command are shell-quoted. `piCommand` is treated as an executable path or command name, not a shell snippet. `cronEnvironment` is merged key-by-key across default, global, project, and environment config layers, then emitted inline after `cd ... && env`, so values apply only to the managed Pi process and its children, not to unrelated crontab entries. Do not put secrets in `cronEnvironment`; crontab entries are not secret storage.

## Security defaults and limitations

- Task IDs and paths are constrained to the configured root layout.
- Child Pi is spawned with an argument array, not shell concatenation.
- Tool permissions use an explicit effective allowlist.
- Handoff tooling is env-gated and current-task scoped; the env vars activate behavior but are not treated as a security boundary.
- No force-unlock or destructive cleanup commands are provided in v1.

## V1 non-goals

- No precheck scripts.
- No no-agent/script-only jobs.
- No catch-up replay of missed schedules.
- No arbitrary `piArgs` passthrough.
- No cloud/webhook/GitHub event triggers.
- No structured task creation/update tool actions.

## Prior art

- [Hermes Agent cron](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/cron.md) influenced the fresh-session, lock, output, and cron-run restriction model.
- [Claude Code scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks), [Claude Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks), and [Claude Routines](https://code.claude.com/docs/en/routines) influenced persistent Markdown-like tasks, manual Run Now, fresh sessions, and run history.
