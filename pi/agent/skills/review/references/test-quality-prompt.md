# Test Quality

Review whether changed behavior has effective, maintainable regression coverage. Follow the reviewer agent's common scope, evidence, confidence, severity, and output contract.

Focus on:

- changed execution paths with no meaningful test coverage
- missing boundary, error, or failure-path cases implied by the change
- tests that assert implementation details or mock behavior instead of observable behavior
- tautological tests that would pass if the feature were broken
- brittle fixtures, excessive mocking, shared mutable state, or execution-order dependence
- descriptions and assertions that do not match the behavior under test
- setup complexity that obscures what the test proves

Do not require a test for every function. Require behavioral evidence proportionate to the regression risk, and account for deterministic checks already supplied in the review context.
