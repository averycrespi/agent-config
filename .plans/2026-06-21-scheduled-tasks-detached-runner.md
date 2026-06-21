# Scheduled Tasks Detached Runner Plan

## Goal

Refactor the Pi `scheduled-tasks` extension so scheduler ticks are fast claim-and-launch operations rather than long-running supervisors. Scheduled tasks should run independently and concurrently up to a safe global cap, with durable run lifecycle metadata, task snapshots, stale-lock recovery, and local-time cron semantics.

## Background / Repo Context

- The extension lives under `pi/agent/extensions/scheduled-tasks/` and follows the directory-based Pi extension conventions in `AGENTS.md`.
- Current scheduler behavior is in `pi/agent/extensions/scheduled-tasks/scheduler.ts`. `schedulerTick()` claims due work, releases `scheduler.lock`, then awaits each `runTask()` sequentially. This means one long due task delays every other task claimed in the same tick.
- Current locks are advisory lock files from `pi/agent/extensions/scheduled-tasks/locks.ts`, created with exclusive `open(path, "wx")`. Metadata already includes `pid`, `hostname`, and `startedAt`, but there is no stale-lock recovery.
- Current state is in `pi/agent/extensions/scheduled-tasks/state.ts`: per-task scheduling state under `state/<task-id>.json`, final run results under each run directory, and best-effort tick logs under `state/ticks.jsonl`.
- Current cron matching in `pi/agent/extensions/scheduled-tasks/schedule.ts` uses UTC getters/setters. The desired behavior is local/current timezone semantics matching ordinary cron expectations.
- Current manual runs use `/scheduled-tasks-run` and `scheduled_tasks({ action: "run" })`. They are primarily for testing/debugging and should remain synchronous for now.
- User-facing docs and agent-focused design notes exist at `pi/agent/extensions/scheduled-tasks/README.md` and `pi/agent/extensions/scheduled-tasks/DESIGN.md`; both must be updated for behavior changes.
- Before reporting Pi extension changes complete in this repo, run both `make typecheck` and `make test`.

## Acceptance Criteria

- AC-1: A scheduler tick that finds multiple due tasks launches independent claimed runners instead of awaiting task completion sequentially. The tick summary reports launch/claim statuses such as `launched` or `launch_failed`, not final child-task success/failure.
- AC-2: Scheduled runs create durable lifecycle metadata in `runs/<task-id>/<run-id>/run.json` and preserve final compatibility with `result.json` once the run finishes.
- AC-3: Scheduled runs use a task snapshot written at claim time, e.g. `runs/<task-id>/<run-id>/task.md`; the claimed runner does not execute a later-mutated task definition.
- AC-4: A new internal slash-command runner `/scheduled-tasks-run-claimed <task-id> <run-id>` executes only an existing claimed scheduled run, validates the lock/run metadata, updates lifecycle state, writes artifacts/results, updates last-run state, and releases the task lock.
- AC-5: `/scheduled-tasks-run <task-id>` and `scheduled_tasks({ action: "run" })` remain synchronous manual/debug paths and do not advance `nextRunAt`.
- AC-6: A global scheduled-run concurrency cap is enforced via `maxConcurrentScheduledRuns`, defaulting to `3`. Already-active scheduled runners count against the cap across ticks; if the active count is at the cap, additional due tasks are deferred without advancing `nextRunAt`. Per-task concurrency remains limited by each task lock.
- AC-7: Stale scheduler/task locks are recovered automatically using lock metadata and timeout-derived expiry. Scheduler locks expire after 5 minutes. Task locks expire after the relevant task timeout plus a 5-minute cushion, with same-host dead-PID locks recoverable after a 30-second safety floor. Recovery marks the prior run lifecycle as `orphaned` or `stale_recovered` before launching new work.
- AC-8: All mutations to task scheduling state and run lifecycle metadata occur under the relevant task lock, except read-only inspection. Lock release must compare expected metadata before deleting so an old runner cannot remove a newer lock after stale recovery. Corrupt state or run metadata blocks the affected task and is surfaced in tick/doctor output instead of being silently overwritten as missing.
- AC-9: Cron parsing and next-run calculation use local/current timezone semantics, with tests proving expected local-time behavior and day-of-month/day-of-week semantics.
- AC-10: `doctor` and `logs` surfaces show lifecycle status from `run.json` when present, while preserving useful existing `result.json`, `output.md`, and `pi.log` inspection.
- AC-11: Spawn/log stream failures produce a failed run outcome and durable lifecycle/result metadata rather than leaving a run indefinitely `running`.
- AC-12: Documentation describes the detached runner model, lifecycle statuses, lock handoff invariants, stale-lock policy, concurrency cap, local-time cron semantics, and the internal runner command.

