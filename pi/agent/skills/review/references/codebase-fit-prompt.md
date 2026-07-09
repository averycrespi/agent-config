# Codebase Fit

Review whether the supplied changes fit established repository conventions and architecture. Follow the reviewer agent's common scope, evidence, confidence, severity, and output contract.

Focus on:

- naming, imports, file placement, and module boundaries that conflict with nearby patterns
- duplicated utilities or abstractions already present in the codebase or standard library
- logic placed in the wrong layer or bypassing established integration seams
- inconsistent error handling, configuration, logging, or dependency choices
- violations of `AGENTS.md`, `CLAUDE.md`, design docs, or local conventions
- incompatible API, schema, lifecycle, or extension-surface changes

Cite the established local pattern that the change conflicts with. Do not flag harmless variation when the repository has no clear convention.
