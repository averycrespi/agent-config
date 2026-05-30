# User Statement Ingestion

Use for explicit "remember that" requests, durable preferences, user-provided conventions, recurring working style, and stable facts the user asks to retain.

## Document IDs

Anchor on the durable topic, not the current date:

| Artifact          | Shape                           | Example                                     |
| ----------------- | ------------------------------- | ------------------------------------------- |
| User preference   | `user:preference:<slug>`        | `user:preference:concise-status-updates`    |
| Global convention | `user:convention:<slug>`        | `user:convention:prefer-broker-github`      |
| Repo convention   | `repo:<repo>:convention:<slug>` | `repo:agent-config:convention:stow-editing` |
| Topic note        | `topic:<slug>`                  | `topic:memory-best-practices`               |

Use one document per discrete durable fact. Three unrelated user statements should become three documents.

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: `source:manual`, `origin:user`, and `kind:semantic` for facts/preferences or `kind:procedural` for how-to instructions. Use `scope:global` for cross-repo preferences and `scope:repo` for repo-local conventions.

Add meaning tags: `preference:<slug>`, `convention:<slug>`, `topic:<slug>`, and `tool:<name>` when the statement concerns a tool.

## Context

For preferences:

```text
User preference. Extract only the durable preference and the context in which it applies. Ignore transient task details and phrasing that does not affect future behavior.
```

For repo conventions:

```text
Repo-scoped convention for <repo>. Extract durable rules, commands, file locations, and gotchas that future agents should follow. Ignore one-off task state.
```

## Content shaping

Retain the user's phrasing when possible, plus a short clarifying sentence only if needed for future recall. Do not overgeneralize a narrow preference into a broad rule.

Good content:

```text
The user prefers concise status updates during implementation work: mention key milestones and blockers, not detailed time estimates.
```

Avoid retaining:

- Temporary task state.
- Preferences inferred from one ambiguous comment.
- Sensitive personal data unless the user explicitly asks to remember it and it is necessary.

## Split guidance

Split unrelated preferences or conventions into separate documents. Keep closely related caveats with the same preference so future agents do not recall the rule without its boundary.
