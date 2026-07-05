# Deterministic Scheduled Tasks CLI Plan

## Goal

Make scheduled-tasks scheduler-owned automation less brittle by moving the managed cron tick and detached claimed-runner handoff from Pi slash-command dispatch to deterministic repo-local TypeScript CLIs. The final scheduled agent task still launches Pi exactly as today; only scheduler orchestration stops depending on Pi extension loading and `-p` command dispatch.

## Background / Repo Context

- The scheduled-tasks extension lives under `pi/agent/extensions/scheduled-tasks/` and follows the repo's directory-based Pi extension conventions.
- The repo already depends on `tsx` for TypeScript execution and tests (`package.json`), and repo instructions require `make typecheck` and `make test` before reporting Pi extension changes complete.
- Current managed cron is built in `pi/agent/extensions/scheduled-tasks/cron.ts` and invokes Pi with `--mode json --no-session --no-extensions -e <scheduled-tasks index.ts> -p '/scheduled-tasks-tick'`.
- Current slash commands in `pi/agent/extensions/scheduled-tasks/commands.ts` are already thin wrappers around exported scheduler functions: `/scheduled-tasks-tick` calls `schedulerTick()`, and `/scheduled-tasks-run-claimed` calls `runClaimedTask()`.
- The core deterministic scheduler functions already exist in `pi/agent/extensions/scheduled-tasks/scheduler.ts`: `schedulerTick()`, `manualRunTask()`, and `runClaimedTask()`.
- `launchClaimedRunner()` in `scheduler.ts` currently spawns Pi with `-p '/scheduled-tasks-run-claimed <task-id> <run-id>'`, captures `launch.stdout.log` / `launch.stderr.log`, waits for the detached process to adopt the task lock, and reports `launched` only after adoption.
- Actual scheduled agent execution uses `buildSpawnPlan()` and `spawnPi()` in `pi/agent/extensions/scheduled-tasks/spawn.ts`; that path should continue to launch Pi.
- Config loading uses `loadScheduledTasksConfig(cwd, warnings)` in `pi/agent/extensions/scheduled-tasks/config.ts`, which reads global and project settings plus environment overrides. CLI execution must use the same project cwd semantics as the command wrappers.
- Crontab status currently only detects managed block markers in `pi/agent/extensions/scheduled-tasks/crontab.ts`; after this change it should distinguish installed-current, installed-stale/needs-update, not installed, and unavailable so old Pi-based managed blocks do not look fully healthy.
- The live scheduled-tasks health monitor is part of the migration scope, but plan and repo docs should refer to it generically as the scheduler-root health monitor rather than embedding local absolute paths.

## Acceptance Criteria

