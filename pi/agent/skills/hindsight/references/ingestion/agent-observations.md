# Agent Observation Ingestion

Use for durable, non-obvious observations discovered by an agent during code inspection, debugging, reviews, or repeated workflows.

## Retain sparingly

Retain only observations that are:

- Reusable across sessions.
- Non-obvious from simply reading the current file.
- Likely stable.
- Useful to future agents before they start work.

Do not retain task-specific state, current TODOs, transient branch status, failed experiments without a durable lesson, or facts that are already explicit in local instructions.

## Document IDs

| Observation     | Shape                           | Example                                             |
| --------------- | ------------------------------- | --------------------------------------------------- |
| Repo pattern    | `repo:<repo>:pattern:<slug>`    | `repo:agent-config:pattern:extension-config-helper` |
| Repo convention | `repo:<repo>:convention:<slug>` | `repo:agent-config:convention:stow-source-files`    |
| Repo gotcha     | `repo:<repo>:gotcha:<slug>`     | `repo:agent-config:gotcha:no-home-dot-pi-edits`     |
| System behavior | `system:<name>:behavior:<slug>` | `system:auth-service:behavior:session-refresh`      |

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: usually `scope:repo`, `source:agent`, `origin:chat` or the evidence source, and `kind:semantic` for patterns/gotchas or `kind:procedural` for workflows. Use `scope:global` only for cross-repo techniques or tool behavior.

Add meaning tags: `topic:<area>`, `convention:<slug>`, `system:<name>`, and `tool:<name>`.

## Context

```text
Agent observation from code inspection in <repo>. Extract only durable, non-obvious repo conventions, architecture patterns, gotchas, or reusable workflows. Ignore transient task state, branch state, and details visible directly from current files.
```

## Content shaping

Include:

- Observation stated as a durable fact.
- Evidence path or source if useful.
- Boundary conditions or exceptions.
- Why future agents need it.

Avoid:

- Long code excerpts.
- Speculative conclusions.
- One-off debugging notes without future value.
- Details that may become misleading if code changes frequently.

## Split guidance

Use one document per observation. Do not bundle several unrelated repo lessons into one memory; future agents should be able to recall the specific gotcha or pattern independently.
