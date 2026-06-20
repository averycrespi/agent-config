# Scheduled Tasks Extension Plan

## Goal

Build a Pi `scheduled-tasks` extension that lets users and agents define recurring Pi tasks as Markdown files with YAML frontmatter, run them manually or from cron, isolate every run in a scheduled-task session directory, persist handoff files between runs, and inspect/debug run history from Pi.

The v1 feature should be intentionally conservative: markdown-defined Pi runs only, no precheck scripts, no no-agent mode, no catch-up support, and no handoff leakage into normal Pi sessions.

## Background / Repo Context

- This repository manages Pi agent configuration under `pi/agent/`; extension code belongs under `pi/agent/extensions/<name>/`.
- Repo conventions require directory-based Pi extensions, colocated tests, shared config/logging helpers, config inspection commands, snake_case agent-tool schemas, and recoverable tool errors returned as text. See `CLAUDE.md`.
- Pi extension conventions to reuse:
  - `pi/agent/extensions/_shared/config.ts` for settings/env merge and `/scheduled-tasks-config`.
  - `pi/agent/extensions/_shared/logging.ts` for retained diagnostic logs if needed.
  - `pi/agent/extensions/_shared/render.ts` for compact width-aware tool renderers.
  - `pi/agent/extensions/subagents/spawn.ts` for child-process spawn/abort/log/spillover patterns.
  - `pi/agent/extensions/todo/index.ts` and `pi/agent/extensions/todo/tools.ts` for command/tool/state persistence and compact rendering patterns.
- Pi supports headless print mode, custom session dirs, named sessions, model/thinking/tool CLI options, and extension-provided tools/commands. Scheduled runs should use those existing Pi surfaces rather than introducing a second agent runner.
- Prior art:
  - Hermes Agent cron uses a unified action-style `cronjob` tool, fresh agent sessions, persistent job/output state, tick locks, output chaining, and defensive cron-run restrictions. Source: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/cron.md
  - Claude Code `/loop` is session-scoped and expires; Claude Desktop scheduled tasks are persistent local tasks with fresh sessions, manual Run Now, run history, per-task permissions, and editable Markdown prompt files; Claude Routines are cloud-triggered fresh sessions. Sources: https://code.claude.com/docs/en/scheduled-tasks, https://code.claude.com/docs/en/desktop-scheduled-tasks, https://code.claude.com/docs/en/routines

## Acceptance Criteria

- AC-1: A new directory extension exists at `pi/agent/extensions/scheduled-tasks/` with an `index.ts`, README, tests for meaningful pure logic, and a `pi-task-scheduler.mjs` CLI helper entrypoint.
- AC-2: The extension loads configuration from `extension:scheduled-tasks` settings plus environment overrides, creates/uses a configurable root directory, supports explicit defaults for timeouts/tools and scheduler executable paths, and registers `/scheduled-tasks-config` showing effective parsed config.
- AC-3: Task files under `<root>/tasks/*.md` parse YAML frontmatter plus Markdown body, reject unsafe task IDs, require `enabled: true` before scheduled execution, keep volatile runtime state out of task frontmatter, and are validated/linted by a shared validator used by doctor commands, tools, and scheduler ticks.
- AC-4: The v1 root layout is implemented and documented: `tasks/`, `handoffs/`, `state/`, `sessions/`, `runs/`, and `locks/`.
- AC-5: `/tasks-list`, `/tasks-show <task-id>`, `/tasks-run <task-id>`, `/tasks-logs <task-id>`, `/tasks-doctor [task-id]`, `/tasks-install-cron`, and `/tasks-uninstall-cron` are registered and work in normal Pi sessions.
- AC-6: A single management tool named `scheduled_tasks` supports action-style operations for normal sessions: `list`, `read`, `validate`, `run`, `logs`, and `doctor`, with snake_case schema fields and recoverable validation errors returned in tool result text. V1 does not implement structured `create` or `update` actions; task creation/editing happens by normal Markdown file edits followed by validation.
- AC-7: A separate env-gated `scheduled_task_handoff` tool is available only during scheduled child runs for tasks with `handoff: true`, is scoped to the current task from `PI_SCHEDULED_TASK_ID`, and can read/update that task's handoff file atomically. For `handoff: false` or omitted, the tool is unavailable or returns a clear unavailable error, and no handoff prompt section is rendered.
- AC-8: Normal Pi sessions never automatically include task handoff content and do not expose the scheduled-run handoff context unless explicitly inspecting a task through commands/tools.
- AC-9: `/tasks-run <task-id>` and scheduler ticks spawn a child Pi process rather than executing the task in the current session, set scheduled-run env vars, use a task-specific session dir, compute a safe effective tool allowlist, render an exact `prompt.md`, and write run artifacts.
- AC-10: Each run creates `<root>/runs/<task-id>/<run-id>/prompt.md`, `output.md` when available, `result.json`, and `pi.log` or equivalent raw execution log. `result.json` includes task ID, run ID, status, start/end timestamps, child exit/timeout status, session file if discoverable, and whether handoff was updated.
- AC-11: The scheduler uses a single tick entrypoint (`pi-task-scheduler.mjs tick`) that scans due enabled tasks, uses scheduler/task locks to prevent duplicate and overlapping runs, initializes missing `nextRunAt` deterministically, advances `nextRunAt` when claiming scheduled work, and updates `state/<task-id>.json` after completion.
- AC-12: V1 does not implement precheck scripts, no-agent/script-only jobs, or catch-up runs. Missed schedules are not replayed; state may record a missed/skipped reason and computes the next future run according to the documented due-window semantics.
- AC-13: `/tasks-install-cron` and `/tasks-uninstall-cron` modify only a clearly marked managed crontab block, use the configured/resolved Node executable path, shell-quote configurable paths/env values safely, and leave unrelated crontab entries untouched.
- AC-14: The `pi-task-scheduler.mjs` helper has a concrete runtime loading strategy that works from Node without relying on Pi extension loading or dev-only dependencies, and a local smoke check such as `node pi/agent/extensions/scheduled-tasks/pi-task-scheduler.mjs --help` or `tick --dry-run` passes.
- AC-15: The README documents user behavior, configuration, environment overrides, task file format, root layout, commands, tools, scheduled-run env vars, cron behavior, logs/artifacts, security defaults, v1 non-goals, and prior art.
- AC-16: `make typecheck` and `make test` pass. If formatting/linting is affected, `npm run format:check` and `npm run lint` pass or failures are reported with evidence.