## Non-Goals / Out of Scope

- Do not rename `/scheduled-tasks-run`; keep it as the user-facing synchronous manual run command.
- Do not build a generic job queue, database-backed scheduler, dashboard, or external trigger system.
- Do not add destructive blanket cleanup commands beyond the stale-lock recovery behavior required here.
- Do not make env files or task files secret storage; existing security assumptions remain.
- Do not replay every missed occurrence. Existing coalescing/catchup semantics should remain unless directly necessary for the new runner model.

## Constraints

- Keep task-addressed paths routed through `pi/agent/extensions/scheduled-tasks/paths.ts` safe builders.
- Keep management tooling unavailable inside scheduled child runs, and keep handoff scoped to the current scheduled task.
- Spawn child Pi with argv arrays, not shell-concatenated task content.
- Preserve existing run artifact names where practical: `prompt.md`, `output.md`, `pi.log`, and `result.json`.
- Preserve current public manual/debug command behavior except where docs need to clarify it is synchronous.
- Maintain compact tick logs; they must not include task prompts, task env values, child stdout/stderr, or full validation output.
- Update tests alongside behavior changes; this is a recurring autonomous execution feature, so locking/state behavior needs direct coverage.

## Chosen Approach

Convert scheduled ticks into fast claim-and-launch operations. During a tick, the scheduler acquires `scheduler.lock`, scans and validates tasks, acquires each due task's lock, writes a durable run lifecycle file and immutable task snapshot, advances `nextRunAt`, launches a separate Pi process that invokes `/scheduled-tasks-run-claimed <task-id> <run-id>`, records launch status, and exits quickly. The claimed runner validates the existing claim and lock, executes the existing child Pi task path using the snapshot, writes artifacts and terminal state, updates last-run state, releases the task lock, and exits.

Manual runs stay synchronous because they are intended for interactive testing/debugging and already provide useful immediate feedback.

This approach is preferred over in-process `Promise.all` because it avoids keeping the cron-invoked scheduler Pi process alive for the duration of all child tasks and isolates failures to individual runners. It is preferred over a full job queue because the extension's state remains small, inspectable, and file-based.

## Design Decisions

- D1: Use one `run.json` lifecycle file per run directory and retain final `result.json` for compatibility and compact machine-readable final outcome.
- D2: Use lifecycle statuses at least: `claimed`, `launched`, `running`, `success`, `failed`, `timeout`, `launch_failed`, and `orphaned` or an equivalent stale/recovered terminal status.
- D3: Snapshot the task Markdown at claim time into the run directory. The runner uses the snapshot so later edits to `tasks/<task-id>.md` do not alter an already-claimed run.
- D4: Scheduler creates the per-task lock with `runId`; the runner validates the lock metadata and releases that same lock on terminal completion. This is a lock handoff by file metadata convention, not a kernel lock transfer.
- D5: Launch failure is terminal for that claimed run: write `launch_failed`, update task last-run/last-status state as appropriate, and release the task lock.
- D6: Add config field `maxConcurrentScheduledRuns` with default `3`. It is a global active scheduled-run cap across ticks, not merely a per-tick launch cap. Existing active scheduled runners count by inspecting task locks and/or non-terminal run lifecycle metadata. `0` is invalid and should warn/fall back to the default rather than disabling scheduling.
- D7: Stale-lock recovery is automatic and timeout-derived. Scheduler locks expire after 5 minutes because they should only protect claiming. Task locks expire after the relevant task timeout plus a 5-minute cushion. Same-host dead PIDs can be recovered after a 30-second safety floor; same-host live PIDs and different-host locks require age-based expiry. Recovery must mark any associated non-terminal run as `orphaned` or `stale_recovered` with diagnostic metadata before removing the stale lock.
- D8: Corrupt state/run metadata is not treated as missing. It blocks the affected task/run and is surfaced through tick summaries and doctor output.
- D9: Cron semantics should follow the current local timezone, not UTC.
- D10: Tick summaries report scheduling/launch outcomes. Final success/failure is observed later through run lifecycle/logs/doctor.
- D11: Detached runner launch uses `child_process.spawn` (through an exported wrapper for tests) with `detached: true` and non-inherited stdio. The launcher waits only for the runner process `spawn` event, `error` event, or a short launch timeout, then records `launched` with runner PID or `launch_failed`; it never waits for the runner command to complete. After a successful `spawn`, call `unref()` so the tick can exit independently.
- D12: Task lock release must be compare-and-delete by expected `runId`/owner metadata. A stale old runner must not blindly delete `locks/<task>.lock` if a newer run has already acquired it.

