# Correctness

Review the supplied target for logic errors, broken behavior, and unmet requirements. Apply the shared scope, evidence, confidence, severity, and output contract supplied before this rubric.

Focus on:

- incorrect conditionals, control flow, or state transitions
- boundary, empty-input, null/undefined, overflow, and off-by-one failures
- unhandled errors or incorrect error propagation
- race conditions, ordering hazards, and unsafe shared-state mutations
- type conversion, coercion, signature, or parameter mismatches
- behavior that conflicts with acceptance criteria or the target's stated intent
- regressions introduced at integration boundaries

Prefer concrete execution paths over hypothetical edge cases. Report a missing case only when the changed behavior and available evidence show a plausible failure.