## Non-Goals / Out of Scope

- No pre-run script gates, `wakeAgent`, or no-agent/script-only jobs in v1.
- No catch-up policy field or replay of missed runs in v1.
- No arbitrary `piArgs` passthrough in task frontmatter.
- No force unlock, destructive cleanup, delete-all-runs, or direct crontab ownership outside the managed block.
- No cloud/webhook/GitHub event triggers in v1.
- No task file format intended to be compatible with Claude Desktop `SKILL.md`; inspiration only.
- No structured `create` or `update` actions in the `scheduled_tasks` tool for v1; Pi can create/edit task Markdown with built-in file tools, then validate it.
- No automatic commits, pushes, or external delivery channels.

## Constraints

- Keep the public repository sanitized: no private company/project names, internal URLs, tokens, or credentials.
- Do not edit files directly under `~/.pi/`; modify the source extension under `pi/agent/extensions/scheduled-tasks/`.
- Use repo shared helpers for config/logging/rendering where applicable.
- Agent-facing schemas use snake_case; internal TypeScript may use camelCase.
- Tool mutations must validate completely, apply atomically, and return readable error text instead of throwing for recoverable user/model mistakes.
- Child-process code should be testable using wrapper exports for Node built-ins, following the subagents spawn pattern.
- Scheduled-run mode is selected by environment variables set by the scheduler/manual-run command; treat env vars as activation/context, not a security boundary. Validate task IDs and paths against the configured root.

## Chosen Approach

Implement the extension as two cooperating surfaces:

1. **Pi extension surface** in `pi/agent/extensions/scheduled-tasks/`: commands, tools, configuration, task parsing, prompt rendering, manual runs, handoff tool gating, docs, and tests.
2. **Scheduler CLI helper** `pi-task-scheduler.mjs`: the cron entrypoint. It loads the same scheduler/task logic, performs due-task ticks, claims work with locks/state, and spawns child Pi runs.

Tasks are Markdown files with YAML frontmatter. Frontmatter defines stable desired behavior; the Markdown body is the task prompt. Volatile runtime state lives in `state/*.json`, run artifacts live in `runs/`, Pi session JSONL lives under task-specific `sessions/`, and cross-run memory lives in `handoffs/*.md` only when `handoff: true`.

Manual runs and cron runs share the same child-process execution path. The child Pi process receives env vars that put the extension in scheduled-run mode and enable only scoped handoff behavior for the current task. Normal Pi sessions can manage/debug tasks but do not automatically load or inject handoff content.

## Design Decisions

