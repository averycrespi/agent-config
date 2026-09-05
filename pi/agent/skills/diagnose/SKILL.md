---
name: diagnose
description: Use when debugging bugs, failures, exceptions, flaky behavior, regressions, or performance problems where the cause is not already proven.
---

# Diagnose

Use a feedback-loop-first debugging discipline. Do not guess from code inspection alone when a reproducible signal can be built.

## Core rule

Strongly prefer a fast, deterministic, agent-runnable pass/fail loop before fixing. If reliable reproduction is impractical, record what was tried and why, then use the strongest available deterministic evidence to test the diagnosis and repair. Ask for missing artifacts or access only when their absence prevents a justified fix; disclose any remaining verification gap.

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

When reproduction is feasible, confirm the loop fails for the reported symptom. For nondeterministic bugs, try to increase the reproduction rate within bounded attempts; otherwise use the evidence-backed fallback above rather than forcing a failing run.

### 2. Reproduce and pin the symptom

Run the loop when available and confirm:

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

Apply the smallest evidence-backed fix and add proportionate regression-capable automated coverage when a meaningful seam exists. Prefer retaining the minimized reproduction as a test, and validate that it detects the real bug pattern. Choose test-first sequencing when it improves confidence; do not require literal failing-test-before-fix ordering or revert correct code to manufacture it.

Use the feedback loop during diagnosis and repair whenever it informs the next step. If reliable reproduction or a correct automated seam is impractical, explain why and use the strongest available deterministic evidence. Avoid adding a shallow test that cannot detect the real bug pattern.

### 6. Cleanup, verify, and report

Remove `[DEBUG-...]` instrumentation and remove throwaway harnesses unless intentionally retained as verification tools or regression coverage. Then establish final verification evidence:

- confirm the original symptom is fixed through the repro loop when available, or document fallback evidence and remaining uncertainty
- confirm the regression check passes, or document why reliable automated coverage is impractical
- run relevant broader deterministic checks and all repository-required checks; disclose failed or unrun checks
- report the supported diagnosis, verification evidence, and any unresolved uncertainty

Reuse passing evidence for unchanged relevant state, including when the retained repro is the regression test. Repeat or broaden checks only after changes (including cleanup that affects their coverage), failures, unresolved concerns, or an explicit required gate.

If the diagnosis reveals architectural friction, such as no test seam or tangled callers, recommend a follow-up after the fix is verified.
