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
6. Use `scheduled_tasks` action `run` only after validation passes or when explicitly debugging a failing task.
7. Use `scheduled_tasks` action `logs` after a manual or scheduled run to inspect results.

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
timeoutMinutes: 30
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
- Set `handoff: true` only when cross-run memory is useful. The `scheduled_task_handoff` tool is added automatically for scheduled child runs.
- Do not put secrets in `env`; task files, child processes, and run logs can expose values.
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
