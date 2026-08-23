---
name: execute-next-milestone
description: Use when implementing exactly one dependency-ready milestone from a Ready plan, directly or as one execute-plan agent turn, with durable run state, task progress, decisions, and evidence. Never use it to execute multiple milestones in one turn.
---

# Execute Next Milestone

Implement exactly one dependency-ready milestone from one Ready plan. This is the bounded executor for a direct milestone request and for one agent turn coordinated by `execute-plan`. Keep the plan immutable, persist authoritative run state and evidence outside conversation history, and stop after the selected milestone reaches `done`, `blocked`, or `failed`.

Treat one Pi agent turn as one invocation budget. Never start or continue into a second milestone in the same turn. In goal-driven execution, `execute-plan` owns cross-turn continuation and whole-plan goal completion.

## Core contract

- The plan under `.design/plans/` is immutable execution intent.
- `state.json` is authoritative for run, milestone, and task status.
- `evidence/<milestone>.json` is authoritative for acceptance evidence.
- `decisions.jsonl` records consequential implementation rulings.
- Git commits are durable milestone checkpoints, not proof by themselves.
- TODOs are tactical aids only and never replace run state.
- The deterministic helper owns every state mutation. Never edit run artifacts manually.
- In goal-driven execution, helper run state and plan-drift status are authoritative over conversation claims, TODOs, commits, child output, and goal status.
- A completed milestone does not authorize goal completion. Only helper run status `complete` can pass the coordinator's whole-plan completion gate.

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
5. Keep the main session as orchestrator and sole owner of run state, evidence, decisions, task and milestone verification, and commits. Delegate implementation and repair through exactly one writable subagent at a time; never batch a writable child with another agent. Do not delegate task-level review, acceptance evaluation, or verification.

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

1. Read enough repository context to construct a self-contained task packet, select a profile, and write a brief task-specific profile reason.
2. Start it through the helper with that profile selection.
3. Capture a content baseline outside the repository so the child's changes can be distinguished from pre-existing and earlier-task work, including when both touch the same file.
4. Launch one `spawn_agents` item with `read-filesystem`, `write-filesystem`, and `exec-shell`; never include another item in that call.
5. Reconcile the returned structured handoff with the isolated workspace delta.
6. Perform supervisory verification in the main session: read the changed implementation and relevant surrounding code, then evaluate it against the task outcome, constraints, and owned acceptance criteria.
7. Independently run the task's focused verification in the main session.
8. Inspect compatibility, documentation, and integration impact where applicable.
9. Record only bounded evidence established by the main session and mapped to the milestone's acceptance criteria.
10. Mark the task complete only after the helper accepts its evidence.

One plan task is one writable-agent assignment. Do not dynamically split it across multiple writers or invent untracked subtasks. If the task is too broad for one bounded child, stop as blocked and report that the Ready plan needs finer task packets rather than creating an implicit execution plan.

Choose the profile from task characteristics, never from assumed model identities:

- `balanced` is the default for bounded implementation across related files or concerns.
- `fast` is for localized, well-specified, mechanically verifiable work with limited coupling.
- `strong` is exceptional. Use it only when the bounded task has multiple interacting high-risk reasoning constraints that materially exceed `balanced`, not merely because its scope mentions security, concurrency, compatibility, migrations, fault tests, or a large acceptance criterion.

The profile reason must state the concrete task characteristics that distinguish the selection from the default; do not restate the profile definition. Do not use `strong` as a substitute for an oversized task, unresolved product or architecture decisions, missing user context, or unsafe authority. Block and escalate those conditions instead. Do not expose configured model names or reasoning levels in the task packet.

This initial writer path is trusted-local, not sandboxed: `write-filesystem` is not workspace-root restricted, and `exec-shell` inherits the parent environment and can perform external actions. If repository content, available credentials, or task inputs make that authority unsafe, stop as blocked instead of delegating. Prompt restrictions are not an enforcement boundary.

The child prompt must include the plan path, milestone and task IDs, task scope and outcome, owned acceptance criteria, relevant constraints and decisions, required verification, and stop conditions. It must also state:

- implement exactly this task and do not gold-plate;
- use test-driven development for meaningful logic;
- do not modify `.design/plans/`, `.design/runs/`, `.git/`, or unrelated existing changes;
- do not invoke `plan-run-state.js`, mutate run state, record evidence or decisions, commit, push, merge, or perform external writes;
- stop and report `blocked` rather than inventing a consequential decision or expanding scope.

Require `output_schema` with this logical contract:

