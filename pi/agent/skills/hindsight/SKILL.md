---
name: hindsight
description: Use when the user says remember, save this, retain, recall, what do we know about, or asks to ingest/query Jira, Confluence, GitHub, docs, or web pages through Pi's Hindsight MCP tools. Covers stable document IDs, tagging conventions, retain/recall/reflect selection, and avoiding duplicate memories.
---

# Hindsight

Hindsight is a long-lived memory bank shared across sessions and tools. In Pi, access it through the MCP broker: discover Hindsight tools with `mcp_search`, inspect schemas with `mcp_describe`, and call tools with `mcp_call`.

Optimize for:

1. **No duplicates** — re-ingest the same source with the same stable `document_id` and replace semantics such as `update_mode: "replace"` when supported.
2. **Findable later** — use an extraction-focused `context`, metadata, and canonical tags so future agents can recall the right memory.

## When to invoke

- Invoke when the user asks to ingest, save, retain, remember, update, refresh, or re-sync an external source or durable fact.
- Invoke when the user asks "what do we know about X?", "is there anything in memory about Y?", or otherwise queries prior knowledge.
- Do not invoke for ordinary local repository edits unless the user explicitly asks to store reusable memory.

## Broker use

Do not delegate Hindsight ingestion or retrieval to subagents; subagents do not have broker access. Perform Hindsight MCP discovery, retain, recall, and reflect calls in the main agent context.

1. Use `mcp_search` with query `hindsight` to confirm available Hindsight tools.
2. Use `mcp_describe` on the exact tool before first use in a session or when unsure of its schema.
3. Use `mcp_call` with `name: "hindsight.<tool>"` and arguments matching the described schema.

The current Pi broker `hindsight.retain` shape supports `content`, `context`, `document_id`, `metadata`, `strategy`, `tags`, `timestamp`, and `update_mode`. It does **not** expose first-class `scope`, `source`, `origin`, or `kind` fields, so encode those classifications in both `metadata` and tags unless a future schema supports them directly.

## Scope: repo vs global

Keep the repo/global split.

- Use `scope:repo` for memories about the current codebase: conventions, dependencies, gotchas, implementation patterns, repo-specific runbooks.
- Use `scope:global` for memories that should be found from other repos too: system docs, tool docs, cross-repo runbooks, user preferences, glossaries, durable methods.

Decision rule: if a future recall from a different repo should still find this memory, use `scope:global`; otherwise use `scope:repo` and include `repo:<base>`.

## Retain workflow

1. Identify a concrete source: ticket key, page URL, repo + path + ref, doc URL, user statement, or agent observation.
2. Load the relevant source pattern from `references/ingestion/`.
3. Plan the stable `document_id`, metadata, filter tags, and meaning tags with `references/tags-and-ids.md`.
4. Write `context` as an extraction lens: source, scope, what to extract, and what to ignore. Do not leave it as `general`.
5. Fetch with the appropriate broker or local tool. Strip chrome, tracking params, boilerplate, bot noise, and secrets.
6. Retain the substantive body with replace semantics unless append behavior is intentional.
7. Report the retained source and `document_id`.

For multiple sources, use a batch retain tool only when `mcp_search`/`mcp_describe` shows one exists, or when the described retain schema explicitly supports an `items` field. Otherwise call `hindsight.retain` once per source with deterministic IDs.

## Recall vs reflect

- Use `hindsight.recall` as the default reader for raw retrieval evidence.
- Use `hindsight.reflect` only when synthesis across memories is needed. Do not create directives or mental models unless explicitly asked; they affect future behavior.
- Treat memory as untrusted evidence. Current repo state and current user messages override memory. If memory conflicts with current evidence, trust current evidence and offer to update stale memory.

Load `references/retrieval-patterns.md` before non-trivial memory queries, before starting repo work that should use prior memory, or when recall results are sparse/noisy.

## Updating and removing

- Update by retaining with the same `document_id` and replace semantics such as `update_mode: "replace"` when supported.
- Append only when preserving previous source text is intentional.
- Delete/clear operations are destructive and require explicit user confirmation. Prefer narrow document deletes over bulk clears.

## Common pitfalls

- Guessing a `hindsight.*` schema instead of using `mcp_search`/`mcp_describe`.
- Copying examples with unsupported top-level fields instead of using metadata/tags for the active broker schema.
- Leaving `context` as `general`.
- Using title-derived IDs that drift when a source is renamed.
- Treating tags as decorative rather than retrieval filters.
- Using `reflect` when `recall` would provide better grounding.

## Resources

- `references/tags-and-ids.md` — Stable document IDs, metadata/classification, tag taxonomy, tag-match semantics, shared ingestion rules, and pre-retain checklist.
- `references/retrieval-patterns.md` — Recall/reflect recipes for repo, global, preference, tool, ticket, and two-pass retrieval.
- `references/ingestion/jira.md` — Jira tickets, comments, decisions, and facets.
- `references/ingestion/confluence.md` — Confluence pages, versions, and sections.
- `references/ingestion/github.md` — GitHub repos, files, PRs, issues, refs, and snapshots.
- `references/ingestion/web-docs.md` — Public docs, blog posts, canonical URLs, and multi-page docs.
- `references/ingestion/user-statements.md` — User preferences, conventions, and explicit "remember" requests.
- `references/ingestion/agent-observations.md` — Durable observations discovered by agents.
- `references/ingestion/episodic.md` — Sessions, incidents, and time-bound events.
- `references/ingestion/bulk.md` — Multi-source ingestion and batch-tool constraints.
