---
name: manage-scheduled-tasks
description: Use when creating, editing, validating, manually running, or debugging Pi scheduled task Markdown files managed by the scheduled-tasks extension.
---

# Manage Scheduled Tasks

Use this skill to manage Markdown-defined Pi scheduled tasks. The `scheduled_tasks` tool is for inspection, validation, manual runs, logs, and scheduler health. Create and edit task definitions with normal file tools, then validate with `scheduled_tasks`.

## Workflow

1. Inspect the scheduler root with `scheduled_tasks` action `doctor`. The first line reports `rootDir`.
2. List or read existing tasks with `scheduled_tasks` action `list` or `read` when modifying an existing task.
3. Create or edit only `<rootDir>/tasks/<task-id>.md` for task definitions.
4. Validate after every create or edit with `scheduled_tasks` action `validate` and the task ID.
5. Fix validation errors before enabling or manually running a task.
6. Use `scheduled_tasks` action `run` only after validation passes or when explicitly debugging a failing task. Manual runs are synchronous and do not advance scheduler `nextRunAt`.
7. Use `scheduled_tasks` action `logs` after a manual or scheduled run to inspect results. Scheduled tick summaries report launch outcomes such as `launched`; final success/failure appears later in logs and lifecycle artifacts.

## Task file rules

Task files use YAML frontmatter plus a Markdown body:

```md
---
id: dependency-audit
description: Check dependencies weekly
enabled: false
schedule: "0 9 * * 1"
cwd: /absolute/path/to/project
tools:
  - read
  - grep
envFiles:
  - .env
env:
  NODE_ENV: production
executionShell: bash-login
timeoutMinutes: 30
catchup: false
handoff: false
---

Review dependency status and summarize any issues.
```

Follow these constraints:

- Use task IDs containing only letters, numbers, underscores, and hyphens. Do not use slashes or dots.
- Prefer omitting `id`; when present, it must match the filename without `.md`.
- Keep new or uncertain tasks `enabled: false` unless the user explicitly asks to schedule them.
- Enabled tasks require a five-field cron `schedule`, an absolute existing `cwd`, and a non-empty body.
- Keep `tools` as an explicit allowlist. If omitted, the extension's configured `defaultTools` apply.
- Set `catchup: true` only when one coalesced make-up run is useful after downtime; missed occurrences are not replayed one-by-one and global config caps catchups per tick. Active scheduled runs are also capped globally by `maxConcurrentScheduledRuns`.
- Set `handoff: true` only when cross-run memory is useful. The `scheduled_task_handoff` tool is added automatically for scheduled child runs.
- Write task prompts to be idempotent where practical: inspect current external state before creating tickets, branches, reports, deployments, or other irreversible changes, because crash recovery may retry work and cron-style systems cannot promise exact-once execution.
- Use `envFiles` for dotenv-style bulk environment defaults. Relative env file paths resolve against `cwd`, and listed files are required in v1.
- Use inline `env` for explicit overrides; inline `env` wins over `envFiles`, and scheduled-run marker variables win over both.
- Use `executionShell: bash-login` only when the task needs bash login startup files for development environment setup; omit it for direct Pi execution. Task env is present when bash starts, but shell startup files may change it.
- Do not put secrets in `env` or env files; child processes and run logs can expose values.
- Use only simple YAML supported by the extension: scalars, arrays with `- item`, and one-level object maps such as `env:`.

## Safety boundaries

Do not edit scheduler-owned runtime data during normal management:

- `<rootDir>/state/`
- `<rootDir>/runs/`
- `<rootDir>/locks/`
- `<rootDir>/sessions/`

Read run artifacts only when needed for debugging. Do not delete locks or run artifacts unless the user explicitly asks and the failure mode has been investigated.

## More detail

For more detail on user-facing behavior, read `../../README.md`. Only inspect source files in `../..` if validation output or README behavior is insufficient.