- D1: **Task definition is Markdown + frontmatter.** This keeps tasks human-editable, agent-editable, versionable, and portable across host/sandbox mounts.
- D2: **Runtime state is separate JSON.** Avoid rewriting task files after every run and keep task prompt diffs meaningful.
- D3: **One configurable root directory.** All persistent scheduled-task state lives under one mountable root so host/sandbox persistence is explicit.
- D4: **Fresh Pi session per run.** Use handoff files for intentional cross-run memory and avoid growing/resuming old scheduled-session context by default.
- D5: **`handoff: true` is v1 boolean only.** It creates/uses `<root>/handoffs/<task-id>.md`, includes it only in scheduled-run prompts, and enables scoped handoff update tooling.
- D6: **Scheduled-run mode is env-gated.** Use `SCHEDULED_TASKS_ROOT_DIR` for the configured root and `PI_SCHEDULED_TASK_RUN=1`, `PI_SCHEDULED_TASK_ID`, and `PI_SCHEDULED_TASK_RUN_ID` for child-run context. Do not introduce `PI_SCHEDULED_TASK_ROOT` in v1; keeping root under the plural extension-scoped env name avoids singular/plural typo ambiguity.
- D7: **One tick cron entry, not per-task crontab lines.** Crontab only wakes the scheduler; task files and state remain the source of truth.
- D8: **CLI helper is named `pi-task-scheduler`.** The extension remains `scheduled-tasks`; the cron/helper executable is differentiated as the scheduler.
- D9: **Commands are short multiple `/tasks-*` commands.** This supports slash-command autocomplete without a long `/scheduled-tasks-*` prefix. Config keeps the conventional `/scheduled-tasks-config` name.
- D10: **Management tool is unified as `scheduled_tasks`.** It reduces Pi tool-list clutter while still giving the agent a structured management/debug surface.
- D11: **Handoff tool is distinct as `scheduled_task_handoff`.** It is current-task scoped and only meaningful in scheduled child runs.
- D12: **No precheck/no-agent/catch-up in v1.** Deferring these avoids premature security and scheduler complexity.
- D13: **Enabled is explicit.** Omitted `enabled` means disabled for scheduled execution, so half-authored task files do not run unattended.
- D14: **`cwd` is required for enabled scheduled tasks.** Unattended file/tool behavior should be explicit. Manual doctor/read can still inspect disabled tasks without a valid `cwd`.
- D15: **Tool permissions use an explicit effective allowlist.** Task `tools` never fall through to Pi's broad default tool set. If a task omits `tools`, use configured `defaultTools`; when `handoff: true`, automatically add `scheduled_task_handoff` to the effective child allowlist.
- D16: **Cron commands use resolved executable paths.** `/tasks-install-cron` should use the configured/resolved Node command for the scheduler helper, and child runs should use configurable `piCommand` rather than assuming cron's PATH contains `node` and `pi`.

## Configuration

Use shared config helpers and document every user-facing field with an environment override:

