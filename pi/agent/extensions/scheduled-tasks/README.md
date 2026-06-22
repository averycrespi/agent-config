# Scheduled Tasks Extension

`scheduled-tasks` lets Pi run recurring Markdown-defined tasks from cron or on demand. Each run starts a fresh child Pi process, writes an exact prompt and run artifacts, and uses an optional per-task handoff file for intentional cross-run memory.

V1 is conservative: Markdown task files only, no precheck scripts, no no-agent/script-only jobs, no catch-up replay, and no automatic handoff content in normal Pi sessions.

## Root layout

All persistent data lives under one configurable root directory:

```text
<root>/
  tasks/       # <task-id>.md definitions
  handoffs/    # <task-id>.md optional cross-run memory
  state/       # <task-id>.json scheduler state plus ticks.jsonl
  sessions/    # child Pi session directories by task
  runs/        # run artifacts by task/run ID
  locks/       # scheduler and per-task locks
```

The extension creates these directories as needed with owner-only permissions where practical.

## Configuration

Settings are read from `extension:scheduled-tasks` plus environment overrides. Environment variables override settings when set.

| Field                        | Default                          | Environment override                            | Description                                                                                                                              |
| ---------------------------- | -------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`                    | `~/.pi/scheduled-tasks`          | `SCHEDULED_TASKS_ROOT_DIR`                      | Persistent root containing tasks, handoffs, state, sessions, runs, and locks.                                                            |
| `defaultTimeoutMinutes`      | `30`                             | `SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES`       | Default child Pi timeout when a task omits `timeoutMinutes`.                                                                             |
| `defaultTools`               | `["read", "grep", "find", "ls"]` | `SCHEDULED_TASKS_DEFAULT_TOOLS`                 | Comma-separated default tool allowlist when a task omits `tools`. Empty means `--no-tools` unless handoff adds `scheduled_task_handoff`. |
| `piCommand`                  | `pi`                             | `SCHEDULED_TASKS_PI_COMMAND`                    | Executable path or command name used for child Pi runs and the managed cron entrypoint.                                                  |
| `cronEnvironment`            | `{}`                             | `SCHEDULED_TASKS_CRON_ENVIRONMENT`              | Environment variables scoped to the managed cron `piCommand`; env override is a JSON object of string values.                            |
| `maxCatchupRunsPerTick`      | `1`                              | `SCHEDULED_TASKS_MAX_CATCHUP_RUNS_PER_TICK`     | Non-negative integer maximum of opt-in missed-schedule catchup runs claimed by one scheduler tick; `0` disables catchup claims.          |
| `maxConcurrentScheduledRuns` | `3`                              | `SCHEDULED_TASKS_MAX_CONCURRENT_SCHEDULED_RUNS` | Positive integer global cap for active detached scheduled runners across ticks. Invalid values such as `0` fall back to the default.     |

Example:

```json
{
  "extension:scheduled-tasks": {
    "rootDir": "~/pi-scheduled",
    "defaultTimeoutMinutes": 20,
    "defaultTools": ["read", "grep", "bash"],
    "piCommand": "/usr/local/bin/pi",
    "maxCatchupRunsPerTick": 1,
    "cronEnvironment": {
      "PATH": "/usr/local/bin:/usr/bin:/bin"
    }
  }
}
```

Run `/scheduled-tasks-config` to inspect the effective parsed config. The extension writes no retained diagnostic logs outside the configured root, but `state/ticks.jsonl` records bounded scheduler tick history and run artifacts may include raw child output.

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
envFiles:
  - .env
  - .env.scheduled
env:
  NODE_ENV: production
executionShell: bash-login
timeoutMinutes: 30
catchup: true
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
- `envFiles` may be a string or list of dotenv-style files. Relative paths resolve against `cwd`; listed files are required in v1.
- Child environment precedence is parent scheduler environment, then `envFiles` in listed order, then inline task `env`, then scheduled-run marker variables.
- `env` values are written in plain text in task files and are visible in management commands/tools and to agents or sessions with file read access. Env file values are not printed by validation, but they are still visible to child processes and may appear in run output. Task files and env files are not secret storage.
- `executionShell: bash-login` runs the child Pi process through `bash --login`, allowing shell startup files to initialize development environments before Pi starts. Omit it for direct argv-array execution. Task `envFiles`, inline `env`, and scheduled-run markers are still present when bash starts, but shell startup files may mutate or override them.
- `catchup: true` opts a task into one make-up run after a missed schedule; omitted or `false` preserves skip-on-miss behavior.
- `handoff` is boolean only in v1.

Validation distinguishes errors from warnings. Errors include invalid frontmatter, unsafe IDs, missing bodies, missing enabled-task `schedule` or `cwd`, invalid cron expressions, invalid `tools`, invalid `envFiles`, missing/unreadable/invalid enabled-task env files, invalid `env`, invalid `executionShell`, invalid `timeoutMinutes`, invalid `catchup`, and invalid configured command/default-tool values. Warnings include disabled tasks, missing disabled-task env files, missing descriptions, missing handoff files, default tool fallback, sensitive-looking env keys, and PATH-dependent commands.

Use `/scheduled-tasks-doctor [task-id]` or `scheduled_tasks({ "action": "validate", "task_id": "..." })` after editing task files.

## Commands

- `/scheduled-tasks-list` lists task IDs, enabled state, and descriptions.
- `/scheduled-tasks-show <task-id>` shows parsed metadata and the Markdown prompt body.
- `/scheduled-tasks-run <task-id>` manually claims and launches a fresh detached scheduled child Pi run for debugging. It returns after launch; final success or failure is visible later in logs and lifecycle artifacts. Manual runs do not advance `nextRunAt`.
- `/scheduled-tasks-run-claimed <task-id> <run-id>` is an internal detached runner entrypoint. It is launched by scheduler ticks for an existing claimed run; do not call it for normal manual runs.
- `/scheduled-tasks-logs <task-id>` shows latest run status, artifact paths, and bounded output/log tails.
- `/scheduled-tasks-doctor [task-id]` validates config, root, managed crontab installation status, latest tick status, command health, task files, last runtime state, and current task-lock diagnostics.
- `/scheduled-tasks-tick [--dry-run]` runs one scheduler tick and appends a compact entry to `state/ticks.jsonl`. `--dry-run` reports decisions without mutating task state, acquiring task execution locks, spawning child Pi, or writing run artifacts.
- `/scheduled-tasks-install-cron` installs or replaces only the managed crontab block.
- `/scheduled-tasks-uninstall-cron` removes only the managed crontab block.
- `/scheduled-tasks-config` shows effective parsed config.

## Skill and tools

The extension bundles a `manage-scheduled-tasks` skill for normal Pi sessions. Use it when asking Pi to create, edit, validate, manually run, or debug scheduled task Markdown files. The skill teaches the file-editing workflow that is intentionally not exposed as structured tool actions.

`scheduled_tasks` is available in normal Pi sessions:

```json
{ "action": "list" | "read" | "validate" | "run" | "logs" | "doctor", "task_id": "dependency-audit" }
```

V1 intentionally omits structured `create` and `update` actions. Create or edit task Markdown using normal file tools, then validate. The bundled skill is loaded only outside scheduled child runs.

`scheduled_task_handoff` is registered only in scheduled child runs. It is scoped by `PI_SCHEDULED_TASK_ID` and can read or update only that task's handoff file:

```json
{ "action": "read" }
{ "action": "update", "content": "Next run should continue from..." }
```

If handoff is disabled or the scheduled-run context is invalid, it returns a clear unavailable error. On update, the run marker is derived from `rootDir`, `PI_SCHEDULED_TASK_ID`, and `PI_SCHEDULED_TASK_RUN_ID`; `PI_SCHEDULED_TASK_RUN_DIR` is provided for child convenience but is not trusted for marker writes.

## Runs and artifacts

Manual runs and scheduled ticks share the same claim-and-launch path: they claim work, write lifecycle metadata and a task snapshot, spawn a detached Pi runner for `/scheduled-tasks-run-claimed <task-id> <run-id>`, and return without waiting for final task success or failure. The detached runner adopts the task lock by rewriting lock metadata to its own process PID before executing, so same-host dead-PID recovery evaluates the active runner rather than the short-lived scheduler tick. By default the child Pi command is spawned directly with an argv array. Tasks with `executionShell: bash-login` instead spawn `bash --login -c 'exec <quoted-pi-command> <quoted-args> ...'`, allowing bash login startup files to run first without depending on positional parameters that user startup files may mutate. Child runs set:

```text
SCHEDULED_TASKS_ROOT_DIR=<root>
PI_SCHEDULED_TASK_RUN=1
PI_SCHEDULED_TASK_ID=<task-id>
PI_SCHEDULED_TASK_RUN_ID=<run-id>
```

Each run writes:

```text
<root>/runs/<task-id>/<run-id>/task.md
<root>/runs/<task-id>/<run-id>/run.json
<root>/runs/<task-id>/<run-id>/prompt.md
<root>/runs/<task-id>/<run-id>/output.md
<root>/runs/<task-id>/<run-id>/result.json
<root>/runs/<task-id>/<run-id>/pi.log
```

`task.md` is the immutable task snapshot written at claim time; the claimed runner executes that snapshot, not a later-edited task file. `run.json` is durable lifecycle metadata with statuses such as `claimed`, `launched`, `running`, `success`, `failed`, `timeout`, `launch_failed`, `orphaned`, and `stale_recovered`. When a detached runner adopts a task lock, `run.json` records `lockAdoptedAt`, `lockPid`, and `lockHostname` so lock ownership can be audited after the scheduler tick exits. `result.json` is still written for final compatibility and records task ID, run ID, terminal status, timestamps, child exit/timeout data, discovered session file when available, and whether handoff was updated. Full raw child stdout/stderr is streamed to `pi.log` on disk. `output.md`, scheduler result summaries, and session metadata extraction use bounded in-memory stdout/stderr tails, so very verbose runs may have truncated summaries while `pi.log` keeps the raw process output. `/scheduled-tasks-logs` and `scheduled_tasks({ "action": "logs" })` show `run.json` when present and read bounded tails from `output.md` and `pi.log` instead of loading entire large artifact files. Raw logs and outputs can include model/tool output and may contain secrets from the child run; protect the root accordingly.

Scheduler ticks append compact JSON entries to `<root>/state/ticks.jsonl`, retained to the latest 1000 entries. Entries include timestamp, scheduler status (`ok` or `locked`), dry-run flag, claimed task summaries, skipped task summaries, and any scheduler-level message. They do not include task prompts, task env values, child stdout/stderr, or full validation output.

Normal Pi sessions never automatically include handoff content. Handoff content appears only in scheduled-run `prompt.md` when `handoff: true` and a handoff file exists.

## Scheduler and cron

`/scheduled-tasks-tick` is the single scheduler entrypoint for cron. It scans enabled tasks, initializes missing `nextRunAt` to the next future occurrence without immediate execution, and skips missed schedules outside the 90-second due window unless the task opts into catchup. Cron expressions use the scheduler process's local/current timezone and standard five-field day-of-month/day-of-week behavior: if one field is unrestricted, the restricted field controls matching; if both are restricted, either field may match.

Catchup is coalesced, not replayed. A task with `catchup: true` runs at most one make-up run when the scheduler notices missed occurrences, even if it missed multiple scheduled times. One tick claims at most `maxCatchupRunsPerTick` catchup runs globally; extra eligible tasks are reported as `catchup_deferred` and keep their existing `nextRunAt` for a later tick. Active scheduled runners are capped globally by `maxConcurrentScheduledRuns`; already-active `claimed`, `launched`, or `running` runs count across ticks. Before enforcing that cap, the scheduler attempts configured stale-lock recovery so expired active locks do not permanently consume capacity. When the cap is reached, due tasks are reported as `concurrency_deferred` and keep `nextRunAt` unchanged. Per-task concurrency is still limited by each task lock.

`/scheduled-tasks-tick` returns a scheduler-level summary with `status`, `timestamp`, `dryRun`, `claimed`, and `skipped`. Claimed entries report launch/claim outcomes such as `launched` or `launch_failed`; final task success or failure is visible later through `run.json`, `result.json`, logs, and doctor/log commands. Scheduler lock contention is reported as `status: "locked"` with no fake task ID. Dry-run ticks report what would initialize, miss, catch up, defer, or run without writing task state, acquiring task execution locks, spawning child Pi, or writing run artifacts; they still append a compact tick-log entry. If a due task is already running, the scheduler reports a task-level locked skip and leaves `nextRunAt` unchanged so later ticks can retry while the due time remains inside the grace window. Scheduler locks stale after 5 minutes. Task locks stale after the task timeout plus a 5-minute cushion; same-host dead-PID locks can be recovered after a 30-second safety floor. Claimed runners adopt the task lock to their own PID, so the 30-second dead-PID path is meant to recover runners that never started or have died, not healthy detached runs whose scheduler parent has exited. Recovery marks associated active lifecycle metadata as `stale_recovered` before new work is launched. Doctor output includes current task-lock run ID, PID, hostname, age, lifecycle status, and whether the lock is currently recoverable by the same policy used by scheduler ticks.

`/scheduled-tasks-doctor` and `scheduled_tasks({ "action": "doctor" })` report whether the managed crontab block is installed, not installed, or unavailable to inspect. They do not modify crontab.

## Reliability and idempotency

The scheduler is designed to avoid duplicate task execution, but no cron-style file-based scheduler can guarantee exactly-once execution across crashes, machine sleep, clock jumps, manual file edits, and process kills. Treat scheduled tasks as at-least-once best-effort work: a run may be skipped when it misses its due window, retried after lock recovery, or rarely duplicated if the host or filesystem violates the assumptions behind stale-lock detection.

Write task prompts so they check current external state before irreversible changes. Prefer idempotent operations, explicit dry-run/read-before-write steps for destructive actions, and outputs that can tolerate a retry. For example, ask the task to inspect whether a report, ticket, branch, or deployment already exists before creating or modifying it.

`/scheduled-tasks-install-cron` manages one marked block and leaves unrelated crontab entries untouched. The managed cron line changes to the project cwd captured when the command is run, then invokes Pi directly in non-interactive mode:

```cron
# BEGIN PI SCHEDULED TASKS
* * * * * cd '<project-cwd>' && env PATH='<optional-cron-path>' '<pi>' --mode json --no-session -p '/scheduled-tasks-tick'
# END PI SCHEDULED TASKS
```

All configurable values in the cron command are shell-quoted. `piCommand` is treated as an executable path or command name, not a shell snippet. `cronEnvironment` is merged key-by-key across default, global, project, and environment config layers, then emitted inline after `cd ... && env`, so values apply only to the managed Pi process and its children, not to unrelated crontab entries. Do not put secrets in `cronEnvironment`; crontab entries are not secret storage.

## Security defaults and limitations

- Task IDs and paths are constrained to the configured root layout.
- Child Pi is spawned with an argument array by default. When `executionShell: bash-login` is enabled, bash receives a fixed, shell-quoted `exec` command for the Pi command and generated arguments; task files cannot provide arbitrary shell snippets.
- Tool permissions use an explicit effective allowlist.
- Handoff tooling is env-gated and current-task scoped; the env vars activate behavior but are not treated as a security boundary.
- No force-unlock or destructive cleanup commands are provided in v1; stale lock recovery is automatic and conservative.

## V1 non-goals

- No precheck scripts.
- No no-agent/script-only jobs.
- No replay of every missed schedule; catchup is opt-in and coalesces missed occurrences into one make-up run.
- No arbitrary `piArgs` passthrough.
- No cloud/webhook/GitHub event triggers.
- No structured task creation/update tool actions.

## Prior art

- [Hermes Agent cron](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/cron.md) influenced the fresh-session, lock, output, and cron-run restriction model.
- [Claude Code scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks), [Claude Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks), and [Claude Routines](https://code.claude.com/docs/en/routines) influenced persistent Markdown-like tasks, manual Run Now, fresh sessions, and run history.
- [Agent Zero task scheduler](https://www.agent-zero.ai/p/docs/task-scheduler) is relevant prior art for future project-scoped recurring, planned, and ad-hoc agent tasks with task states, run history, manual execution, and dedicated versus shared context.
- [LangGraph cron jobs](https://reference.langchain.com/python/langgraph-sdk/_async/cron/) are relevant prior art for recurring assistant runs tied to durable threads, metadata, enabled state, and run-completion behavior.
- [OpenAI Agents SDK sandbox memory](https://openai.github.io/openai-agents-python/sandbox/memory/) is relevant prior art for future handoff evolution: distilled file-based memory, progressive disclosure, separate memory layouts, and read-only versus generate-only memory modes.
- [Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) and [APScheduler](https://apscheduler.readthedocs.io/en/master/userguide.html) are relevant scheduler prior art for future knobs such as misfire grace windows, concurrency policies, catch-up/coalescing behavior, time zones, suspend/resume, and history retention.
- [Temporal Schedules](https://docs.temporal.io/evaluate/development-production-features/schedules) are relevant prior art if scheduled tasks grow toward durable workflows with pause, trigger, backfill, update, retries, observability, and human-in-the-loop control.
