---
name: advance-plan
description: Use when making one bounded, resumable step of progress on a Ready plan. Executes or resumes exactly one task, or settles exactly one milestone gate, from durable run state; never advances to a second step in the same invocation.
---

# Advance Plan

Make exactly one bounded step of progress on one Ready plan. A step is either:

- execute or resume one task and verify it; or
- after all tasks in the active milestone are done, settle that milestone's verification gate and checkpoint.

Never execute a task and its milestone gate in the same invocation. Never execute two tasks or enter another milestone in the same invocation. A later invocation resumes from durable state.

This skill is goal-agnostic. It does not read, complete, yield, renew, or otherwise interpret goal state. Callers decide whether to invoke it again based on its reported outcome.

## Core contract

- Once a run opens, its plan under `.design/plans/` is immutable execution intent. Revisions require a new superseding plan path.
- `state.json` is authoritative for run, milestone, and task status.
- `evidence/<milestone>.json` is authoritative for acceptance evidence.
- `decisions.jsonl` records consequential implementation rulings.
- Git commits are durable task and gate-repair checkpoints, not proof by themselves.
- Use TODOs to expose tactical progress for every task or gate that proceeds past preflight, but never let them replace run state.
- The deterministic helper owns every run-state mutation. Never edit run artifacts manually.
- Conversation claims, TODOs, commits, and subagent output never override helper state.

The helper is `scripts/plan-run-state.js`, resolved relative to this skill directory. Invoke it with `node` and an absolute helper path.

## Invocation

Use the Ready plan for first execution and later advancement:

```text
/skill:advance-plan .design/plans/YYYY-MM-DD-example.md
```

Use an explicit run path only to resolve ambiguity or perform recovery:

```text
/skill:advance-plan --run .design/runs/example/<run-id>
```

If the request identifies a task or milestone, verify it matches the helper's returned next step. Never skip ahead.

## 1. Preflight and resume

1. Read repository instructions and relevant handoff context.
2. Resolve the repository root and helper path.
3. Require a clean enough workspace to distinguish this step's changes. Investigate existing modifications; never overwrite or absorb unrelated work.
4. Confirm the plan has `Status: Ready` and read its Goal, Non-Goals and Constraints, Acceptance Criteria, Execution Milestones, relevant implementation notes, and verification guidance.
5. Keep the main session as the sole writer and owner of implementation, run state, evidence, decisions, verification, and commits. Do not delegate implementation, repair, task-level review, acceptance evaluation, or verification. Use read-only subagents only for bounded research or diagnosis when isolation materially helps.

For a plan invocation, atomically open its run:

```bash
node <helper> open \
  --cwd <repo-root> \
  --plan .design/plans/YYYY-MM-DD-example.md
```

Handle its structured `action` exactly:

- `created` or `resumed`: use the returned `runDir`, run status, `next` step, and attempt counts.
- `complete`: report whole-plan completion and stop.
- `ambiguous`: stop and require an explicit `--run`; never choose a candidate.
- `drifted`: stop and require a new superseding plan path or explicit state migration; never initialize another run from changed content at the same plan path.
- `invalid`: stop and report the checkout-lineage or state error.

For an explicit run, inspect state and plan drift:

```bash
node <helper> status --run <run-dir>
node <helper> next --run <run-dir>
```

Before restarting a failed milestone, inspect its returned `stopReason` and recorded evidence for the current step. A reason or evidence summary beginning with `retryable repair exhaustion [<essential-failure>]` marks a caller-granted resumed invocation. Restarting clears the active stop reason, but evidence remains authoritative across interruption; compare the latest marker only with a later exhaustion for the same step and essential failure.

Stop on plan drift. Do not silently migrate state after the plan changes.

### Interrupted-step rule

Always inspect `currentMilestone`, `currentTask`, and `next` before selecting work:

