---
name: test-driven-development
description: Use when implementing a feature or bugfix that involves writing meaningful application logic
---

# Test-Driven Development

Write the test first, observe the expected failure, implement the smallest behavior that passes, then refactor while green.

## Core contract

For each behavior change:

1. **RED** — write one focused test for the desired observable behavior.
2. **Verify RED** — run it and confirm it fails for the missing behavior, not a typo, setup error, or unrelated failure.
3. **GREEN** — write the minimum production code needed to pass.
4. **Verify GREEN** — run the focused test and relevant surrounding suite.
5. **REFACTOR** — improve structure only while tests remain green.

Do not write or retain task-specific production changes before the failing test. If implementation began prematurely, revert only that task's untested changes; never delete pre-existing or user-owned work to enforce the workflow.

## When to use

Use for:

- new features
- bug fixes
- meaningful behavior changes
- refactors where tests can pin current behavior

Ask before skipping test-first development for throwaway prototypes, generated code, configuration-only changes, or work with no meaningful executable behavior.

## RED

Write the smallest test that demonstrates one requirement through the public or most stable practical seam.

A good test:

- names the behavior clearly
- exercises real code
- asserts observable outcomes
- avoids mocks unless isolation is necessary
- would fail if the requested behavior were absent or broken

Run the focused test immediately. Do not proceed until the failure is expected and specific. A passing test may describe existing behavior; an error may indicate broken setup. Correct the test or harness until it fails for the intended reason.

For a bug, reproduce the reported failure before changing production code. Prefer converting the minimized reproduction into the regression test.

## GREEN

Implement only what the failing test requires. Avoid unrelated refactors, speculative options, generalized helpers, and additional behavior.

Run:

1. the focused test;
2. tests for the affected module or package;
3. broader deterministic checks required by the repository.

Fix production code when the test correctly describes required behavior. Change the test only when evidence shows its expectation or setup is wrong.

## REFACTOR

After green:

- remove duplication
- clarify names and control flow
- extract helpers only when they improve the current design
- keep behavior unchanged

Rerun the relevant tests after each meaningful refactor.

## Behavioral coverage

Require coverage proportionate to the change, not one test per function. Cover meaningful boundaries, error paths, state transitions, and regression conditions exposed by the requirement. Prefer tests that survive implementation refactors.

When adding mocks, fixtures, or test utilities, read [testing-anti-patterns.md](testing-anti-patterns.md). Understand real dependency behavior before mocking it, and never assert only that a mock behaves as configured.

## Completion checklist

Before reporting completion, verify:

- each changed behavior was introduced by an observed failing test
- each failure occurred for the expected reason
- focused and relevant surrounding tests pass
- tests exercise behavior rather than implementation details
- required edge and error cases are covered
- temporary repro code and diagnostics are removed
- validation output contains no unreported failures

If a correct automated seam does not exist, state that explicitly. Keep the best deterministic reproduction available and explain the verification gap instead of adding a shallow test that cannot detect the real failure.
