# Scheduled Tasks Review Fixes Plan

## Goal

Repair the reviewed `scheduled-tasks` extension implementation so cron/manual scheduling share one authoritative TypeScript code path, scheduler state is not advanced incorrectly under lock contention or dry-run mode, cron matching follows standard semantics, handoff marker writes are path-safe, and run/log output handling is bounded.

This is a follow-up plan. Do not modify `.plans/2026-06-19-scheduled-tasks-extension.md` while implementing it.

## Background / Repo Context

- The initial scheduled-tasks implementation added `pi/agent/extensions/scheduled-tasks/` with commands, tools, scheduler logic, tests, docs, and a standalone `pi-task-scheduler.mjs` helper.
- A six-agent review found several important issues:
  - `pi-task-scheduler.mjs` duplicates parser/validator/scheduler/spawn logic and already diverges from the TypeScript implementation.
  - Cron runs ignore extension settings and shared validation because the standalone helper only reads env/defaults and uses partial validation.
  - `schedulerTick` advances `nextRunAt` before task lock acquisition, so a locked due task can be skipped.
  - `schedulerTick({ dryRun: true })` currently mutates task state before returning.
  - `cronMatches` requires both day-of-month and day-of-week to match instead of standard cron OR semantics when both are restricted.
  - `scheduled_task_handoff` writes `handoff-updated` using env-controlled `PI_SCHEDULED_TASK_RUN_DIR`.
  - `spawnPi` accumulates all child stdout/stderr in memory, and `/tasks-logs` reads whole artifact files before showing a tail.
- Relevant current files:
  - `pi/agent/extensions/scheduled-tasks/commands.ts`
  - `pi/agent/extensions/scheduled-tasks/cron.ts`
  - `pi/agent/extensions/scheduled-tasks/index.ts`
  - `pi/agent/extensions/scheduled-tasks/pi-task-scheduler.mjs`
  - `pi/agent/extensions/scheduled-tasks/scheduler.ts`
  - `pi/agent/extensions/scheduled-tasks/schedule.ts`
  - `pi/agent/extensions/scheduled-tasks/spawn.ts`
  - `pi/agent/extensions/scheduled-tasks/tools.ts`
  - `pi/agent/extensions/scheduled-tasks/README.md`
  - `pi/agent/extensions/scheduled-tasks/scheduled-tasks.test.ts`
- Repo conventions from `AGENTS.md` still apply: directory-based Pi extensions, shared config helpers, README config/logging docs, snake_case schemas, recoverable tool errors as text, child-process spawn stubbing via wrapper exports, and `make typecheck` plus `make test` before reporting complete.

## Acceptance Criteria

