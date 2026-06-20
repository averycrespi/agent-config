# Scheduled Tasks Extension Design

`scheduled-tasks` is a Pi extension for recurring, Markdown-defined Pi jobs. It is intentionally small and conservative: task definitions are files on disk, scheduler state is separate JSON, each execution starts a fresh child Pi process, and cross-run memory exists only when a task explicitly enables a scoped handoff file.

This file is for future agents changing the extension. The user-facing contract lives in `README.md`; keep this document focused on architecture, invariants, and design intent.

## V1 architecture

- `index.ts` wires the extension into Pi. Normal Pi sessions get the `scheduled_tasks` management tool and the bundled `manage-scheduled-tasks` skill. Scheduled child sessions, detected by `PI_SCHEDULED_TASK_RUN=1`, get only the scoped `scheduled_task_handoff` tool.
- `config.ts` loads settings from Pi extension settings plus environment overrides, normalizes `rootDir`, validates defaults, and exposes command health checks.
- `paths.ts` owns the root layout and all safe path builders. Callers should pass task IDs, not arbitrary paths, when addressing tasks, handoffs, state, runs, or locks.
- `task-file.ts` parses the limited Markdown/YAML task format. It does not use a general YAML dependency; supported syntax is deliberately simple and covered by validation.
- `validate.ts` separates parse/runtime errors from warnings and computes effective tool permissions.
- `schedule.ts` owns five-field cron parsing, cron matching, next-run search, and due/missed/initialize decisions.
- `scheduler.ts` owns manual runs, scheduler ticks, run artifact creation, lock sequencing, and latest-log reads.
- `spawn.ts` builds the child Pi argv/env and supervises the child process with timeout, bounded in-memory tails, raw disk logging, and session-file extraction.
- `state.ts` persists scheduler state and run results as atomically replaced JSON files.
- `locks.ts` implements advisory file locks via exclusive create. There is no stale-lock recovery or force-unlock command in v1.
- `commands.ts` registers slash commands, including doctor, cron install/uninstall, and `/tasks-tick`.
- `tools.ts` registers agent tools with compact TUI renderers and text results that agents can recover from.

## Persistent layout

All extension-owned data is rooted under the configured `rootDir`:

```text
<root>/
  tasks/       # Markdown task definitions: <task-id>.md
  handoffs/    # Optional cross-run memory: <task-id>.md
  state/       # Scheduler state JSON: <task-id>.json
  sessions/    # Child Pi session dirs, one per task ID
  runs/        # Run artifacts: <task-id>/<run-id>/...
  locks/       # scheduler.lock and <task-id>.lock
```

`ensureRootLayout()` creates this structure with owner-only permissions where Node supports it. Keep all future persistent data under this root unless there is a strong user-facing reason not to.

## Task model

Task files are `<root>/tasks/<task-id>.md` with YAML frontmatter plus a Markdown body. The filename is authoritative: an optional `id` frontmatter field must match the filename. Task IDs are constrained to letters, numbers, underscores, and hyphens so IDs can safely map to predictable files under the root.

Task frontmatter is declarative configuration, not mutable state. Normal runs do not rewrite task files. Runtime state such as `nextRunAt`, `lastRunId`, and `lastStatus` belongs in `state/<task-id>.json`.

Enabled scheduled execution requires:

- `enabled: true`
- a valid five-field cron `schedule`
- an absolute existing `cwd`
- a non-empty Markdown body

Disabled tasks can still be listed, read, validated, and manually run if they otherwise validate for execution.

## Scheduler semantics

`/tasks-tick` is the only scheduler entrypoint. Cron invokes it once per minute through Pi in non-interactive JSON mode. Manual runs and scheduled runs share the same `runTask()` path after task lookup.

The scheduler behavior is intentionally non-replaying:

- Missing `nextRunAt` initializes to the next future occurrence and does not run immediately.
- Due tasks run only if `nextRunAt` is within the 90-second due window.
- Missed schedules outside that window advance to the next future occurrence with `lastSkipReason: "missed_schedule"`.
- There is no catch-up replay for downtime or long-running tasks.

Lock sequencing matters:

1. Acquire `scheduler.lock` for the tick.
2. Read and validate tasks.
3. For a due task, acquire the per-task lock before advancing `nextRunAt`.
4. Persist the advanced `nextRunAt` while still holding `scheduler.lock`.
5. Release `scheduler.lock`.
6. Run claimed tasks while holding their per-task locks.

If a due task is already locked, the scheduler leaves `nextRunAt` unchanged so a later tick can retry while the due time is still inside the grace window. Dry-run ticks are read-only: they do not write state, acquire task execution locks, spawn child Pi, or write run artifacts.

## Child Pi execution

Each run gets a unique run ID and a run directory:

```text
<root>/runs/<task-id>/<run-id>/
  prompt.md
  output.md
  result.json
  pi.log
```

`renderPrompt()` writes the exact prompt used by the child run to `prompt.md`. The child Pi process is spawned with an argument array, not a shell string. `buildSpawnPlan()` sets:

- `--mode json`
- `--session-dir <root>/sessions/<task-id>`
- `--name "scheduled: <task-id> <run-id>"`
- optional `--model` and `--thinking`
- `--tools <effective-tools>` or `--no-tools`
- `-p @<prompt.md>`

The child environment includes task `env` values plus scheduled-run markers:

```text
SCHEDULED_TASKS_ROOT_DIR=<root>
PI_SCHEDULED_TASK_RUN=1
PI_SCHEDULED_TASK_ID=<task-id>
PI_SCHEDULED_TASK_RUN_ID=<run-id>
PI_SCHEDULED_TASK_RUN_DIR=<run-dir>
```