| Field                   | Default                          | Environment override                      | Description                                                                                                                                                               |
| ----------------------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`               | `~/.pi/scheduled-tasks`          | `SCHEDULED_TASKS_ROOT_DIR`                | Persistent root containing tasks, handoffs, state, sessions, runs, and locks.                                                                                             |
| `defaultTimeoutMinutes` | `30`                             | `SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES` | Default child Pi timeout when a task omits `timeoutMinutes`.                                                                                                              |
| `defaultTools`          | `["read", "grep", "find", "ls"]` | `SCHEDULED_TASKS_DEFAULT_TOOLS`           | Comma-separated default tool allowlist used when a task omits `tools`. An empty array means spawn with `--no-tools` unless `handoff: true` adds `scheduled_task_handoff`. |
| `piCommand`             | `pi`                             | `SCHEDULED_TASKS_PI_COMMAND`              | Executable path or command name used for child Pi runs. Treat as a command path, not a shell string.                                                                      |
| `nodeCommand`           | `process.execPath`               | `SCHEDULED_TASKS_NODE_COMMAND`            | Executable path or command name inserted into the managed cron line for `pi-task-scheduler.mjs`. Treat as a command path, not a shell string.                             |

`/scheduled-tasks-config` and `/tasks-doctor` should show resolved config. `/tasks-doctor` should additionally report whether `piCommand` and `nodeCommand` appear executable/resolvable in the current environment and warn when they rely on PATH.

## Frontmatter Shape

V1 should support this stable subset:

```yaml
---
id: dependency-audit
description: Check dependencies weekly
enabled: true
schedule: "0 9 * * 1"
cwd: /workspace/my-project
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
```

Field notes:

- `id`: optional only if derived safely from filename; if present, must match filename/task ID.
- `description`: optional display/help text.
- `enabled`: must be `true` for scheduled tick execution.
- `schedule`: required for enabled scheduled tasks; support standard 5-field cron expressions in v1 unless implementation chooses to add safe simple aliases with tests.
- `cwd`: required for enabled tasks; must be an absolute existing directory.
- `model`, `thinking`, `tools`: optional Pi execution options mapped to named CLI flags. If `tools` is omitted, use config `defaultTools` rather than Pi's built-in defaults.
- `env`: optional child-process env additions; never render values into prompts/logs without masking.
- `timeoutMinutes`: optional per-task override of global default.
- `handoff`: boolean only in v1.

Avoid `piArgs`, `script`, `precheck`, `catchUp`, or arbitrary path fields in v1.

## Task Validation / Linting

Implement one shared task validator and use it everywhere task correctness matters:

- `/tasks-doctor` validates every task and root/scheduler/cron health.
- `/tasks-doctor <task-id>` validates one task and shows the resolved execution package.
- `scheduled_tasks({ action: "validate", task_id: "..." })` validates one task.
- `scheduled_tasks({ action: "validate" })` validates all tasks.
- `scheduled_tasks({ action: "doctor" })` includes task validation plus root/scheduler/cron health.
- Scheduler ticks run validation before claiming work; invalid enabled tasks are skipped and state/logs record validation failure details instead of spawning Pi.

Validation result shape should distinguish:

- **Errors**: invalid YAML/frontmatter, unsafe or mismatched task ID, missing Markdown body, enabled task missing `schedule` or absolute existing `cwd`, invalid cron expression, invalid `tools`/`thinking`/`model` shape, invalid `env` object, invalid `timeoutMinutes`, invalid configured command/default tool values, or root path escape.
- **Warnings**: disabled task, missing description, handoff enabled but file absent, no task-specific tools specified so config `defaultTools` will be used, sensitive-looking env keys configured, command paths relying on PATH, or stale/missing state that can be regenerated.

Validation output should be both human-readable and machine-readable in tool `details` so agents can fix task files and re-run validation. Per-task validation/doctor output should include the resolved effective tool allowlist, including an explicit note that `scheduled_task_handoff` is added automatically when `handoff: true`.

## Persistent Root Layout

The configured root should be created as needed with owner-only permissions where practical:

```text
<root>/
  tasks/
    <task-id>.md
  handoffs/
    <task-id>.md
  state/
    <task-id>.json
  sessions/
    <task-id>/
  runs/
    <task-id>/
      <run-id>/
        prompt.md
        output.md
        result.json
        pi.log
  locks/
    scheduler.lock
    <task-id>.lock
