# Bulk Ingestion

Use for ingesting many related sources such as ticket sets, documentation pages, PR batches, or research corpora.

## Tool constraint

Do not assume batch support. Public Hindsight APIs recommend batch ingestion, but Pi agents must follow the active broker schema.

1. Use `mcp_search` for Hindsight tools.
2. Use `mcp_describe` on any candidate batch retain tool.
3. Use batch input only if the described tool supports it, such as a dedicated batch tool or an explicit `items` field.
4. If no batch shape exists, call `hindsight.retain` once per source with deterministic `document_id` values.

## Batch policy

For each item, preserve:

- Stable `document_id`.
- Extraction-focused `context`.
- Per-item meaning tags such as `ticket:<key>` or `tool:<name>`.
- Shared filter tags such as `scope:global`, `source:external`, `origin:docs`, and `kind:semantic`.

If using a batch tool with shared tags, ensure item-level tags are merged rather than replacing shared tags. If the schema is ambiguous, prefer individual retains.

## Grouping strategy

Group related sources that share extraction goals:

- One docs site section.
- One ticket epic or milestone.
- One repo's high-signal files.
- One research topic.

Do not mix unrelated source types in the same batch if it forces vague `context` such as `general`.

## Context

For related docs pages:

```text
Bulk documentation ingestion for <tool-or-topic>. Extract durable APIs, configuration, commands, constraints, examples, and version notes. Ignore navigation and marketing copy.
```

For related tickets:

```text
Bulk Jira ingestion for <topic-or-epic>. Extract durable requirements, constraints, acceptance criteria, decisions, unresolved risks, and cross-ticket dependencies. Ignore status chatter and sprint logistics.
```

## Verification

After bulk ingestion, report:

- Number of sources retained.
- Document ID prefix/range.
- Shared scope and key tags.
- Failures or skipped sources.

If list/read Hindsight tools are available and working, spot-check a few documents or tags. If they fail, report that verification was limited to successful retain responses.