- AC-1: `pi-task-scheduler.mjs` is removed from the extension and no cron command, README text, test, or plan-completion evidence references it as an active scheduler entrypoint.
- AC-2: A documented `/tasks-tick` extension command exists and is the scheduler entrypoint. It runs one scheduler tick in normal/headless Pi command execution and supports `/tasks-tick --dry-run`.
- AC-3: `/tasks-install-cron` installs a managed cron block that invokes Pi directly with the extension command, using argument/shell quoting for configured values and project cwd, for example `cd '<project-cwd>' && '<pi-command>' --mode json --no-session -p '/tasks-tick'`. `/tasks-uninstall-cron` still removes only the managed block and preserves unrelated crontab entries.
- AC-4: Cron scheduling uses the same TypeScript config loader, task parser, shared validator, scheduler, and spawn path as manual `/tasks-run` and management tooling. There is no second scheduler/parser/validator implementation for cron.
- AC-5: `schedulerTick({ dryRun: true })` and `/tasks-tick --dry-run` do not mutate task state, acquire task locks for execution, spawn child Pi, or write run artifacts. They report what would be initialized, skipped, missed, or run.
- AC-6: When a scheduled task is due but its task lock is already held, the scheduler records/report a locked skip without advancing `nextRunAt`; later ticks retry while the due time remains inside the grace window, and existing missed-schedule behavior advances only after the grace window expires.
- AC-7: When a due task is successfully claimed, the task lock is acquired before advancing `nextRunAt`, `nextRunAt` is persisted before releasing the scheduler lock/spawning, and the task lock remains held for the run.
- AC-8: Cron day-of-month/day-of-week matching follows standard 5-field cron behavior: if one of DOM/DOW is unrestricted, the restricted field controls matching; if both are restricted, either field may match.
- AC-9: `scheduled_task_handoff` derives the `handoff-updated` marker path from `config.rootDir`, `PI_SCHEDULED_TASK_ID`, and `PI_SCHEDULED_TASK_RUN_ID` using safe path helpers. It does not write marker files using `PI_SCHEDULED_TASK_RUN_DIR` as a trusted path. Missing/invalid run ID may skip marker writing but must not prevent the handoff file update.
- AC-10: Task `env` values remain unmasked in task files and management surfaces by design, but the README clearly states task files/env are not secret storage and are visible to agents/sessions with file read access.
- AC-11: Child Pi stdout/stderr handling is bounded in memory. Full raw child output is streamed to `pi.log` on disk, while the scheduler keeps only bounded in-memory tails needed for result summaries, `output.md`, and session metadata extraction.
- AC-12: `/tasks-logs` and `scheduled_tasks({ action: "logs" })` read bounded tails from large artifact files instead of reading entire `output.md` or `pi.log` into memory.
- AC-13: Existing command/tool behavior that is not part of these fixes remains intact: `/tasks-list`, `/tasks-show`, `/tasks-run`, `/tasks-logs`, `/tasks-doctor`, `/tasks-install-cron`, `/tasks-uninstall-cron`, `/scheduled-tasks-config`, `scheduled_tasks`, and scheduled-run `scheduled_task_handoff` continue to work.
- AC-14: Tests cover the new and repaired behavior: `/tasks-tick --dry-run`, cron block generation invoking Pi command, no-mutation dry runs, locked due task retry semantics, standard DOM/DOW cron semantics, safe handoff marker derivation, bounded spawn output behavior including timeout/error paths, and bounded log tail reads.
- AC-15: Documentation is updated to match the new cron/Pi-command scheduler design, dry-run behavior, locking semantics, task env non-secret guidance, and log/artifact behavior.
- AC-16: Verification passes: `make typecheck`, `make test`, `npm run lint`, and `npm run format:check` all pass. Include concrete evidence in final completion notes.

## Non-Goals / Out of Scope

- Do not add catch-up queues, pending-run replay, force-unlock, stale-lock deletion, precheck scripts, no-agent/script-only jobs, arbitrary `piArgs`, or cloud/webhook triggers.
- Do not implement masking or secret management for task `env` values.
- Do not modify the original `.plans/2026-06-19-scheduled-tasks-extension.md`.
- Do not push or create a PR unless explicitly requested.

## Constraints

- Keep this public repository sanitized: no private project names, internal URLs, credentials, or tokens.
- Edit only source files under `pi/agent/extensions/scheduled-tasks/` and the new follow-up plan/docs as needed; never edit `~/.pi/` directly.
- Preserve recoverable user/model mistakes as readable command/tool output rather than uncaught exceptions where applicable.
- Keep cron command construction shell-safe; quote every configurable shell value inserted into the crontab line.
- Keep child process execution via argument arrays, not shell string concatenation, except for the crontab line itself where shell syntax is required by cron.
- Keep the TypeScript extension scheduler as the single source of truth for config, validation, schedule decisions, run artifacts, and spawning.

## Chosen Approach

Replace the standalone Node scheduler helper with a headless-safe Pi extension command. Cron will invoke Pi in non-interactive mode with `/tasks-tick`, causing Pi to load the normal extension and use the same TypeScript scheduler path as manual commands/tools. This eliminates config drift, duplicated validation, and duplicated scheduler behavior.

Then repair scheduler semantics and output handling in the authoritative TypeScript implementation: dry runs become read-only, due tasks acquire the task lock before state claim, locked due tasks retain their current `nextRunAt`, cron matching uses standard DOM/DOW rules, handoff marker writes derive safe paths from root/task/run IDs, and child/log output is streamed or tailed with bounded memory.

## Design Decisions

