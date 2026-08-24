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

- The plan under `.design/plans/` is immutable execution intent.
- `state.json` is authoritative for run, milestone, and task status.
- `evidence/<milestone>.json` is authoritative for acceptance evidence.
- `decisions.jsonl` records consequential implementation rulings.
- Git commits are durable milestone checkpoints, not proof by themselves.
- TODOs are tactical aids only and never replace run state.
- The deterministic helper owns every run-state mutation. Never edit run artifacts manually.
- Conversation claims, TODOs, commits, and child output never override helper state.

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
5. Keep the main session as orchestrator and sole owner of run state, evidence, decisions, verification, and commits. Delegate implementation or repair through exactly one writable subagent at a time. Do not delegate task-level review, acceptance evaluation, or verification.

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
- `drifted`: stop and require explicit new-run initialization or migration.
- `invalid`: stop and report the checkout-lineage or state error.

For an explicit run, inspect state and plan drift:

```bash
node <helper> status --run <run-dir>
node <helper> next --run <run-dir>
```

Stop on plan drift. Do not silently migrate state after the plan changes.

### Interrupted-step rule

Always inspect `currentMilestone`, `currentTask`, and `next` before selecting work:

- A running task is the step to resume. Never select or start another task.
- A running milestone with no current task and incomplete tasks advances its first incomplete task.
- A running milestone whose tasks are all done advances only its gate.
- With no running milestone, use the helper's returned task or gate step. Start that dependency-ready milestone before advancing the returned step.

The helper returns `next.step: "task"` or `next.step: "gate"` so this choice does not depend on conversation memory.

When resuming after an interrupted agent turn, inspect the current workspace and recorded evidence before acting. Do not blindly repeat delegation or side effects:

- If implementation exists but verification was interrupted, inspect it and rerun verification.
- If implementation is partial, give one writer a resume packet describing the observed state; baseline only its new delta.
- If task completion was already recorded, follow the helper's next step rather than repeating the task.
- If a gate commit exists but milestone completion was interrupted, verify the commit and evidence before recording completion; do not create a duplicate checkpoint.

## 2. Advance one task

Use this section only when `next.step` is `task`.

If no milestone is active, start the returned milestone:

```bash
node <helper> milestone-start --run <run-dir> --milestone M1
```

If the returned task is not already running, select a profile with a brief task-specific reason and start it:

```bash
node <helper> task-start \
  --run <run-dir> \
  --task T1 \
  --profile balanced \
  --profile-reason "Bounded implementation across the state and repository seams"
```

Use the task attempt count at invocation start as the repair baseline. Historical attempts do not consume this invocation's repair allowance.

### Profile selection

Choose from task characteristics, never assumed model identities:

- `balanced` is the default for bounded implementation across related files or concerns.
- `fast` is for localized, well-specified, mechanically verifiable work with limited coupling.
- `strong` is exceptional: use it only for multiple interacting high-risk reasoning constraints that materially exceed `balanced`.

The reason must identify the concrete characteristics distinguishing the selection from the default. Do not use `strong` to compensate for an oversized task, unresolved decisions, missing context, or unsafe authority. Block those conditions instead. Do not expose configured model names or reasoning levels in the task packet.

### One-writer execution

One plan task is one tracked implementation scope. Launch one initial writer; launch another only for a bounded repair round after concrete verification failure. Do not split the task into parallel writers or invent untracked subtasks. If it is too broad for one bounded child, stop as blocked and report that the Ready plan needs finer task packets.

The writer path is trusted-local, not sandboxed: `write-filesystem` is not workspace-root restricted, and `exec-shell` inherits the parent environment. Stop as blocked if repository content, credentials, or inputs make that authority unsafe.

Before dispatch, capture staged and unstaged binary diffs plus an untracked-file path/hash manifest in a secure temporary location. Status output alone is insufficient. Launch exactly one `spawn_agents` item with `read-filesystem`, `write-filesystem`, and `exec-shell`.

The child packet must include the plan path, milestone and task IDs, task scope and outcome, owned acceptance criteria, relevant constraints and decisions, required verification, and stop conditions. It must say:

- implement exactly this task and do not gold-plate;
- use test-driven development for meaningful logic;
- do not modify `.design/plans/`, `.design/runs/`, `.git/`, or unrelated changes;
- do not invoke the helper, mutate run state, record evidence or decisions, commit, push, merge, or perform external writes;
- stop as `blocked` rather than inventing a consequential decision or expanding scope.