```

State example:

```json
{
  "taskId": "dependency-audit",
  "nextRunAt": "2026-06-22T09:00:00Z",
  "lastRunAt": "2026-06-19T09:00:00Z",
  "lastStatus": "success",
  "lastRunId": "2026-06-19T09-00-00Z-a1b2c3",
  "lastSkipReason": null
}
```

Lock files should include JSON metadata such as task ID, run ID, PID, hostname, and startedAt. Stale-lock handling should be conservative and well-tested; do not blindly remove locks.

## Commands

Register these commands:

- `/tasks-list`: list task IDs, enabled state, description, next run, and last status.
- `/tasks-show <task-id>`: show parsed task metadata and task body path/content summary.
- `/tasks-run <task-id>`: manually spawn a scheduled child Pi run. This is out-of-band and should not advance `nextRunAt` unless future design says otherwise.
- `/tasks-logs <task-id>`: show latest run summary, artifact paths, last failure reason, and a bounded tail/summary of output/logs.
- `/tasks-doctor [task-id]`: with no task, check root/config/cron/parse health; with a task, render resolved execution package without running Pi.
- `/tasks-install-cron`: install/update the managed crontab block for the current effective root/helper path.
- `/tasks-uninstall-cron`: remove only the managed crontab block.
- `/scheduled-tasks-config`: registered via shared config helper.

Command argument completion should be added where practical for task IDs.

## Tools

### `scheduled_tasks`

Available in normal sessions. Action-style management/debug tool with a compact schema, for example:

```ts
{
  action: "list" | "read" | "validate" | "run" | "logs" | "doctor";
  task_id?: string;
}
```

V1 deliberately omits agent-driven structured `create`/`update` actions. Task creation/editing happens by normal Markdown file edits using Pi's built-in file tools, then `scheduled_tasks({ action: "validate", task_id: "..." })` or `/tasks-doctor <task-id>` checks the result.

Tool behavior:

- Return human-readable text plus structured details.
- Use task IDs, not arbitrary paths.
- `validate` checks one task when `task_id` is provided and all tasks when omitted; `doctor` includes validation plus root/scheduler/cron health.
- In scheduled-run mode, either do not register this tool or refuse schedule mutations/management actions with a clear text error.

### `scheduled_task_handoff`

Available only when `PI_SCHEDULED_TASK_RUN=1`, a valid current task is resolved, and that task has `handoff: true`.

Schema example:

```ts
{
  action: "read" | "update";
  content?: string;
}
```

Behavior:

- Reads/updates only `<root>/handoffs/<current-task-id>.md`.
- Creates the handoff file on first update.
- Writes atomically.
- Tracks in run metadata that the handoff was updated.
- Returns clear text errors for invalid action/content or unavailable scheduled-run context.
- For scheduled runs whose task has `handoff: false` or omits `handoff`, do not render previous handoff content and either do not register this tool or return `Error: handoff is not enabled for this task.`

## Scheduled-Run Environment

Child Pi runs should set at least:

```text
SCHEDULED_TASKS_ROOT_DIR=<root>
PI_SCHEDULED_TASK_RUN=1
PI_SCHEDULED_TASK_ID=<task-id>
PI_SCHEDULED_TASK_RUN_ID=<run-id>
```

Use `SCHEDULED_TASKS_ROOT_DIR` for the root so the root env var matches the extension-scoped config override. Use `PI_SCHEDULED_TASK_*` only for the singular current-run task context. Do not introduce `PI_SCHEDULED_TASK_ROOT` in v1.

Optional internal env vars may include paths to run dir, prompt file, result file, or handoff update marker if that simplifies robust metadata collection. Validate all env-derived IDs/paths against the configured root before use.

Scheduled-run env only activates scheduled-run behavior. It does not override the parsed task file: if the current task is missing, unsafe, or has `handoff` disabled, scoped handoff behavior must remain unavailable.

## Prompt Composition

Render exactly one prompt file per run at `<root>/runs/<task-id>/<run-id>/prompt.md` and pass it to Pi by file reference.

Suggested prompt structure:

```md
# Scheduled task run

Task ID: <task-id>
Run ID: <run-id>

You are running as a scheduled Pi task.

Rules:

- Do the task described below.
- Your final response should summarize what you did and any issues.
- If a `Previous handoff` section is present, use it as prior context and update the handoff at the end of meaningful work using `scheduled_task_handoff`.

## Previous handoff

<contents of handoffs/<task-id>.md; omit this entire section when handoff is false or omitted>

## Task

<Markdown body from tasks/<task-id>.md>
```

Do not include raw environment variable values, unrelated state, all previous run logs, or normal Pi session history.

## Child Pi Spawn

Map frontmatter/config to Pi CLI flags using an argument array, not shell string concatenation:

```text
<piCommand> --mode json \
   --session-dir <root>/sessions/<task-id> \
   --name "scheduled: <task-id> <run-id>" \
   [--model <model>] \
   [--thinking <level>] \
   [--tools <effective-comma-list> | --no-tools] \
   -p @<run-dir>/prompt.md
