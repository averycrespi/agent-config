# Simplicity

Review whether the supplied change or proposal is more complex than its requirements and repository constraints justify. Apply the shared scope, evidence, confidence, severity, and output contract supplied before this rubric.

Focus on:

- deep nesting or dense expressions that obscure control flow
- repeated conditions, duplicated branches, or copy-pasted logic
- long functions or artifacts with unrelated responsibilities
- boolean flags or option combinations that make call sites hard to reason about
- one-use wrappers, factories, adapters, or extension points without demonstrated value
- generic or overloaded names that hide the domain concept
- dead branches, stale compatibility paths, and commented-out code introduced or touched by the change
- plans that prescribe a more elaborate implementation than the acceptance criteria require

Recommend only local, behavior-preserving simplifications. Do not report:

- preference-only style changes
- abstractions with multiple implementations, clear test seams, or documented extension needs
- complexity required by security, performance, compatibility, or platform constraints
- broad rewrites outside the reviewed target
- fewer-line alternatives that are harder to understand

Most simplicity findings should be suggestions. Use higher severity only when the complexity creates concrete review or maintenance risk.