- A running task is the step to resume. Never select or start another task.
- A running milestone with no current task and incomplete tasks advances its first incomplete task.
- A running milestone whose tasks are all done advances only its gate.
- With no running milestone, use the helper's returned task or gate step. Start that dependency-ready milestone before advancing the returned step.

The helper returns `next.step: "task"` or `next.step: "gate"` so this choice does not depend on conversation memory.

When resuming after an interrupted agent turn, inspect the current workspace and recorded evidence before acting. Do not blindly repeat research or side effects:

- If implementation exists but verification was interrupted, inspect it and rerun verification.
- If implementation is partial, inspect the observed state and resume it directly in the main session.
- If a task checkpoint commit exists but task completion was interrupted, verify the commit and evidence before recording completion; do not create a duplicate checkpoint.
- If task completion was already recorded, follow the helper's next step rather than repeating the task.
- If a gate-repair commit exists but milestone completion was interrupted, verify the commit and evidence before recording completion; do not create a duplicate checkpoint.

### Tactical TODO visibility

Once preflight identifies an actionable task or gate, create a TODO list before implementation or gate verification begins. Decompose only the current step into concrete remaining actions such as inspection, implementation, focused verification, evidence recording, and authoritative state settlement. Do not mirror future plan tasks or milestones in TODOs.

Keep exactly one TODO `in_progress` and update each item immediately as work advances. On resume, reconstruct the list from helper state, workspace state, and recorded evidence rather than trusting stale TODO status. Keep the list visible while the step is active. After inspecting final helper status, mark the current tactical outcome and clear the list immediately before reporting the step outcome.

TODOs remain observational aids: helper state selects work and determines completion, even when the TODO list disagrees.

## 2. Advance one task

Use this section only when `next.step` is `task`.

If no milestone is active, start the returned milestone:

```bash
node <helper> milestone-start --run <run-dir> --milestone M1
```

If the returned task is not already running, start it:

```bash
node <helper> task-start \
  --run <run-dir> \
  --task T1
```

Use the task attempt count at invocation start as the repair baseline. Historical attempts do not consume this invocation's repair allowance.

### Main-session execution

Treat one plan task as one tracked implementation scope. Implement it directly in the main session without writable delegation or untracked subtasks. If it is too broad for one bounded invocation, stop as blocked and report that the Ready plan needs finer task packets.

Before editing, inspect relevant source, tests, documentation, and the current staged, unstaged, and untracked workspace state. Preserve unrelated work and never modify `.design/plans/`, `.design/runs/`, `.git/`, or other protected workflow state except through the helper. Follow the global testing and verification evidence policy and repository-required checks; make only changes required by the task contract.

Use read-only subagents only when bounded research or diagnosis would materially reduce main-session context or provide useful isolation. Their output is advisory: inspect cited artifacts directly before relying on it. Never delegate implementation, repair, verification, acceptance evaluation, run-state mutation, evidence, decisions, commits, or external writes.

Resolve consequential implementation choices from the plan, repository evidence, or user authority and record them when required. Stop as blocked rather than inventing a decision, expanding scope, using unsafe authority, or proceeding without required credentials or environment access.

After implementation, inspect the complete task delta, reject unrelated or protected-path changes, evaluate the result against the task contract, and run focused verification in the main session. A meaningful failure enters the bounded repair process below; passing checks proceed to evidence recording.

### Evidence and completion

Record only bounded evidence established by the main session. Task evidence proves the task outcome and does not need to claim acceptance-criterion coverage:

```bash
node <helper> evidence-add \
  --run <run-dir> \
  --milestone M1 \
  --task T1 \
  --kind command \
  --summary "Focused tests passed: 12 tests" \
  --command "npm test -- state" \
  --exit-code 0
```

Other evidence kinds are `artifact`, `inspection`, and `manual`. Use `--path` for relevant repository artifacts. Task evidence may optionally name criteria when it directly proves them, but milestone gates own final criterion coverage. Never paste raw logs, secrets, large diffs, or command output into evidence. Expected failures used to validate a regression test do not prove implementation acceptance.

