---
name: diagnose
description: Use when debugging bugs, failures, exceptions, flaky behavior, regressions, or performance problems where the cause is not already proven.
---

# Diagnose

Use a feedback-loop-first debugging discipline. Do not guess from code inspection alone when a reproducible signal can be built.

## Core rule

Build a fast, deterministic, agent-runnable pass/fail loop before fixing. If no loop can be built, say what was tried and ask for the missing artifact or access.

## Process

### 1. Build the feedback loop

Try the narrowest reliable signal that reproduces the reported symptom:

1. failing test at the seam that reaches the bug
2. CLI command with fixture input and expected output
3. HTTP request or curl script against a local server
4. browser script for UI behavior
5. captured trace, log, payload, or replay fixture
6. throwaway harness around the smallest runnable subsystem
7. repeated or fuzz loop for intermittent failures
8. differential check between old/new versions or configs

Sharpen the loop until it is specific, repeatable, and as fast as practical. Assert the reported symptom, not merely "does not crash".

Do not move on until the loop fails in the expected way. For nondeterministic bugs, increase reproduction rate enough to debug against.

### 2. Reproduce and pin the symptom

Run the loop and confirm:

- it matches the user's reported failure, not a nearby failure
- it reproduces reliably enough for diagnosis
- the exact symptom is captured: error text, wrong output, timing, state, DOM, response, or logs

Wrong symptom means wrong fix.

### 3. Rank falsifiable hypotheses

Before changing code, write the smallest useful ranked set of falsifiable hypotheses. Each hypothesis must include a prediction:

> If <cause> is true, then <probe/change> will show <observable result>.

Discard vague hypotheses. If useful, show the ranked list to the user before probing; proceed with the best current ranking if the user is not available.

### 4. Probe one variable at a time

Map each probe to one hypothesis. Prefer:

1. debugger or REPL inspection when available
2. targeted logs at decision boundaries
3. narrow assertions in the repro loop

Never spray logs broadly. Tag temporary diagnostics with a unique prefix like `[DEBUG-a4f2]` so cleanup is mechanical.

For performance bugs, measure first: establish a baseline timing/profile/query plan, then compare one change at a time.

### 5. Fix with a regression check

If a correct test seam exists:

1. turn the minimized repro into a failing regression test
2. watch it fail for the right reason
3. apply the smallest fix
4. watch the regression test pass
5. rerun the original feedback loop

If no correct seam exists, state that explicitly. Avoid adding a shallow test that cannot fail for the real bug pattern.

### 6. Cleanup and report

Before declaring done:

- rerun the original repro loop and confirm it no longer fails
- run the regression check, or document why no correct seam exists
- remove `[DEBUG-...]` instrumentation
- delete throwaway harnesses or move them only if they are intentionally retained
- report the winning hypothesis and the evidence that proved it

If the diagnosis reveals architectural friction, such as no test seam or tangled callers, recommend a follow-up after the fix is verified.