- AC-1: Managed cron generation no longer invokes `pi`, `-p`, `/scheduled-tasks-tick`, or extension-loading flags; it invokes the repo-local deterministic tick CLI through repo-local `tsx`.
- AC-2: `/scheduled-tasks-install-cron` refuses to modify crontab when repo-local `node_modules/.bin/tsx` is missing, and reports clear install-dev/dependency guidance.
- AC-3: A deterministic tick CLI exists, loads scheduled-tasks config using the current working directory as the project cwd, supports normal ticks and `--dry-run`, prints exactly one JSON `TickSummary` object to stdout on successful scheduler execution, writes warnings/diagnostics only to stderr, and exits nonzero only for infrastructure failures that prevent execution.
- AC-4: New due-task claimed-runner launches use a deterministic repo-local run-claimed CLI instead of `pi -p /scheduled-tasks-run-claimed ...`, while preserving launch logs, detached execution, lock-adoption polling, 10-second adoption timeout, terminal `launch_failed` handling, and parent-lock release semantics.
- AC-5: A deterministic run-claimed CLI exists, validates `<task-id> <run-id>` arguments, loads config using the current working directory as the project cwd plus the scheduler root environment, calls `runClaimedTask()`, prints exactly one JSON `RunSummary` object to stdout, writes warnings/diagnostics only to stderr, and exits nonzero for usage/infrastructure failures.
- AC-6: Final scheduled task execution still launches Pi via the existing `buildSpawnPlan()` / `spawnPi()` path, including `executionShell: bash-login`, task env files, handoff tool availability, prompt rendering, and output artifacts.
- AC-7: `/scheduled-tasks-tick [--dry-run]` and `/scheduled-tasks-run-claimed <task-id> <run-id>` remain available indefinitely as manual/debug/backward-compatible wrappers over the same scheduler functions.
- AC-8: Doctor/status output can identify a stale managed cron block that still uses the old Pi slash-command shape and can report when the deterministic CLI prerequisites are missing.
- AC-9: The live scheduler-root health monitor files `tasks/scheduled-tasks-health-monitor.md` and `scripts/scheduled-tasks-health-check.sh` under the configured scheduled-tasks root are updated to recognize the deterministic CLI cron shape and current-health policy, without treating historical `stale_recovered` runs as current failure.
- AC-10: README and DESIGN docs accurately describe the new CLI-based cron/claimed-runner architecture, retained slash-command wrappers, dependency requirement, failure semantics, and manual reinstall/proof workflow.
- AC-11: Tests cover cron command construction, missing-`tsx` install refusal, CLI argument/output behavior, run-claimed launch args, retained slash-command wrappers, stale cron status, and relevant docs-facing behavior.

## Non-Goals / Out of Scope

- Do not change the final scheduled task agent execution model; task runs still launch Pi.
- Do not remove `/scheduled-tasks-tick` or `/scheduled-tasks-run-claimed`.
- Do not auto-install dependencies or run `make install-dev` from the extension.
- Do not automatically reinstall the live crontab during implementation.
- Do not change task Markdown schema, cron expression semantics, catchup policy, stale-lock policy, or handoff semantics except as needed to preserve them under the CLI entrypoints.
- Do not push commits or perform remote writes unless separately requested.

## Constraints

- Use repo-local `tsx` from `node_modules/.bin/tsx` for the deterministic CLIs.
- The installer must fail before writing crontab if the repo-local `tsx` executable is absent.
- Preserve shell quoting and environment scoping: `cronEnvironment` applies only to the managed cron command and descendants, not to unrelated crontab lines.
- Preserve `piCommand` semantics for final task execution; do not repurpose it as the scheduler CLI command.
- Keep CLI stdout as exactly one JSON scheduler result object for successful execution; use stderr for warnings/diagnostics and nonzero exit for usage/infrastructure failures.
- Keep compatibility with old slash-command entrypoints for manual recovery and any in-flight old-code launches.
- Avoid absolute local paths in committed plan/docs; use repo-relative paths for repo files and scheduler-root-relative placeholders for live scheduled-task files.
- The live health monitor update is explicitly in scope even though it is outside the repo source. Treat it as local operational configuration and do not introduce private absolute paths into repo files.

## Chosen Approach

Add small deterministic TypeScript CLI entrypoints inside `pi/agent/extensions/scheduled-tasks/` and make both cron and detached claimed-runner orchestration call those CLIs through the repo-local `tsx` executable. The CLIs should be thin: parse arguments, load the same config as the slash-command wrappers, call the existing scheduler functions, print JSON, and set predictable exit codes.

Keep the existing slash commands as wrappers over the same shared functions. This preserves interactive dry-run/debug affordances and backwards compatibility while removing the brittle Pi startup/extension-loading/slash-command path from unattended scheduler automation.

Prefer explicit repo-local paths derived from the scheduled-tasks extension source repo root, while still using `cd <project-cwd>` so settings load relative to the project where cron was installed. The repo root should be resolved robustly from the extension's real source path, not assumed to equal the project cwd. This keeps the runtime dependency (`node_modules/.bin/tsx`) visible and testable without conflating task project cwd with the config repository root.