```

Effective tools:

- If task `tools` is present, start with that list.
- If task `tools` is omitted, start with config `defaultTools` instead of Pi's built-in defaults.
- If `handoff: true`, add `scheduled_task_handoff` to the effective allowlist automatically, even when task `tools` is explicit.
- If the effective allowlist is empty after this logic, pass `--no-tools`.
- Do not mutate the task file when adding implicit/default tools; report the effective list in doctor/validate output.

Use the task `cwd` as the child process working directory. Apply task `env` only to the child process environment and mask sensitive-looking keys in logs/doctor output. Use `--mode json` so the scheduler can parse structured events, capture final output, and discover session metadata when available.

Timeout behavior:

- Default from config, e.g. `defaultTimeoutMinutes: 30`.
- Optional per-task `timeoutMinutes` override.
- On timeout, send `SIGTERM`; after a short grace period, send `SIGKILL`.
- Mark `result.json` with timeout status and release locks.

## Scheduler Tick Behavior

The `pi-task-scheduler.mjs tick` helper should:

1. Load config/root.
2. Acquire scheduler lock.
3. Ensure root subdirectories exist.
4. Parse task files and current state.
5. For each enabled due task, acquire its task lock.
6. Claim scheduled work by computing and writing the next future `nextRunAt` before spawning Pi.
7. Release scheduler lock once claims are made.
8. Spawn child Pi for claimed tasks, respecting task locks and timeout.
9. Write run artifacts and update `lastRunAt`, `lastStatus`, `lastRunId`, and skip/failure fields.
10. Release task locks.

V1 may run claimed tasks serially if that substantially reduces complexity. Parallel execution can come later as long as locks already prevent same-task overlap.

Due and missed schedule semantics:

- If `state/<task-id>.json` is missing or has no valid `nextRunAt`, initialize `nextRunAt` to the next future occurrence strictly after the current tick time and do not run the task on that same initialization tick. Users can use `/tasks-run <task-id>` for immediate first execution.
- A task is due only when `nextRunAt <= now` and `now - nextRunAt <= dueGraceSeconds`.
- Use a fixed v1 `dueGraceSeconds` of 90 seconds to tolerate a once-per-minute cron tick starting slightly late. If implementation makes it configurable, document and test the default.
- If `nextRunAt` is older than the due grace window, treat it as missed, do not run it, compute the next future occurrence strictly after now, and optionally record `lastSkipReason: "missed_schedule"`.
- When claiming a due task, compute and persist the next future occurrence strictly after now before spawning Pi.

Manual `/tasks-run`:

- Uses the same spawn/run artifact path.
- Does not require `enabled: true` unless implementation chooses stricter behavior; it should still validate `cwd` and task config.
- Does not advance `nextRunAt`.

## Cron Management

Use one managed crontab block, not one line per task:

```cron
# BEGIN PI SCHEDULED TASKS
* * * * * SCHEDULED_TASKS_ROOT_DIR='<shell-quoted-root>' SCHEDULED_TASKS_PI_COMMAND='<shell-quoted-pi-command>' '<shell-quoted-node-command>' '<shell-quoted-extension-path>/pi-task-scheduler.mjs' tick
# END PI SCHEDULED TASKS
```

Implementation notes:

- The exact env var names should match config env overrides; use `SCHEDULED_TASKS_ROOT_DIR` for root and `SCHEDULED_TASKS_PI_COMMAND` for the child Pi executable so the helper can resolve effective config under cron.
- Use config `nodeCommand` for the command that executes `pi-task-scheduler.mjs`; default it to `process.execPath` at install time rather than a bare `node` assumption.
- Shell-quote every configurable value inserted into the cron command, including root paths, helper paths, `nodeCommand`, `piCommand`, and any future command path. Paths with spaces must work, and metacharacters must not be executable as shell syntax. Add tests for spaces and shell metacharacters in root/helper/command paths.
- Treat `nodeCommand` and `piCommand` as executable paths or command names, not arbitrary shell snippets. Spawn child Pi with `child_process.spawn(command, args, ...)`, never by concatenating a shell command.
- Preserve unrelated crontab content exactly.
- `/tasks-install-cron` should replace only an existing managed block or append a new one.
- `/tasks-uninstall-cron` should remove only the managed block.
- `/tasks-doctor` should report whether the managed block is installed and points at the expected helper/root/node/pi command values.

## Suggested Implementation Files

- `pi/agent/extensions/scheduled-tasks/index.ts`: extension entrypoint, command registration, mode detection, tool registration.
- `pi/agent/extensions/scheduled-tasks/config.ts`: config defaults, env parsing, validation, shared config command integration.
- `pi/agent/extensions/scheduled-tasks/task-file.ts`: Markdown/frontmatter parsing, task ID validation, task metadata types.
- `pi/agent/extensions/scheduled-tasks/validate.ts`: shared task validator/linter used by `/tasks-doctor`, `scheduled_tasks` `validate`/`doctor`, and scheduler ticks.
- `pi/agent/extensions/scheduled-tasks/paths.ts`: root layout/path resolution helpers and safe ID-to-path mapping.
- `pi/agent/extensions/scheduled-tasks/state.ts`: state JSON read/write, next-run claim/update logic, run result metadata.
- `pi/agent/extensions/scheduled-tasks/schedule.ts`: cron parsing and next future run calculation.
- `pi/agent/extensions/scheduled-tasks/locks.ts`: scheduler/task lock helpers with metadata and conservative stale handling.
- `pi/agent/extensions/scheduled-tasks/prompt.ts`: prompt rendering with optional handoff.
- `pi/agent/extensions/scheduled-tasks/spawn.ts`: child Pi spawn, timeout, output/log capture; follow subagents wrapper-export pattern.
- `pi/agent/extensions/scheduled-tasks/scheduler.ts`: tick/manual run orchestration shared by extension commands and CLI helper.
- `pi/agent/extensions/scheduled-tasks/tools.ts`: `scheduled_tasks` and `scheduled_task_handoff` definitions and renderers.
- `pi/agent/extensions/scheduled-tasks/commands.ts`: slash command handlers and task ID completions.
- `pi/agent/extensions/scheduled-tasks/pi-task-scheduler.mjs`: Node CLI entrypoint for cron. It must be runnable directly with `node`; use a concrete strategy such as a small JS wrapper that registers a TypeScript runtime loader and imports `scheduler-cli.ts`, or implement the CLI/runtime boundary in JavaScript modules imported by TypeScript. If using a runtime loader such as `tsx`, make it a runtime dependency or otherwise ensure it is available wherever the cron helper runs; do not rely on dev-only dependencies for cron execution.
- `pi/agent/extensions/scheduled-tasks/README.md`: user-facing docs.
- `pi/agent/extensions/scheduled-tasks/*.test.ts`: colocated pure logic tests.

If adding dependencies for YAML/frontmatter parsing, cron expression parsing, or TypeScript runtime loading, add them as direct runtime `dependencies` unless they are used only by tests/build-time code. Do not rely on transitive or dev-only packages for scheduler/runtime behavior. If avoiding dependencies, implement small internal parsers with focused tests for the supported v1 subset.

## Documentation Impact

Add `pi/agent/extensions/scheduled-tasks/README.md` with:

- Overview and v1 scope.
- Root layout.
- Configuration table with defaults and env overrides, including `rootDir`, `defaultTimeoutMinutes`, `defaultTools`, `piCommand`, and `nodeCommand`.
- Task file/frontmatter format.
- Task validation/linting behavior, including errors versus warnings and how `/tasks-doctor` and `scheduled_tasks({ action: "validate" })` report them.
- Handoff behavior, scheduled-run env gating, and automatic inclusion of `scheduled_task_handoff` in effective child tools when `handoff: true`.
- Commands and tools, including that v1 omits structured `create`/`update` tool actions and expects normal Markdown file edits followed by validation.
- Manual run and cron installation behavior.
- Run artifacts/log locations, retention/deletion behavior, and raw output sensitivity warning.
- Security defaults and limitations, including that omitted task `tools` uses `defaultTools` rather than Pi's broad default tool set.
- Explicit non-goals: no precheck/no-agent/catch-up in v1.
- `## Prior art` linking Hermes cron and Claude scheduled tasks/routines with one-sentence influence notes.

No top-level README update is required unless the implementation changes repository-wide setup commands or package scripts.

## Testing / Verification

- V1: `make typecheck` passes.
- V2: `make test` passes, including scheduled-tasks tests.
- V3: If implementation touches formatting/lintable TypeScript/Markdown, `npm run format:check` and `npm run lint` pass or failures are explicitly reported.
- V4: Unit tests cover config/env parsing, task ID validation, task frontmatter parsing, validator errors/warnings, root path safety, prompt rendering with and without handoff, effective tool allowlist construction including default tools and implicit `scheduled_task_handoff`, schedule next-run behavior, state claim/update behavior, lock behavior, spawn args/env construction, and tool validation.
- V5: Integration-style test with a temp root and mocked child spawn proves a scheduler tick creates a run dir, renders `prompt.md`, writes `result.json`, updates `state/*.json`, and releases locks.
- V6: Command/tool behavior is verified without a real LLM by invoking pure handlers or exported helpers where practical.
- V7: Manual inspection or test proves normal mode does not include handoff content and scheduled-run mode exposes only scoped `scheduled_task_handoff` behavior.
- V8: Cron install/uninstall tests prove unrelated crontab content is preserved while the managed block is added/replaced/removed and configurable paths/env values are shell-quoted safely, including root/helper/node/pi paths with spaces and shell metacharacters.
- V9: A CLI helper smoke check proves `pi-task-scheduler.mjs` is runnable directly with Node in this repo, at least for `--help` or `tick --dry-run`, and does not depend on dev-only packages for runtime behavior.

## Risks and Mitigations

- **Risk: Handoff content leaks into normal sessions and confuses the model.** Mitigation: only include handoff in rendered scheduled-run prompts and only register/enable `scheduled_task_handoff` when scheduled-run env validates and the current task has `handoff: true`.
- **Risk: `handoff: true` tasks cannot update handoff because `--tools` hides extension tools.** Mitigation: compute an effective child tool allowlist and automatically add `scheduled_task_handoff` whenever handoff is enabled.
- **Risk: Omitted task `tools` silently grants Pi's broad default tool set.** Mitigation: omitted task tools use config `defaultTools`; pass `--tools <effective-list>` or `--no-tools` explicitly for every child run.
- **Risk: Cron or manual run starts duplicate task executions.** Mitigation: scheduler and per-task locks, plus claim `nextRunAt` before child spawn.
- **Risk: Task files become noisy due to runtime updates.** Mitigation: runtime state in `state/*.json`; task files remain desired configuration and prompt only.
- **Risk: Arbitrary paths or task IDs escape the root.** Mitigation: strict slug IDs, safe ID-to-path helpers, reject slashes/dot-dot/absolute path-derived IDs, validate env IDs against parsed task files, and keep root selection under `SCHEDULED_TASKS_ROOT_DIR` rather than a similarly named singular `PI_SCHEDULED_TASK_ROOT`.
- **Risk: Child Pi run hangs indefinitely.** Mitigation: timeout with SIGTERM/SIGKILL and failure result.
- **Risk: Logs contain secrets.** Mitigation: mask configured env in doctor/log summaries, write files owner-only where practical, document that raw `pi.log` may include raw tool output.
- **Risk: Crontab management damages unrelated user entries.** Mitigation: operate only on a marked managed block and test add/update/remove behavior.
- **Risk: Cron command injection through configurable paths.** Mitigation: shell-quote all cron command values, treat command settings as executable paths rather than shell snippets, and test roots/helper/node/pi paths containing spaces, quotes, semicolons, `$`, backticks, and other metacharacters.
- **Risk: Cron has a sparse PATH and cannot find `node` or `pi`.** Mitigation: default `nodeCommand` to `process.execPath`, provide `piCommand`/`nodeCommand` config with env overrides, include both in the managed cron block, and report command resolution in doctor output.
- **Risk: Scheduler due semantics accidentally become catch-up behavior.** Mitigation: define fixed v1 due-window semantics, initialize missing state to the next future occurrence without immediate execution, and test missed schedules.
- **Risk: YAML/frontmatter/cron parsing adds dependency complexity.** Mitigation: add direct runtime dependencies for parser/runtime-loader packages actually used by scheduled-task runtime code, or implement minimal internal parsers with focused tests for the v1 subset.
- **Risk: `pi-task-scheduler.mjs` import/loading path is brittle under stow.** Mitigation: make the helper directly runnable with Node using an explicit loader or JavaScript runtime boundary, include any loader as a runtime dependency if required, avoid dev-only runtime dependencies, and verify via a local `node ... --help` or dry-run command.

## Assumptions

- Standard 5-field cron expressions are sufficient for v1 scheduling.
- A task must have an absolute existing `cwd` to run when enabled or manually executed.
- Manual runs are allowed for disabled tasks if their execution config is otherwise valid, because manual invocation is explicit. If implementation chooses to require `enabled: true` for manual runs too, document that stricter behavior and adjust tests.
- The scheduler may run tasks serially in v1; same-task overlap prevention is mandatory, cross-task parallelism is not.
- `piCommand` may default to `pi`, but users can set `SCHEDULED_TASKS_PI_COMMAND` or config `piCommand` to an absolute path for cron environments with sparse PATH.

## Handoff Summary

Implement `pi/agent/extensions/scheduled-tasks/` as a conservative v1 scheduled-task system. Use Markdown task definitions, a shared validator/linter, a mountable persistent root via `SCHEDULED_TASKS_ROOT_DIR`, explicit default/effective child tool allowlists, fresh child Pi sessions per run, env-gated scoped handoff files via `PI_SCHEDULED_TASK_*` run-context vars, short `/tasks-*` commands, a unified `scheduled_tasks` management/validation tool without structured create/update actions, a separate `scheduled_task_handoff` tool that is automatically included for `handoff: true` runs, configurable `piCommand`/`nodeCommand`, and a `pi-task-scheduler.mjs` cron helper that does not rely on dev-only runtime dependencies. Do not add precheck scripts, no-agent mode, catch-up behavior, arbitrary Pi args, or destructive cleanup in v1.

Suggested `/goal` objective:

```text
Implement .plans/2026-06-19-scheduled-tasks-extension.md. Complete only after every acceptance criterion is satisfied with concrete evidence from files and verification commands, including make typecheck and make test.
```
