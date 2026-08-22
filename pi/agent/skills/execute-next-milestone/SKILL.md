---
name: execute-next-milestone
description: Use when implementing one milestone from a Ready plan with durable run state, task progress, decisions, and evidence. Executes exactly one dependency-ready milestone per invocation and stops with done, blocked, or failed status.
---

# Execute Next Milestone

Implement exactly one dependency-ready milestone from one Ready plan. Keep the plan immutable, persist authoritative run state and evidence outside conversation history, and stop after the milestone reaches `done`, `blocked`, or `failed`.

Do not use `goal` auto-run for this workflow. Do not continue into another milestone in the same invocation.

## Core contract

- The plan under `.design/plans/` is immutable execution intent.
- `state.json` is authoritative for run, milestone, and task status.
- `evidence/<milestone>.json` is authoritative for acceptance evidence.
- `decisions.jsonl` records consequential implementation rulings.
- Git commits are durable milestone checkpoints, not proof by themselves.
- TODOs are tactical aids only and never replace run state.
- The deterministic helper owns every state mutation. Never edit run artifacts manually.

The helper is `scripts/plan-run-state.js`, resolved relative to this skill directory. Invoke it with `node` and an absolute helper path.

## Invocation

Invoke with the Ready plan for both first execution and later milestones:

```text
/skill:execute-next-milestone .design/plans/YYYY-MM-DD-example.md
```

The helper creates a run when none exists, resumes the sole matching nonterminal run, or reports that the plan is complete. Use an explicit run path only to resolve ambiguity or perform recovery:

```text
/skill:execute-next-milestone --run .design/runs/example/<run-id>
```

If the request identifies both a run and a milestone, verify that the milestone is exactly the helper's next dependency-ready work. Do not skip ahead.

## 1. Preflight

1. Read repository instructions and relevant handoff context.
2. Resolve the repository root and helper path.
3. Require a clean enough workspace to distinguish this milestone's changes. Investigate existing modifications; never overwrite or absorb unrelated work.
4. Confirm the plan has `Status: Ready` and read its Goal, Non-Goals and Constraints, Acceptance Criteria, Execution Milestones, relevant implementation notes, and verification guidance.
5. Do not use subagents by default. Perform implementation in the current session with one writer. Use deterministic commands directly for checks.

For a plan invocation, atomically open its run:

```bash
node <helper> open \
  --cwd <repo-root> \
  --plan .design/plans/YYYY-MM-DD-example.md
```

Handle its structured `action` exactly:

- `created` or `resumed`: use the returned `runDir`, `next`, milestone task summary, and attempt counts.
- `complete`: report that the plan is complete and stop.
- `ambiguous`: stop and ask for an explicit `--run`; never choose the newest candidate.
- `drifted`: stop and require explicit new-run initialization or state migration; never silently abandon the old run.
- `invalid`: stop and report the checkout-lineage or state error.

For an explicit run invocation, inspect state and plan drift:

```bash
node <helper> status --run <run-dir>
```

Stop if `planDrift` is true. Do not silently migrate state after the plan changes.

## 2. Select and start one milestone

Use `next` from `open` for a plan invocation. For an explicit run, ask the helper for the next dependency-ready work:

```bash
node <helper> next --run <run-dir>
```

If `next` is `null`, inspect run status and report complete or blocked state. Otherwise use `currentMilestone` and `currentTask` from `open`, or from `status` for an explicit run:

- When no milestone is active, start exactly the milestone returned by `next`:

  ```bash
  node <helper> milestone-start --run <run-dir> --milestone M1
  ```

- When that milestone is already active from an interrupted invocation, do not call `milestone-start` again. Resume `state.currentTask` when present; otherwise start the next incomplete task returned by `next`.

Create a TODO list from that milestone's tasks, preserving task order and existing completion state. Capture the milestone and task attempt counts from `open`, or from `status` for an explicit run, as this invocation's baseline; historical attempts do not consume the new invocation's repair allowance. Do not add work from later milestones.

## 3. Execute tasks sequentially

For each task in order:

1. Start it through the helper.
2. Read only the repository context needed for its scope, outcome, and verification.
3. Apply test-driven development when the task changes meaningful logic.
4. Implement the task without expanding acceptance scope.
5. Run its focused verification.
6. Record bounded evidence mapped to the milestone's acceptance criteria.
7. Mark the task complete only after the helper accepts its evidence.

Start a task:

```bash
node <helper> task-start --run <run-dir> --task T1
```

Record successful command evidence:

```bash
node <helper> evidence-add \
  --run <run-dir> \
  --milestone M1 \
  --task T1 \
  --criteria AC-1,AC-2 \
  --kind command \
  --summary "Focused tests passed: 12 tests" \
  --command "npm test -- state" \
  --exit-code 0
```

Other evidence kinds are `artifact`, `inspection`, and `manual`. Use `--path` for a relevant repository artifact when applicable. Keep summaries factual and bounded. Never paste raw logs, secrets, large diffs, or command output into evidence.

Mark a task complete:

```bash
node <helper> task-complete --run <run-dir> --task T1
```

Expected failing tests in the red TDD phase are not acceptance evidence. Record milestone/task gate results, including failures that affect execution decisions.

## 4. Record decisions