## Design Decisions

- D1: Cron calls a deterministic tick CLI instead of Pi. Rationale: the previous regression was caused by Pi extension loading/command dispatch; bypassing that stack removes a brittle dependency from the once-per-minute path.
- D2: Due-task claimed runners also use a deterministic CLI. Rationale: otherwise due tasks would still rely on Pi slash-command dispatch before the actual agent run, leaving the same class of failure in the handoff path.
- D3: Final task execution still launches Pi. Rationale: that is the actual agent work and must keep existing task prompt, tools, handoff, shell, and output behavior.
- D4: Use repo-local `tsx`. Rationale: this repo already uses `tsx` for tests and development, and the user selected the simple repo-local runtime contract over generated JS or a wrapper shell script.
- D5: Keep both slash commands indefinitely. Rationale: they are useful for manual dry-runs/debugging and compatibility, and they can remain thin wrappers without reintroducing cron brittleness.
- D6: CLI success prints JSON; nonzero exits are reserved for usage/infrastructure failures. Rationale: task-level launch failures are already represented in scheduler state and summaries; cron should not treat every task-level issue as a broken scheduler invocation.
- D7: Do not reinstall cron automatically. Rationale: the user wants exact reinstall/proof commands prepared, not executed, during implementation.

## Implementation Notes

- Add CLI entrypoints under `pi/agent/extensions/scheduled-tasks/`, for example:
  - `tick-cli.ts` for `schedulerTick()`.
  - `run-claimed-cli.ts` for `runClaimedTask()`.
- Consider adding a small shared CLI helper module, for example `cli.ts`, for argument parsing, JSON/stdout/stderr formatting, safe exit codes, repo-local path resolution helpers, and config loading. Keep it internal to the extension.
- CLI behavior should be testable without terminating the test process. Prefer exporting `runTickCli(argv, env/process adapters)` and `runClaimedCli(argv, env/process adapters)` functions that return `{ exitCode, stdout, stderr }`, with tiny top-level entrypoints that call `process.exitCode = ...`.
- Decide the minimum CLI arg surface during implementation and document it. Recommended:
  - Tick: `tick-cli.ts [--dry-run]` and optionally a test-only/exported function parameter for deterministic `now` rather than a public `--now` unless useful for manual debugging.
  - Run claimed: `run-claimed-cli.ts <task-id> <run-id>`.
- Load config in CLIs with `loadScheduledTasksConfig(process.cwd(), warnings)` so cron's `cd <project-cwd> && ...` and command wrappers share project settings semantics.
- Keep warnings visible without breaking JSON stdout: write config warnings and diagnostics to stderr, not stdout, and do not wrap successful `TickSummary` / `RunSummary` output in a JSON envelope.
- Add or reuse a helper that resolves the scheduled-tasks extension source repo root from the real extension file path, then derives:
  - `<extension-repo-root>/node_modules/.bin/tsx`
  - `<extension-repo-root>/pi/agent/extensions/scheduled-tasks/tick-cli.ts`
  - `<extension-repo-root>/pi/agent/extensions/scheduled-tasks/run-claimed-cli.ts`
- Update `buildCronBlock()` in `cron.ts` to accept the resolved `tsx` and tick CLI paths, and build a command like:
  - `cd '<project-cwd>' && env <cronEnvironment...> '<extension-repo-root>/node_modules/.bin/tsx' '<extension-repo-root>/pi/agent/extensions/scheduled-tasks/tick-cli.ts'`
