# Fix Step Prompt Template

This template supports the OPTIONAL, user-directed fix step that runs only AFTER
the full review report has been presented and the user has explicitly approved
fixing specific findings. Review itself is non-destructive; it never auto-fixes.
Do not use this template as part of an automatic fix/re-review loop.

Dispatch a single fixer agent with the confirmed findings the user chose to
address. Fill in `FINDINGS` and the project's check commands.

```
Agent tool (general-purpose):
  description: "Apply approved review fixes"
  prompt: |
    You are applying fixes for review findings the user has explicitly approved.

    ## Findings to Fix

    FINDINGS

    ## Instructions

    1. Fix only the findings listed above. Do not expand scope.
    2. For each fix:
       - Read the relevant code
       - Make the minimal change needed
       - Preserve existing behavior outside the finding's intent
    3. After all fixes, run the project's deterministic checks to confirm
       nothing regressed:
       - Tests: [test command from project]
       - Linter: [lint command if applicable]
       - Type-checker: [type-check command if applicable]
    4. If a finding is ambiguous or needs a design decision, do NOT guess.
       Report it as unresolvable.
    5. If fixing one finding conflicts with another, report both as
       unresolvable and explain the conflict.

    ## Report Format

    FIXED:
    - <file>:<line> | <description of fix>

    UNRESOLVABLE:
    - <original finding> | <reason it cannot be safely fixed>
```

After the fixer returns, report what was fixed and what remains unresolved. Do
not silently re-run the full review panel; if the user wants re-verification,
they can invoke the review skill again on the updated changes.