Record a decision only when it affects interfaces, dependencies, scope interpretation, compatibility, risk, or later milestones:

```bash
node <helper> decision-add \
  --run <run-dir> \
  --milestone M1 \
  --summary "Keep state transitions explicit" \
  --rationale "Resume must not depend on model memory"
```

Do not use the decision log for narration or routine implementation details.

## 5. Handle failed checks and blockers

First determine whether a nonzero result is a meaningful implementation check or an invalid verification command. Treat it as an invalid command only when concrete output proves the command itself was malformed or non-representative, such as a syntax error, wrong working directory or flag, unavailable command variant, or assertion that checks the wrong behavior. When uncertain, treat it as a meaningful failure.

For an invalid verification command:

1. Do not record it as failed command evidence or stop the milestone.
2. Correct the command once and rerun the same intended check.
3. Record bounded inspection evidence explaining why the first command was invalid and what corrected command tested the intended claim.
4. Record the corrected command result normally; inspection evidence never substitutes for a successful corrected check.
5. Treat a failing corrected command as a meaningful check failure.

Use independent, progress-aware repair scopes:

- Each task gets at most three repair rounds in the current invocation. A round diagnoses the current failure, applies one focused change, and reruns the failed check plus directly affected checks.
- The milestone verification gate gets a separate allowance of at most three repair rounds after all tasks are complete.
- A repair used by one task does not consume another task's or the milestone gate's allowance.
- A different required check failing after the original check passes consumes the next round in the same scope; it does not require an immediate final stop.
- Invalid verification-command corrections do not consume a repair round.

Continue only while repair produces concrete progress. Progress means the original failure passes, the failing set shrinks, or output proves the diagnosis and exposes a different narrower failure. A changed error message alone is not progress. Stop the scope early when the same essential failure survives two consecutive repair rounds, a repaired check regresses without a concrete new diagnosis, or no falsifiable next step remains. Always stop after three repair rounds if the scope still fails.

For a meaningful failed check:

1. Record the failed command as evidence with its real exit code.
2. Diagnose the failure from concrete output and compare it with the previous round in that scope.
3. Stop the milestone as `failed` before beginning a new round.
4. If the scope still has allowance and the prior round made progress when applicable, restart the milestone and failed task, apply one focused repair, and rerun the failed scope.
5. If the check passes, continue the task or gate. If another required check fails, evaluate it as the next round in the same scope.
6. If an early-stop condition applies or the third repair round does not pass the scope, leave the milestone failed and stop.

```bash
node <helper> milestone-stop \
  --run <run-dir> \
  --milestone M1 \
  --status failed \
  --reason "Integration failure persisted without progress after two repair rounds"
```

Use `blocked` instead of `failed` when progress requires unavailable environments, unresolved product or architecture decisions, external approval, credentials, or unsafe/destructive action:

```bash
node <helper> milestone-stop \
  --run <run-dir> \
  --milestone M1 \
  --status blocked \
  --reason "Required disposable native test environment is unavailable"
```

Do not reinterpret acceptance criteria to avoid a block. Do not ask whether to continue into unrelated work.

## 6. Close the milestone

After every task is complete:

1. Run the milestone verification gate exactly as planned.
2. Run relevant repository-required checks.
3. Record gate evidence covering every acceptance criterion owned by the milestone.
4. Inspect the diff and documentation impact.
5. Create one logical verified checkpoint commit when the milestone changed files. Stage files by name and never push.
6. Ask the helper to complete the milestone.

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

The helper rejects completion when tasks are incomplete, current-attempt command evidence is failing, or acceptance criteria lack evidence.

## 7. Stop and report

Stop after this milestone. Report:

- plan and run paths;
- milestone and terminal status;
- completed tasks;
- checkpoint commit when present;
- verification commands and summarized results;
- acceptance-criterion evidence coverage;
- decisions, blockers, failures, and known issues;
- the next dependency-ready milestone from `next`, without starting it.

Do not claim the whole plan is complete unless the helper reports run status `complete`. Do not launch the next milestone automatically.

## Helper guarantees and limits

The helper:

- requires a Ready plan and parses stable `M<n>` and globally unique `T<n>` IDs;
- validates milestone dependencies and acceptance-criterion ownership;
- stores compact state under `.design/runs/<plan-slug>/<run-id>/`;
- atomically creates or resolves a plan run under a recoverable per-plan lock;
- refuses ambiguous resumable runs, plan drift, and runs whose base or completed checkpoint commits are absent from the current checkout lineage;
- validates persisted state and derives artifact paths rather than trusting state-controlled paths;
- applies atomic JSON writes and recoverable per-plan and per-run locks with process-identity checks;
- blocks mutations after plan fingerprint drift;
- permits one running milestone and one running task;
- starts only the first dependency-ready milestone in plan order;
- requires current-attempt evidence before task completion;
- requires evidence for every milestone criterion before completion;
- bounds evidence fields and entries;
- records decisions append-only;
- records but never executes evidence command strings.

It does not launch agents, run checks, create commits, resolve plan changes, or decide whether evidence is semantically sufficient. Those remain execution responsibilities, with deterministic command results taking precedence over model claims. It assumes a cooperative local filesystem and does not defend against a hostile process racing validated workspace paths.