Pass an explicit `output_schema` to `spawn_agents`; do not accept a prose fallback:

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["done", "blocked", "failed"] },
    "changed_files": {
      "type": "array",
      "description": "At most 100 repository-relative paths, each at most 500 characters.",
      "items": { "type": "string" }
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "exit_code": { "type": "integer" },
          "summary": { "type": "string" }
        },
        "required": ["command", "exit_code", "summary"],
        "additionalProperties": false
      },
      "description": "At most 50 checks; commands at most 1000 characters and summaries at most 2000 characters."
    },
    "decisions_needed": {
      "type": "array",
      "description": "At most 50 strings, each at most 1000 characters.",
      "items": { "type": "string" }
    },
    "notes": {
      "type": "array",
      "description": "At most 50 strings, each at most 1000 characters.",
      "items": { "type": "string" }
    }
  },
  "required": [
    "status",
    "changed_files",
    "checks",
    "decisions_needed",
    "notes"
  ],
  "additionalProperties": false
}
```

After settlement, enforce the caps stated in the schema descriptions before using the result; treat any over-bound result as invalid structured output. Compare the workspace with the baseline and reconcile the child's `changed_files`. Treat the handoff and child checks as diagnostic claims, not evidence. Reject protected-path or unrelated mutations and remove the temporary baseline.

Handle the validated child status before task completion:

- Missing or invalid structured output enters the failed-step path; never infer success from prose.
- A `blocked` result must be confirmed from the workspace, then stop the milestone as `blocked` with the concrete reason.
- A `failed` result enters the bounded failure and repair process below.
- Resolve every `decisions_needed` item from existing plan or user authority and record consequential rulings. If any remains unresolved, stop as `blocked`.
- Only `done` with no unresolved decision proceeds to main-session verification.

The main session must read the implementation, evaluate it against the task contract, and rerun focused verification. Do not launch another agent to review, verify, summarize, or approve the task.

### Evidence and completion

Record only bounded evidence established by the main session and mapped to acceptance criteria:

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

Other evidence kinds are `artifact`, `inspection`, and `manual`. Use `--path` for relevant repository artifacts. Never paste raw logs, secrets, large diffs, or command output into evidence. Expected red-phase test failures are not acceptance evidence.

Mark the task complete only after supervisory verification passes:

```bash
node <helper> task-complete --run <run-dir> --task T1
```

Then stop. Report whether the helper's next step is another task or the milestone gate, but do not begin it.

## 3. Settle one milestone gate

Use this section only when `next.step` is `gate`. Do not reopen completed tasks.

If no milestone is active, start the returned milestone before recording gate evidence or attempting completion. This is required when resuming a previously blocked or failed gate:

```bash
node <helper> milestone-start --run <run-dir> --milestone M1
```

1. Run the milestone verification gate exactly as planned.
2. Run relevant repository-required checks.
3. Record gate evidence covering every criterion owned by the milestone.
4. Inspect the integrated diff and documentation impact in the main session.
5. Do not invoke an independent reviewer by default. When the plan, repository instructions, or user explicitly requires one, run it once against the integrated milestone after deterministic gates pass. Evaluate findings and repair confirmed issues through the bounded gate-repair process.
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

The helper rejects completion while tasks are incomplete, current-attempt command evidence is failing, or acceptance criteria lack evidence. After completion, stop. Report the next step or whole-plan completion without starting another milestone.

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
- Reclassify each repair independently; do not inherit the original profile automatically.
- Invalid-command corrections do not consume a round.
- Continue only when the original failure passes, the failing set shrinks, or output proves the diagnosis and exposes a narrower failure.
- Stop early when the same essential failure survives two consecutive rounds, a repaired check regresses without a new diagnosis, or no falsifiable next step remains.

For a meaningful failure, record the failed command with its real exit code, diagnose it, and stop the milestone as `failed` before another round:

```bash
node <helper> milestone-stop \
  --run <run-dir> \
  --milestone M1 \
  --status failed \
  --reason "Focused verification failed"
```

If allowance remains, restart the same milestone. For a task step, restart the same task with a newly selected profile. For a gate step, record the repair selection before delegating:

```bash
node <helper> gate-repair-profile \
  --run <run-dir> \
  --milestone M1 \
  --profile balanced \
  --profile-reason "Focused integration repair across two related seams"
```

Delegate one focused repair, inspect its isolated delta, and rerun affected checks in the main session. Never launch a separate repair reviewer. Leave the milestone failed if bounds are exhausted.

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
- `failed`: bounded repair ended without a passing step;
- `drifted`, `ambiguous`, or `invalid`: preflight cannot select safe work;
- `complete`: helper run status is `complete` and no step remains.

Include the plan and run paths, step and status, focused verification summary, evidence coverage, checkpoint when present, blockers or known issues, and the helper-reported next step. Do not claim whole-plan completion unless helper status is `complete`.

Return control to the caller. Do not invoke another plan step recursively and do not call goal tools.

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
- requires current-attempt evidence before task completion;
- requires criterion evidence before milestone completion;
- bounds evidence and profile history;
- records decisions append-only;
- records but never executes evidence command strings.

It does not launch agents, run checks, create commits, resolve plan changes, or decide whether evidence is semantically sufficient. Those remain execution responsibilities. It assumes a cooperative local filesystem and does not defend against a hostile process racing validated workspace paths.