- D1: **Cron invokes Pi, not a standalone helper.** This makes the Pi extension runtime the single source of truth for settings, validation, scheduling, and spawning.
- D2: **Remove `pi-task-scheduler.mjs`.** A compatibility shim is not needed for v1 and would preserve an unnecessary surface to test and maintain.
- D3: **Use `/tasks-tick --dry-run`.** One command supports real and dry-run ticks; remove the undocumented `/tasks-tick-dry-run` command.
- D4: **Dry-run is read-only.** It may inspect tasks/state and report decisions, but it must not initialize, miss, advance, lock-for-execution, spawn, or write artifacts.
- D5: **Locked due tasks retry within grace.** Lock contention is temporary, not an intentional skipped run. `nextRunAt` remains unchanged until a run is claimed or the due window expires and normal missed semantics apply.
- D6: **Claim requires task lock first.** For a real due run, acquire the task lock before advancing `nextRunAt`; then release the scheduler lock and run while holding the task lock.
- D7: **Use standard cron DOM/DOW semantics.** Users should be able to copy normal five-field cron expressions without surprising AND behavior.
- D8: **Do not trust env paths for writes.** `PI_SCHEDULED_TASK_RUN_DIR` may still be provided for child convenience, but marker writes derive from safe helpers and `PI_SCHEDULED_TASK_RUN_ID`.
- D9: **Task env is not secret storage.** No masking is required because sessions/tools with file read access can inspect task Markdown directly; docs must set the right expectation.
- D10: **Stream full logs, bound memory.** Preserve debuggability in `pi.log` while preventing heap growth from verbose child processes.

## Implementation Notes

- `commands.ts`
  - Replace `/tasks-tick-dry-run` with `/tasks-tick` and parse `--dry-run`.
  - Ensure the command works in print/json modes without TUI-only assumptions. Prefer writing concise command output through command notification/output mechanisms already used by the extension.
  - Update `/tasks-install-cron` to build a cron block that invokes `piCommand` directly, changes to `ctx.cwd`, and passes `--mode json --no-session -p '/tasks-tick'` or the closest reliable Pi CLI equivalent.
- `cron.ts`
  - Remove `nodeCommand`/`helperPath` requirements if they only existed for `pi-task-scheduler.mjs`.
  - Add project cwd to cron block input and shell-quote it.
  - Preserve managed block replacement/uninstall behavior exactly.
- `config.ts`
  - Fix the existing `agentDir` resolution bug while touching config: from `pi/agent/extensions/scheduled-tasks/`, global Pi settings should resolve under `pi/agent/`, not `pi/`.
  - Reconsider whether `nodeCommand` remains a user-facing config field after removing the helper. If removed, update README/tests/settings docs. If retained for future compatibility, document that cron no longer uses it.
- `scheduler.ts`
  - Refactor tick planning/claiming so dry-run computes decisions without writes.
  - For real runs, acquire task locks during claim before advancing due state. Avoid double-acquiring the same task lock in `runTask`; introduce an internal run path that accepts a held lock if needed.
  - Ensure locks are released on validation failure, spawn failure, timeout, and unexpected errors.
  - Add or update helpers for bounded artifact tails.
- `schedule.ts`
  - Track whether DOM and DOW fields are unrestricted (`*`) or otherwise implement equivalent logic so `cronMatches` can apply standard OR semantics.
- `tools.ts`
  - In `scheduled_task_handoff`, compute marker path with `runDir(config.rootDir, taskId, runId)` using `PI_SCHEDULED_TASK_RUN_ID`. Return a clear warning if marker writing is skipped because the run ID is missing/invalid.
- `spawn.ts`
  - Stream child stdout/stderr to `pi.log` as chunks arrive.
  - Keep bounded in-memory tails for stdout/stderr. Choose a documented internal cap, e.g. 1 MiB per stream, unless a smaller cap is sufficient.
  - Preserve timeout behavior: SIGTERM, then SIGKILL after grace; mark timeout result and release locks.
  - Preserve `extractSessionFile` behavior as well as practical with bounded stdout tail.
- `README.md`
  - Replace standalone helper documentation with Pi command cron documentation.
  - Document `/tasks-tick` and `/tasks-tick --dry-run`.
  - Document locked due task retry behavior, dry-run read-only behavior, standard cron DOM/DOW semantics, task env non-secret guidance, and bounded log/artifact behavior.