These markers are for scoping behavior, not a hard security boundary. Do not add behavior that trusts env vars for authorization without also constraining paths through `paths.ts` and validating the current task file.

`spawnPi()` streams full stdout/stderr to `pi.log` and keeps bounded in-memory tails for `output.md`, summaries, and result extraction. Large child output may be truncated in summaries, but the raw log remains on disk. Timeouts send `SIGTERM` first and then `SIGKILL` after a short grace period.

## Tool permissions and handoff

Tool permissions are explicit. `effectiveTools()` uses task-specific `tools` when present, otherwise config `defaultTools`; an empty effective set becomes `--no-tools`. When `handoff: true`, `scheduled_task_handoff` is automatically appended to the effective tool list.

Handoff is opt-in cross-run memory:

- Normal Pi sessions never receive `scheduled_task_handoff`.
- Scheduled child sessions receive `scheduled_task_handoff` instead of the management tool.
- The tool reads or atomically replaces only `handoffs/<task-id>.md` for `PI_SCHEDULED_TASK_ID`.
- The prompt includes previous handoff content only when `handoff: true` and the file exists with non-empty content.
- Updating handoff writes a `handoff-updated` marker in the current run directory; `result.json` records whether the marker was observed.

Keep the handoff model narrow. It exists to make recurrence intentional and auditable, not to create hidden global memory or automatic context injection into normal sessions.

## Commands and agent tools

Slash commands are for interactive users:

- `/tasks-list`, `/tasks-show`, `/tasks-doctor`
- `/tasks-run`, `/tasks-logs`, `/tasks-tick [--dry-run]`
- `/tasks-install-cron`, `/tasks-uninstall-cron`
- `/scheduled-tasks-config` from the shared config helper

Agent tools are deliberately smaller:

- `scheduled_tasks`: list/read/validate/run/logs/doctor for existing task files.
- `scheduled_task_handoff`: read/update only during scheduled child runs.

The bundled `manage-scheduled-tasks` skill is contributed through `resources_discover` only for normal sessions. Keep it colocated with the extension so task-authoring guidance evolves with the parser and validator. Do not load it inside scheduled child runs; child runs should focus on the task prompt and optional handoff, not task management.

V1 intentionally does not expose structured create/update/delete task actions. Agents should edit Markdown files with normal file tools, then run validation. This keeps task definitions inspectable and avoids inventing a second task-definition API.

## Cron integration

Doctor surfaces inspect crontab status by reading `crontab -l` and checking only for the marked managed block. They report installed, not installed, or unavailable without mutating crontab.

`/tasks-install-cron` owns one marked crontab block and leaves unrelated entries untouched. The block captures the project cwd at install time and invokes the configured Pi command directly:

```cron
# BEGIN PI SCHEDULED TASKS
* * * * * cd '<project-cwd>' && env PATH='<optional-cron-path>' '<pi>' --mode json --no-session -p '/tasks-tick'
# END PI SCHEDULED TASKS
```

Configurable values are shell-quoted. `piCommand` is treated as an executable path or command name, not as a shell snippet. `cronEnvironment` is emitted inline after `cd ... && env` so configured variables are scoped to the managed Pi process and do not bleed into unrelated crontab entries. Future cron changes should preserve the managed-block boundary and inline environment scoping so uninstall remains safe and the extension does not alter global cron behavior.

## State and atomicity

The extension uses JSON files instead of SQLite because v1 state is tiny and scoped per task. Writes go through temp-file-plus-rename helpers. State files are best-effort durable metadata, while run directories are the durable audit trail for what happened.

Important persistence rules:

- Do not store scheduler state in task frontmatter.
- Do not delete or rewrite run artifacts as part of normal inspection.
- Preserve `result.json` as the compact machine-readable run summary.
- Keep raw child output in bounded inspection surfaces; read tails instead of loading entire large logs.

## Security and safety boundaries

The extension assumes the configured root is local user-controlled storage. It does not try to make task files secret or sandboxed. Task `env` values are plain text and may be visible in task files, commands, tools, child processes, and logs.

Security-relevant invariants:

- Route all task-addressed paths through `paths.ts` safe builders.
- Keep task ID validation strict; do not permit slashes, dots, or arbitrary relative paths.
- Spawn child Pi with argv arrays, not shell concatenation.
- Treat `piCommand` as a command/path only.
- Keep management tooling unavailable inside scheduled child runs.
- Keep handoff tooling scoped to the current task and disabled outside child runs.
- Avoid force-unlock or destructive cleanup features unless their failure modes are designed explicitly.

## Extension boundaries

This extension owns recurring Pi execution inside the current user's Pi environment. It does not own:

- worktree creation or sandbox lifecycle;
- workflow orchestration across multiple steps;
- external trigger systems such as GitHub webhooks;
- secret storage;
- generic cron management outside the marked block;
- durable databases or dashboards.

If future work needs those capabilities, prefer integrating with dedicated tools rather than expanding scheduled-tasks into a general orchestrator.

## Change guidance for future agents

When changing scheduled-tasks:

1. Read `README.md` and this file first; keep both in sync when user-facing behavior changes.
2. Prefer changing parser/validator/scheduler/spawn logic in their existing modules instead of adding cross-cutting behavior in commands or tools.
3. Add or update tests for cron decisions, validation, spawn plans, locking/state behavior, and tool availability when relevant.
4. Run `make typecheck` and `make test` before reporting completion for extension changes.
5. Be conservative with new permissions, persistence, and cleanup features; recurring autonomous execution magnifies small unsafe defaults.