After recording evidence, create one logical verified checkpoint commit for the completed task when it changed files. Inspect the staged diff, stage only task-owned files by name, follow repository commit-message policy, and never include run artifacts, unrelated changes, or likely secrets. Never create an empty commit and never push. If a commit hook fails, diagnose and repair the task within the bounded repair process; never bypass the hook or mark the task complete without the required checkpoint.

Mark the task complete only after main-session verification has passed and, when files changed, the required task checkpoint commit has succeeded:

```bash
node <helper> task-complete --run <run-dir> --task T1
```

Then stop. Report the task checkpoint when present and whether the helper's next step is another task or the milestone gate, but do not begin it.

## 3. Settle one milestone gate

Use this section only when `next.step` is `gate`. Do not reopen completed tasks.

If no milestone is active, start the returned milestone before recording gate evidence or attempting completion. This is required when resuming a previously blocked or failed gate:

```bash
node <helper> milestone-start --run <run-dir> --milestone M1
```

1. Run the milestone verification gate exactly as planned.
2. Run relevant repository-required checks.
3. After all milestone tasks are done, record gate evidence covering every criterion owned by the milestone. Never pre-record gate evidence before the integrated gate runs.
4. Inspect the integrated milestone diff and documentation impact in the main session, including all task checkpoint commits since the milestone began.
5. Do not invoke an independent reviewer by default. When the plan, repository instructions, or user explicitly requires one, run it once against the integrated milestone after deterministic gates pass. Evaluate findings and repair confirmed issues through the bounded gate-repair process.
6. If gate verification or repair changed files after the task checkpoints, create one logical verified gate-repair commit. Inspect the staged diff, stage only gate-owned files by name, and never create an empty commit or push. Do not create a ceremonial milestone commit when the gate changed no files.
7. Ask the helper to complete the milestone.

Record milestone-level evidence by omitting `--task`:

```bash
node <helper> evidence-add \
  --run <run-dir> \
  --milestone M1 \
  --criteria AC-1,AC-2 \
  --kind command \
  --summary "Milestone gate passed" \
  --command "make test" \
  --exit-code 0
```

Complete the milestone:

```bash
node <helper> milestone-complete --run <run-dir> --milestone M1
```

The helper rejects completion while tasks are incomplete, current-attempt gate command evidence is failing, gate evidence is absent, or the gate evidence does not cover every criterion owned by the milestone. Task evidence alone cannot settle a gate. After completion, stop. Report the next step or whole-plan completion without starting another milestone.

## 4. Decisions, failures, and bounded repair

Record only decisions affecting interfaces, dependencies, scope, compatibility, risk, or later milestones:

```bash
node <helper> decision-add \
  --run <run-dir> \
  --milestone M1 \
  --summary "Keep state transitions explicit" \
  --rationale "Resume must not depend on model memory"
```

### Invalid verification commands

Treat a nonzero result as an invalid command only when output proves the command was malformed or non-representative, such as a syntax error, wrong working directory or flag, unavailable command variant, or assertion of the wrong behavior. Correct it once, record bounded inspection evidence explaining the correction, and run the intended check. Otherwise treat it as a meaningful failure.

### Repair bounds

The current step gets at most three repair rounds in this invocation:

- A task step repairs only its running task.
- A gate step repairs only the integrated milestone gate and never reopens completed tasks.
- Invalid-command corrections do not consume a round.
- Continue only when the original failure passes, the failing set shrinks, or output proves the diagnosis and exposes a narrower failure.
- Stop early when the same essential failure survives two consecutive rounds, a repaired check regresses without a new diagnosis, or no falsifiable next step remains.

