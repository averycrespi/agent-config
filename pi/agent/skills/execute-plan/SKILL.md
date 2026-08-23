---
name: execute-plan
description: Use when an active goal asks to execute one Ready plan autonomously across agent turns. Coordinates at most one execute-next-milestone run per turn from durable plan state; do not use for planning, ad hoc implementation, or direct single-milestone work.
---

# Execute Plan

Coordinate one active goal's Ready plan across agent turns. Keep this skill as a thin control layer: `execute-next-milestone` owns one milestone's implementation and verification, while its deterministic helper owns authoritative run state.

Do not use without an active goal and an explicit plan path. Do not implement plan tasks directly, modify plan or run artifacts manually, choose among ambiguous runs, migrate drifted state, or retry a blocked or failed run without user direction.

## Contract

- Treat the Ready plan as immutable execution intent.
- Treat helper run state as authoritative over conversation claims, TODOs, commits, child reports, and goal status.
- Execute or resume at most one milestone per Pi agent turn, including each goal auto-run continuation.
- Never start a second milestone in the same turn, even when the first completes quickly.
- Complete the goal only after helper status reports `planDrift: false` and run `state.status: "complete"`, followed by an evidence audit against the full objective.
- Yield when the run is blocked, terminally failed, drifted, ambiguous, or invalid. The only exception is one blocked/failed recovery attempt explicitly authorized by a fresh zero-continuation auto-run after the user starts or renews it. Yielding stops auto-run without completing or pausing the goal.

## Invocation

Start goal-driven execution with an objective that names the plan and this workflow explicitly:

```text
/goal Execute the Ready plan at .design/plans/YYYY-MM-DD-example.md to completion using execute-plan. Execute at most one dependency-ready milestone per agent turn. Treat plan run state as authoritative. Complete only when the helper reports the run complete; yield when execution is blocked, terminally failed, drifted, ambiguous, or invalid.
```

The plan path must be explicit in the active objective or current user request. Do not infer one from repository recency or choose among candidates.

Resolve `../execute-next-milestone/scripts/plan-run-state.js` relative to this skill directory and invoke it with `node` and an absolute path.

## One-turn protocol

### 1. Confirm coordination state

Read the active goal:

```text
goal(action="get")
```

Require an active goal and the explicit Ready plan path. If either is absent, do not begin execution. Yield when auto-run is running; otherwise report the missing precondition.

### 2. Open the durable plan run

```bash
node <helper> open \
  --cwd <repo-root> \
  --plan .design/plans/YYYY-MM-DD-example.md
```

Handle the structured result and `runStatus` together:

- `created` or `resumed` with `runStatus: "pending"` or `"running"`: continue to one milestone execution.
- `complete` with `runStatus: "complete"`: skip milestone execution and perform the final completion audit.
- `resumed` with `runStatus: "blocked"` or `"failed"`: continue to one recovery attempt only when the current auto-run has zero continuation turns, proving the user explicitly started or renewed automation after the prior stop. Otherwise yield without retrying.
- `ambiguous`, `drifted`, or `invalid`: yield with the exact run/action details and required recovery.

Never choose an ambiguous run, silently initialize after drift, or reinterpret a stopped run as pending.

### 3. Execute at most one milestone

For runnable state, read and follow `../execute-next-milestone/SKILL.md` exactly once using the explicit `runDir` returned by `open`. That skill may resume the current milestone or start the next dependency-ready milestone, but it must not enter another milestone in this turn.

After the milestone settles or the bounded executor returns, inspect authoritative state:

```bash
node <helper> status --run <run-dir>
```

### 4. Decide the turn outcome

- `planDrift: true`: yield with the drift details.
- Run `state.status: "blocked"` or `"failed"`: yield with the milestone stop reason and required intervention.
- Run `state.status: "pending"`: report the completed checkpoint and next dependency-ready milestone, then return normally. Goal auto-run owns the next turn.
- Run `state.status: "running"`: report the current milestone and task so the next continuation can resume them; do not start different work.
- Run `state.status: "complete"`: continue to the final completion audit.

A completed milestone is not a completed goal. Do not call `goal(action="complete")` while any milestone remains pending or running.

### 5. Complete or yield

Before completing, map every explicit goal requirement to concrete run evidence. Confirm at minimum:

- helper status reports `planDrift: false` and run `state.status: "complete"`;
- every milestone is `done`;
- every acceptance criterion has evidence;
- required repository checks and milestone gates passed;
- checkpoint commits required by the plan remain in checkout lineage; and
- no unresolved blocker or known issue contradicts the objective.

Then complete with concise evidence:

```text
goal(action="complete", evidence="<run path, complete status, criteria coverage, checks, and checkpoints>")
```

For a yield condition, preserve the exact authoritative reason and call:

```text
goal(action="yield", reason="<blocked, failed, drifted, ambiguous, or invalid condition and required intervention>")
```

Do not use `complete` to report partial success or `yield` merely because the work is difficult. Do not renew auto-run; continuation budgets remain user-controlled through `/goal-renew`.

## Recovery

Goal state is session-scoped, while plan run state is repository-durable. After a blocked or failed milestone yields, resolve the reported condition and invoke `/goal-renew`; the fresh auto-run session has zero continuation turns and authorizes exactly one bounded recovery attempt against the stopped run. If that attempt stops again, yield again rather than looping. Budget or user-input stops use the same user-controlled renewal path. If a fresh Pi session loses the goal, start a new explicit goal for the same plan; `open` must resume the existing durable run rather than repeat completed work.

## Turn report

When more work remains, report only:

- plan and run paths;
- milestone settled or currently running;
- checkpoint and verification summary when present;
- blocker or failure when present; and
- the next authoritative milestone or task without starting it.

Return normally so goal auto-run can schedule the next turn. Never recursively continue within the same turn.
