# Ingestion Patterns

Per-source ingestion guidance now lives under `ingestion/` so agents can load only the relevant source pattern.

Use `tags-and-ids.md` for shared ingestion rules, canonical IDs, metadata/classification, tags, and the pre-retain checklist.

Use source-specific files for source-specific guidance:

- `ingestion/jira.md` — Jira tickets, comments, decisions, and facets.
- `ingestion/confluence.md` — Confluence pages, versions, and sections.
- `ingestion/github.md` — GitHub repos, files, PRs, issues, refs, and snapshots.
- `ingestion/web-docs.md` — Public docs, blog posts, canonical URLs, and multi-page docs.
- `ingestion/user-statements.md` — User preferences, explicit remember requests, and conventions.
- `ingestion/agent-observations.md` — Durable observations discovered by agents.
- `ingestion/episodic.md` — Sessions, incidents, and time-bound events.
- `ingestion/bulk.md` — Multi-source ingestion and batch-tool constraints.

Keep this file as a compatibility pointer for external agents or prompts that still reference `references/ingestion-patterns.md`; current in-repo guidance should link directly to the source-specific files under `references/ingestion/`.