- Preserve `shellQuote()` for every shell-inserted value.
- Add a cron prerequisite check used by `/scheduled-tasks-install-cron` before `writeCrontab()`. It should verify at least repo-local `node_modules/.bin/tsx` and the tick CLI file are accessible. It may also validate the run-claimed CLI file because cron-launched ticks will need it for due work.
- Do not mutate crontab on failed prerequisite checks. The handler should notify an error with install guidance such as running the repo's dependency installation command.
- Update `launchClaimedRunner()` in `scheduler.ts` so it spawns repo-local `tsx` with the run-claimed CLI and `taskId`/`runId` argv. Preserve:
  - detached process behavior;
  - `launch.stdout.log` and `launch.stderr.log` capture;
  - `SCHEDULED_TASKS_ROOT_DIR` environment;
  - cwd semantics;
  - 10-second adoption wait;
  - child exit before adoption handling;
  - no overwrite of fast child terminal states;
  - parent-lock release on launch failure.
- Preserve project cwd for run-claimed launches by spawning the run-claimed CLI with `cwd: process.cwd()` from the scheduler process. The CLI executable/script paths should come from the resolved extension repo root; the working directory should remain the task project cwd. Do not overload `piCommand` for either purpose.
- Keep `buildSpawnPlan()` and final `spawnPi()` behavior unchanged except where type changes require plumbing.
- Extend crontab status modeling in `crontab.ts` and formatting in `commands.ts`/doctor paths. A useful model is:
  - `not_installed`;
  - `installed_current` or existing `installed` for a matching deterministic block;
  - `installed_stale` / `needs_update` when managed markers exist but command content differs from `buildCronBlock()` or contains the old Pi slash-command shape;
  - `unavailable`.
    Avoid breaking callers unnecessarily; keep text clear.
- Update `validateConfig()` or doctor-only checks to surface deterministic CLI prerequisite health in addition to `piCommand` health. `piCommand` must remain validated for final agent runs.
- Update the live scheduler-root health monitor files `tasks/scheduled-tasks-health-monitor.md` and `scripts/scheduled-tasks-health-check.sh` to recognize the new deterministic cron line and to check current tick health rather than historical recovered runs. Keep the update local and verify it manually.
- Existing tests in `scheduled-tasks.test.ts` use Node's `node:test`, temp roots, wrapper exports for stubbing (`_spawn`, `_execFile`), and in-memory command handlers. Match those conventions rather than introducing a separate test framework.
- If shared code wraps Node built-ins for stubbing, follow the repo's holder pattern (`export const _spawn = { fn: ... }`) so tests can use `mock.method()`.

## Documentation Impact

Update:

- `pi/agent/extensions/scheduled-tasks/README.md`
  - Command list: slash commands remain manual/debug wrappers; cron uses CLI.
  - Runs/artifacts: claimed runner is launched by deterministic CLI, but artifacts and lifecycle statuses remain the same.
  - Scheduler and cron: replace old Pi cron example with repo-local `tsx` CLI example.
  - Reliability/idempotency: remove or rewrite the warning that cron/runner paths rely on Pi slash-command registration.
  - Configuration/troubleshooting: document repo-local dependency requirement and missing-`tsx` install failure.
  - Reinstall/proof: provide exact manual commands/checks for reinstalling the managed cron block and proving a tick, but do not claim the implementation runs them automatically.
- `pi/agent/extensions/scheduled-tasks/DESIGN.md`
  - Architecture/lifecycle: deterministic CLIs own unattended scheduler orchestration; slash commands wrap shared functions.
  - Invariants: final agent runs still launch Pi; scheduler-owned automation must not depend on Pi command dispatch.
  - Change guidance: preserve launch adoption handshake and machine-readable CLI output.
- Tests that assert docs-facing cron strings or command behavior.

No root README update is required unless the implementation changes the repository's top-level capability overview, which this migration should not.

## Testing / Verification

