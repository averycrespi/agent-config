# Code Quality

Review the supplied changes for design and craftsmanship problems that create concrete maintenance risk. Follow the reviewer agent's common scope, evidence, confidence, severity, and output contract.

Focus on:

- unnecessary complexity, duplication, or weak separation of concerns
- abstractions at the wrong level or without a demonstrated second use
- unclear names, misleading comments, or convoluted control flow
- long functions, deep nesting, dead code, and unreachable branches
- responsibilities mixed across layers or lifecycle boundaries
- comments that omit a necessary non-obvious invariant or explain behavior inaccurately

Do not optimize for fewer lines or personal style. Report only issues whose current shape materially harms comprehension, modification, or correctness.