## Implementation Notes

- Update `pi/agent/extensions/scheduled-tasks/config.ts`:
  - Add `maxConcurrentScheduledRuns`, parse from settings/env, default `3`, and require a positive integer. `0`, negative, fractional, and non-numeric values should warn and fall back to the default.
  - Add README config table entry and environment override, likely `SCHEDULED_TASKS_MAX_CONCURRENT_SCHEDULED_RUNS`.
- Update `pi/agent/extensions/scheduled-tasks/state.ts`:
  - Add types and helpers for run lifecycle metadata under each run directory.
  - Preserve atomic temp-file-plus-rename writes.
  - Distinguish missing files from corrupt/unreadable JSON for task state and run lifecycle reads.
- Update `pi/agent/extensions/scheduled-tasks/locks.ts`:
  - Ensure partial acquisition failures close and remove any created lock file.
  - Add stale inspection/recovery helpers using metadata, file age where useful, hostname, PID liveness, and caller-provided stale policy.
  - Add compare-and-delete release semantics, e.g. release only if current lock metadata still matches the held lock's expected `runId`/owner fields.
  - Keep path safety via `lockPath()`.
- Update `pi/agent/extensions/scheduled-tasks/scheduler.ts`:
  - Split orchestration from execution so scheduled tick can claim/launch without awaiting final task completion.
  - Keep `manualRunTask()` synchronous and preserve existing semantics.
  - Add claim creation: run dir, `task.md` snapshot, initial `run.json`, state advance under task lock.
  - Add runner launch using `config.piCommand` to invoke Pi in non-interactive mode with prompt `/scheduled-tasks-run-claimed <task-id> <run-id>`.
  - Implement launch via an exported `child_process.spawn` wrapper with `detached: true`, non-inherited stdio, `spawn`/`error`/short-timeout detection, PID recording, and `unref()` after successful spawn.
  - Enforce `maxConcurrentScheduledRuns` as a global active scheduled-run cap. Count existing active scheduled runners from task locks and/or non-terminal run lifecycle records; when at the cap, defer due tasks without advancing `nextRunAt`.
  - Add `runClaimedTask()` or equivalent used by the internal slash command.
  - Make tick summaries report claim/launch results, not final child outcomes.
- Update `pi/agent/extensions/scheduled-tasks/commands.ts`:
  - Register `/scheduled-tasks-run-claimed <task-id> <run-id>` as an internal runner command.
  - Keep `/scheduled-tasks-run <task-id>` unchanged for users.
  - Ensure doctor/log commands display useful lifecycle status.
- Update `pi/agent/extensions/scheduled-tasks/tools.ts` if needed:
  - `scheduled_tasks({ action: "run" })` remains synchronous/manual.
  - `logs` and `doctor` should include lifecycle status when available.
- Update `pi/agent/extensions/scheduled-tasks/schedule.ts`:
  - Replace UTC date getters/setters with local-time equivalents.
  - Preserve five-field cron and existing OR semantics for restricted DOM/DOW fields.
  - Consider increasing next-run search horizon or surfacing unreachable schedules while touching scheduling tests; rare schedules remain an identified edge case if not fully solved in this plan.
- Update `pi/agent/extensions/scheduled-tasks/spawn.ts`:
  - Handle write-stream and append stream errors so failures produce durable failed outcomes.
  - Clear timeout escalation timers when finishing.
- Update `pi/agent/extensions/scheduled-tasks/scheduled-tasks.test.ts`:
  - Add tests for multi-task due tick launching without awaiting child task completion.
  - Add tests for `run.json` lifecycle transitions and final `result.json` compatibility.
  - Add tests that runner uses `task.md` snapshot after source task mutation.
  - Add tests for launch failure, detached spawn/unref behavior, stale lock recovery thresholds, compare-before-delete lock release, corrupt state/run metadata, global active concurrency cap default/config/env, local-time cron behavior, doctor/log lifecycle output, and stream error handling.
  - Keep or adapt existing tests that assert current tick behavior.

## Documentation Impact

Update both user-facing and maintainer-facing docs:

- `pi/agent/extensions/scheduled-tasks/README.md`
  - Document detached scheduled runner behavior, `run.json`, task snapshots, launch-oriented tick summaries, concurrency cap, local-time cron semantics, logging/doctor lifecycle visibility, and stale-lock behavior.
  - Clarify `/scheduled-tasks-run` is synchronous manual/debug execution and `/scheduled-tasks-run-claimed` is internal.
  - Update configuration table with `maxConcurrentScheduledRuns` and its environment override.
- `pi/agent/extensions/scheduled-tasks/DESIGN.md`
  - Replace the old sequential run model with claim/launch/runner lifecycle.
  - Add explicit invariants for lock handoff, task snapshot immutability, state writes under task lock, stale-lock expiry relative to task timeout, lifecycle transitions, and corrupt metadata handling.
- `pi/agent/extensions/scheduled-tasks/skills/manage-scheduled-tasks/SKILL.md`
  - Update management guidance only if user-visible scheduler/log behavior or commands change in ways agents need to know.

## Testing / Verification

- V1: Run the focused scheduled-tasks test file:
  - `npx tsx --test pi/agent/extensions/scheduled-tasks/scheduled-tasks.test.ts`
  - Expected: all scheduled-tasks tests pass, including new detached runner/lifecycle/local-time/stale-lock tests.
- V2: Run repository typecheck:
  - `make typecheck`
  - Expected: TypeScript typecheck passes.
- V3: Run all extension tests:
  - `make test`
  - Expected: all tests pass.
- V4: Optionally run formatting/lint checks if touched files include formatted surfaces beyond TypeScript tests:
  - `npm run lint`
  - `npm run format:check`
  - Expected: pass or report exact remaining formatting/lint issues.
- V5: Manual/read-only verification of docs:
  - Confirm `README.md` and `DESIGN.md` describe the new model and no longer imply scheduled ticks await final task completion.
  - Confirm no public docs encourage users to call `/scheduled-tasks-run-claimed` directly.

## Risks and Mitigations

- Risk: Duplicate task execution if stale recovery removes a lock while a runner/child is still active.
  - Mitigation: derive task stale threshold from timeout plus 5-minute cushion; use same-host PID liveness where possible; require compare-before-delete lock release; document conservative invariants and mark recovered runs explicitly.
- Risk: Scheduler advances `nextRunAt` but runner launch fails, losing an occurrence.
  - Mitigation: write durable `run.json` before advancing and mark `launch_failed` with state updates and visible tick/doctor output.
- Risk: Task files mutate between claim and execution.
  - Mitigation: execute from `task.md` snapshot in the run directory.
- Risk: Cron local-time behavior can be environment-sensitive in tests.
  - Mitigation: set `TZ` in focused tests or assert behavior using local Date construction in a controlled timezone.
- Risk: Hidden internal slash command becomes user-facing confusion.
  - Mitigation: document it as internal in `DESIGN.md`, mention only as implementation detail/troubleshooting in README if necessary, and keep normal docs centered on `/scheduled-tasks-run`.
- Risk: File-based lifecycle state becomes inconsistent after partial writes or crashes.
  - Mitigation: atomic writes, explicit corrupt metadata handling, and doctor visibility.
- Risk: Launching several Pi runners can overload the machine.
  - Mitigation: default `maxConcurrentScheduledRuns` to `3`, count active runners across ticks, defer new work without advancing `nextRunAt` when at cap, and document how to lower it.

## Assumptions

- It is acceptable for scheduled tick summaries to report launch outcomes rather than final task outcomes; final outcomes are inspected later through logs/doctor/run artifacts.
- Manual runs are debugging-oriented and may continue to block until the child task exits.
- Local/current timezone cron behavior should match the environment where the scheduler tick process runs.
- The extension remains file-based; no SQLite or external queue is needed for this scope.

## Handoff Summary

Implement the detached scheduled runner model for `pi/agent/extensions/scheduled-tasks` using this plan. A suitable objective is:

```text
/goal Implement .plans/2026-06-21-scheduled-tasks-detached-runner.md. Complete only after every acceptance criterion is satisfied with concrete evidence from tests, typecheck, and documentation review.
```

Completion evidence should map each acceptance criterion to concrete artifacts: updated source files, updated docs, new/updated tests, passing `npx tsx --test pi/agent/extensions/scheduled-tasks/scheduled-tasks.test.ts`, passing `make typecheck`, and passing `make test`.