- `status`: `done`, `blocked`, or `failed`;
- `changed_files`: array of repository-relative paths;
- `checks`: array of objects containing `command`, `exit_code`, and bounded `summary`;
- `decisions_needed`: array of strings;
- `notes`: array of strings.

Before dispatch, capture staged and unstaged binary diffs plus an untracked-file path/hash manifest in a secure temporary location; status output alone is insufficient. After settlement, compare the workspace against that baseline to isolate this child's delta, then compare `changed_files` with the isolated delta. Treat the handoff, child checks, and child summary as diagnostic claims, not acceptance evidence. A task cannot complete until the main session has read the implementation, evaluated it against the task contract, and rerun its required verification. Reject protected-path or unrelated mutations, remove the temporary baseline after the task settles, and rerun relevant checks yourself. If the child reports a blocker or consequential decision, handle it through the milestone stop or decision process; do not let the child resolve it implicitly.

Do not launch a second agent to review, verify, summarize, or approve a completed task. The main session performs task-level supervisory verification; a separate reviewer never substitutes for reading the delta and running the checks.

Start a task:

```bash
node <helper> task-start \
  --run <run-dir> \
  --task T1 \
  --profile balanced \
  --profile-reason "Bounded implementation across the state and repository seams"
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

- Each task gets at most three repair rounds in the current invocation. A round diagnoses the current failure, independently reclassifies the focused repair, records the new selection when restarting the task, delegates it to exactly one writable child, and reruns the failed check plus directly affected checks in the main session.
- The milestone verification gate gets a separate allowance of at most three repair rounds after all tasks are complete. Its repairs do not reopen completed tasks; record each gate-repair profile on the running milestone before delegation.
- A repair used by one task does not consume another task's or the milestone gate's allowance.
- A different required check failing after the original check passes consumes the next round in the same scope; it does not require an immediate final stop.
- Invalid verification-command corrections do not consume a repair round.

Continue only while repair produces concrete progress. Progress means the original failure passes, the failing set shrinks, or output proves the diagnosis and exposes a different narrower failure. A changed error message alone is not progress. Stop the scope early when the same essential failure survives two consecutive repair rounds, a repaired check regresses without a concrete new diagnosis, or no falsifiable next step remains. Always stop after three repair rounds if the scope still fails.

For a meaningful failed check:

1. Record the failed command as evidence with its real exit code.
2. Diagnose the failure from concrete output and compare it with the previous round in that scope.
3. Stop the milestone as `failed` before beginning a new round.
4. If the scope still has allowance and the prior round made progress when applicable, restart the milestone and independently select a profile for the narrower repair. For a task failure, restart the failed task with that profile and a new reason. For a milestone-gate failure, leave completed tasks closed and record the profile with `gate-repair-profile`. Delegate one focused repair with the concrete failure evidence and current diff. After it settles, inspect the repair delta and rerun the failed scope in the main session; do not launch a separate repair reviewer. A repair will often be `fast` or `balanced`; use `strong` only when the remaining diagnosis independently meets its threshold, never merely to retry blindly.
5. If the check passes, continue the task or gate. If another required check fails, evaluate it as the next round in the same scope.
6. If an early-stop condition applies or the third repair round does not pass the scope, leave the milestone failed and stop.

Record a milestone-gate repair after restarting the milestone:

```bash
node <helper> gate-repair-profile \
  --run <run-dir> \
  --milestone M1 \
  --profile balanced \
  --profile-reason "Focused integration repair across two related seams"
```

Stop a failed scope:

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
4. Inspect the integrated diff and documentation impact in the main session.
5. Do not invoke an independent reviewer by default. When the plan, repository instructions, or user explicitly requires independent review, run it once against the integrated milestone after deterministic gates pass. The main session must evaluate any findings, repair confirmed issues through the bounded gate-repair process, and rerun affected checks.
6. Create one logical verified checkpoint commit when the milestone changed files. Stage files by name and never push.
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

When invoked by `execute-plan`, treat this report as the milestone handoff back to the coordinator. The coordinator may inspect final run status and complete or yield the goal in the same turn, but it must not start another milestone. On a blocked or failed milestone, it must yield rather than automatically open a new execution attempt.

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
- records bounded profile selection history and rationale for every newly started task attempt and milestone-gate repair;
- records but never executes evidence command strings.

It does not launch agents, run checks, create commits, resolve plan changes, or decide whether evidence is semantically sufficient. Those remain execution responsibilities, with deterministic command results taking precedence over model claims. It assumes a cooperative local filesystem and does not defend against a hostile process racing validated workspace paths.