- `scheduled-tasks.test.ts`
  - Extend existing tests rather than creating broad integration tests with brittle setup.
  - Use wrapper exports/stubs for child processes and crontab interactions per repo convention.
- Remove `pi/agent/extensions/scheduled-tasks/pi-task-scheduler.mjs` and all active references to it.

## Documentation Impact

Update `pi/agent/extensions/scheduled-tasks/README.md` because user-facing behavior changes:

- Scheduler entrypoint is now `/tasks-tick`, not `pi-task-scheduler.mjs tick`.
- Cron install invokes Pi directly and depends on the project cwd/trust context used by Pi.
- Dry-run is available via `/tasks-tick --dry-run` and is read-only.
- Locked due tasks retry within the due grace window.
- Cron DOM/DOW semantics are standard OR semantics.
- Task `env` values are not secret storage; agents with file access can read task Markdown.
- `pi.log` may contain raw child output and task/process output; in-memory summaries are bounded.

If `nodeCommand` is removed from config, update the README config table and examples accordingly.

## Testing / Verification

- V1: `make typecheck` passes.
- V2: `make test` passes, including focused tests for:
  - `/tasks-tick` command registration and `--dry-run` behavior.
  - Cron block generation invoking Pi directly and preserving unrelated crontab entries.
  - Dry-run tick does not write state or artifacts.
  - Held task lock leaves `nextRunAt` unchanged and reports locked.
  - Retry within grace and missed behavior after grace.
  - Standard DOM/DOW cron matching.
  - Handoff marker path derives from root/task/run ID and rejects/skips invalid run IDs safely.
  - Spawn timeout/error/nonzero paths and bounded stdout/stderr tails.
  - Log tail helper reads bounded tails from large files.
- V3: `npm run lint` passes.
- V4: `npm run format:check` passes.
- V5: Grep/audit confirms no active cron docs/code/tests refer to `pi-task-scheduler.mjs`.
- V6: README review confirms all changed user-facing behavior/config/logging semantics are documented.

## Risks and Mitigations

- Risk: Invoking Pi from cron may depend on project trust. Mitigation: document trust expectations and use the project cwd from cron install. If Pi requires an explicit flag for trusted project-local settings in non-interactive mode, include the safest documented flag in the cron command and test the generated command string.
- Risk: Refactoring scheduler locks can introduce deadlocks or leaked locks. Mitigation: keep lock ownership explicit, use `try/finally`, and add tests for locked, success, failure, and timeout paths.
- Risk: Removing `nodeCommand` may be a config compatibility break. Mitigation: either remove it with docs/tests updated because it is no longer used, or retain it as deprecated/no-op only if needed; do not leave it documented as controlling cron execution if it does not.
- Risk: Bounded stdout tails may lose session metadata if Pi emits the session event early and output later exceeds the cap. Mitigation: parse session metadata incrementally from chunks while streaming, not only from the final tail, if practical.
- Risk: Cron command quoting is shell-sensitive. Mitigation: keep existing shell-quote tests and add cases for project cwd, pi command, and metacharacters.

## Assumptions

- Pi extension commands can be invoked in non-interactive print/json mode with `-p '/tasks-tick'` or an equivalent documented CLI shape, and extension commands execute without a model turn.
- The managed cron block may `cd` to the project cwd captured during `/tasks-install-cron` because Pi does not appear to expose a documented `--cwd` flag.
- The user accepts removing the original standalone-helper acceptance criterion in favor of this follow-up plan's Pi-command scheduler design.

## Handoff Summary

Implement `.plans/2026-06-19-scheduled-tasks-review-fixes.md` as a repair pass for the scheduled-tasks extension. Do not modify the original scheduled-tasks plan. Replace the standalone scheduler helper with `/tasks-tick`, update cron/docs/tests, fix lock/dry-run/cron matching/handoff marker/output-tail behavior, and complete only after every acceptance criterion is supported by file evidence plus passing `make typecheck`, `make test`, `npm run lint`, and `npm run format:check`.

Suggested goal command:

```text
/goal Implement .plans/2026-06-19-scheduled-tasks-review-fixes.md. Complete only after every acceptance criterion is satisfied with concrete evidence from files and verification commands. Do not modify .plans/2026-06-19-scheduled-tasks-extension.md. Do not push or create a PR.
```
