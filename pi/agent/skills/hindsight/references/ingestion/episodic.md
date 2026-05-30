# Episodic Ingestion

Use for sessions, incidents, migrations, releases, debugging investigations, and other time-bound events where what happened when matters.

## Document IDs

| Event             | Shape                                     | Example                                                     |
| ----------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Session           | `session:<yyyy-mm-dd>:<slug>`             | `session:2026-05-29:hindsight-skill-review`                 |
| Incident          | `incident:<id>`                           | `incident:abc-123`                                          |
| Dated repo event  | `repo:<repo>:event:<yyyy-mm-dd>:<slug>`   | `repo:agent-config:event:2026-05-29:memory-taxonomy-update` |
| Release/migration | `system:<name>:event:<yyyy-mm-dd>:<slug>` | `system:billing:event:2026-05-29:migration-cutover`         |

Every session/event should have its own document. Do not reuse episodic IDs across separate events.

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: `kind:episodic`, `source:agent` or `source:external`, and `origin:chat`, `origin:jira`, `origin:github`, `origin:confluence`, or the event source. Use `scope:repo` for repo-specific events and `scope:global` for cross-repo or user-level episodes.

Add meaning tags: `topic:<area>`, `system:<name>`, `ticket:<key>` if relevant, and `tool:<name>` if the event concerns a tool.

## Context

For sessions:

```text
Episodic session summary for <date> about <topic>. Extract what was decided, what changed, what was verified, unresolved follow-ups, and dates. Ignore routine tool call details and transient TODO state.
```

For incidents:

```text
Incident record for <id>. Extract timeline, impact, root cause, mitigation, follow-up actions, and stable lessons. Preserve dates for temporal recall. Ignore notification noise.
```

## Content shaping

Retain:

- Date/time range when known.
- Actors/systems at a high level when safe.
- What happened, decisions made, evidence, verification, unresolved follow-ups.
- Stable lessons that future agents may need.

Strip:

- Exhaustive logs unless they are the primary evidence.
- Transient branches/TODOs unless they explain the outcome.
- Sensitive operational details.

## Split guidance

Keep one document per event. If an event yields a durable convention or runbook change, retain that separately as a semantic/procedural memory and link it with a shared meaning tag.