- V1: Run focused scheduled-tasks tests with `npx tsx --test pi/agent/extensions/scheduled-tasks/scheduled-tasks.test.ts`; expect all tests pass, including new CLI/cron/runner tests.
- V2: Run `make typecheck`; expect TypeScript compile succeeds.
- V3: Run `make test`; expect all Pi extension tests pass.
- V4: Run `npm run format:check`; expect Prettier reports all matched files use the configured style.
- V5: Manually inspect generated cron block in tests or via a dry helper to confirm it uses repo-local `tsx` and does not include `pi`, `-p`, or `/scheduled-tasks-tick`.
- V6: Manually run the deterministic tick CLI in dry-run mode from the repo root after implementation and confirm stdout is valid JSON with `dryRun: true` and no unintended state mutation.
- V7: Manually run `/scheduled-tasks-tick --dry-run` in Pi or through the existing command test harness and confirm it still reports equivalent dry-run behavior.
- V8: After updating the live scheduler-root health monitor files, validate the health task and run its script manually; expected result should reflect current health and recognize the new cron shape.
- V9: Provide but do not execute the operational reinstall/proof commands. Suggested commands should include installing the managed cron block through Pi, inspecting crontab, waiting for/checking a tick log, and checking for leftover scheduler processes.

## Risks and Mitigations

- Risk: Cron installs a command that cannot run because repo-local dependencies are missing. Mitigation: preflight `node_modules/.bin/tsx` and CLI file accessibility before writing crontab; show clear dependency guidance.
- Risk: Stowed extension paths point at the Pi agent directory while dependencies live in the repo, and task project cwd may not equal the extension repo root. Mitigation: resolve the real scheduled-tasks extension source repo root from the extension file path, derive CLI executable/script paths from that root, and keep `cwd` separately as the project settings directory.
- Risk: Stale old managed cron blocks still show as installed. Mitigation: compare managed block content or detect old Pi slash-command shape and report `needs update`/stale in doctor and health checks.
- Risk: Runner launch semantics regress and tasks get stuck in `claimed`/`launched`. Mitigation: preserve launch logs, detached process handling, lock-adoption polling, timeout failure, and terminal artifact writes; keep existing regression tests and add run-claimed CLI launch tests.
- Risk: CLI JSON stdout is polluted by warnings/logs. Mitigation: route all warnings/diagnostics to stderr and test that successful stdout is exactly one parseable scheduler result object.
- Risk: `cronEnvironment` quoting or scoping changes introduce shell injection or env leakage. Mitigation: keep existing `shellQuote()` approach and tests for scoped env emission.
- Risk: Final task execution accidentally stops using Pi or loses settings. Mitigation: do not change `buildSpawnPlan()`/`spawnPi()` except necessary plumbing; include tests around final spawn args and bash-login behavior.
- Risk: The live health monitor becomes stale. Mitigation: update it in the same implementation and validate it after source checks.

## Assumptions

- Development checks will run from the repository root. Cron installation should preserve the cwd where the install command is invoked as the project settings cwd; for this repo's own scheduled tasks, that cwd is expected to be the repository root.
- It is acceptable for the deterministic CLI runtime to depend on repo-local development dependencies because the user selected the repo-local `tsx` contract.
- The exact CLI filenames may differ from the examples if the implementer chooses clearer names, as long as docs, tests, cron generation, and runner launch agree.

## Handoff Summary

Implement deterministic scheduler-owned CLIs for scheduled-tasks. Add repo-local `tsx` tick and run-claimed entrypoints, make cron and `launchClaimedRunner()` use them, preserve final Pi task execution, keep slash commands as wrappers, update doctor/health/docs/tests, and do not reinstall the live crontab automatically. Complete only after every acceptance criterion has concrete evidence from tests, docs review, CLI dry-run/manual checks where applicable, and a prepared reinstall/proof command sequence.

Suggested `/goal` objective:

```text
Implement .plans/2026-07-04-deterministic-scheduled-tasks-cli.md. Complete only after all acceptance criteria are satisfied with concrete evidence from tests, docs, CLI dry-run/manual checks where applicable, and prepared cron reinstall/proof commands. Do not reinstall the live crontab unless explicitly instructed.
```