Classify repair exhaustion as `failed-retryable` only when all three rounds were consumed, every continuation condition above held through the final round, and one focused falsifiable repair remains. Identify the essential failure with a concise stable description such as the failing check plus failure mode; do not use a generic phrase like `tests failed`.

Before stopping the milestone, compare that identity with prior retryable-exhaustion markers for the current step:

- With no matching prior marker, record the final failed command with summary `retryable repair exhaustion [<essential-failure>]: <concise next repair>`, stop the milestone with the same reason, and report `failed-retryable`.
- If prior evidence names the same step and essential failure, stop it with an ordinary failed reason and report `failed`; that failure's one resumed invocation has been consumed.
- If the essential failure materially changed after demonstrated progress, it is a new failure identity and may receive its own single caller-granted resume.

Early-stop conditions, unavailable intervention, an unsafe next action, and exhaustion without a falsifiable repair are never `failed-retryable`.

For a meaningful failure, record the failed command with its real exit code, diagnose it, and stop the milestone as `failed` before another round:

```bash
node <helper> milestone-stop \
  --run <run-dir> \
  --milestone M1 \
  --status failed \
  --reason "Focused verification failed"
```

If allowance remains, restart the same milestone and, for a task step, restart the same task. Diagnose and implement one focused repair directly in the main session, inspect the resulting delta, and rerun affected checks. Read-only subagents may assist bounded diagnosis but never write or approve the repair. Leave the milestone failed if bounds are exhausted.

Use `blocked` instead when progress requires an unavailable environment, unresolved product or architecture decision, external approval, credentials, or unsafe/destructive action:

```bash
node <helper> milestone-stop \
  --run <run-dir> \
  --milestone M1 \
  --status blocked \
  --reason "Required disposable native test environment is unavailable"
```

Do not reinterpret acceptance criteria to avoid a block or continue into unrelated work.

## 5. Report one outcome

Inspect final authoritative status:

```bash
node <helper> status --run <run-dir>
node <helper> next --run <run-dir>
```

Report exactly one outcome:

- `progressed`: this task or gate completed and another step remains;
- `blocked`: the current step needs user or environment intervention;
- `failed-retryable`: all three repair rounds were consumed with demonstrated progress and one falsifiable repair remains, and the same essential failure has not already received a resumed invocation;
- `failed`: bounded repair ended without a passing step and is not eligible for another automatic invocation;
- `drifted`, `ambiguous`, or `invalid`: preflight cannot select safe work;
- `complete`: helper run status is `complete` and no step remains.

Include the plan and run paths, step and status, focused verification summary, evidence coverage, task or gate-repair checkpoint when present, blockers or known issues, and the helper-reported next step. Do not claim whole-plan completion unless helper status is `complete`.

Return control to the caller. Do not invoke another plan step recursively and do not call goal tools. A caller may invoke the same durable step once more after `failed-retryable`; all other non-progress outcomes require its normal stop policy.

## Helper guarantees and limits

The helper:

- requires a Ready plan and stable `M<n>` and globally unique `T<n>` IDs;
- validates dependencies and acceptance-criterion ownership;
- stores compact state under `.design/runs/<plan-slug>/<run-id>/`;
- atomically creates or resolves a run under recoverable locks;
- refuses ambiguity, drift, and checkout lineage violations;
- applies atomic JSON writes and validates state-controlled paths;
- permits one running milestone and one running task;
- returns an explicit task-or-gate next-step discriminator;
- starts only the first dependency-ready milestone in plan order;
- requires current-attempt task evidence before task completion;
- accepts gate evidence only after all milestone tasks are done and requires it to cover every owned criterion before milestone completion;
- bounds evidence and validates legacy profile histories when resuming older runs;
- records decisions append-only;
- records but never executes evidence command strings.

It does not launch agents, run checks, create commits, resolve plan changes, or decide whether evidence is semantically sufficient. Those remain execution responsibilities. It assumes a cooperative local filesystem and does not defend against a hostile process racing validated workspace paths.
