# Ingestion Patterns

Per-source patterns for Hindsight retains. The shared rules below apply to every source; the per-source sections only call out the fetch tool, `document_id` shape, and non-obvious field values.

## Shared rules

- **One document per source artifact.** Hindsight chunks server-side; don't pre-chunk into many small retains.
- **Strip chrome aggressively.** Drop navigation, breadcrumbs, footers, cookie banners, "related posts", bot/system noise, license boilerplate, source-platform link wrappers, ephemeral dashboard query params (live timestamps, refresh modes), and zero-width / trailing whitespace. Fidelity for retrieval beats completeness.
- **Refresh by re-retaining** the same `document_id`. `sync_retain` overwrites automatically; on the async `retain` tool, the default is replace and `update_mode: "append"` concatenates.
- **Required tags are always set** — `scope:`, `repo:` (when `scope:repo`), `source:`, `origin:`, `kind:`, plus at least one namespaced caller tag. See `tags-and-ids.md` for values.

## Canonical retain shape

This is the shape every per-source pattern below produces. Only the `document_id` and caller tags vary — `scope`, `source`, `kind`, and `origin` are tag values, not top-level fields.

```jsonc
{
  "content": "<substantive body>",
  "document_id": "<see per-source shape>",
  "tags": [
    "scope:repo",
    "repo:<base>",
    "source:external",
    "kind:semantic",
    "origin:jira",
    "ticket:abc-123",
    "topic:<area>",
  ],
}
```

`update_mode` is only valid on `hindsight_retain` (the async batch tool); `hindsight_sync_retain` rejects it. Idempotency is by `document_id`.

## Per-source patterns

### Jira tickets

- **Fetch.** `atlassian_getJiraIssue` (one); `atlassian_searchJiraIssuesUsingJql` then iterate (many).
- **`document_id`.** `ticket:<key>` (e.g., `ticket:abc-123`).
- **Tags.** `scope:repo` (or `scope:global` if cross-repo — see scope decision rule), `source:external`, `origin:jira`, `kind:semantic`, plus caller tags `ticket:<key>` and `topic:<area>`.
- **Content.** Summary, description, acceptance criteria, decision-bearing comments.
- **Split only when** a single ticket has independent constraints worth recalling separately — use `ticket:<key>:constraint:<slug>` sub-IDs.

### Confluence pages

- **Fetch.** `atlassian_getConfluencePage`; for a space, `atlassian_getPagesInConfluenceSpace` then iterate.
- **`document_id`.** `confluence:<space-key>:<page-id>` — use the page ID, not the title.
- **Tags.** `scope:global` (typical — most Confluence docs are cross-repo system docs), `source:external`, `origin:confluence`, `kind:semantic` (or `procedural` for runbooks), plus caller tags `topic:<area>` and `system:<name>` when applicable.
- **Split only when** the page is a large reference doc and recall needs to address sections independently — use `confluence:<space>:<page-id>:<anchor>` sub-IDs.

### GitHub repos / files / PRs / issues

- **Fetch.** `gh` via Bash or official GitHub MCP tools exposed through the broker, such as `mcp__mcp-broker__github_get_file_contents` and `mcp__mcp-broker__github_pull_request_read`.
- **`document_id`.** See the shape table in `tags-and-ids.md`. Default to the branch name; use a SHA only for point-in-time snapshots.
- **Tags.** `scope:global` (or `scope:repo` for current-repo work), `source:external`, `origin:github`, `kind:semantic` (or `episodic` for PR/issue history), plus caller tags `topic:<area>`, `tool:<name>` for tools/libraries, `ticket:<key>` if the PR references a ticket.
- **Content.** PRs: title, description, diff if small (<400 lines), substantive review comments. Issues: title, body, resolution comments. Files: the body.
- **For a whole repo**, retain the README plus a handful of high-signal files — not the whole tree.

### Web docs and blog posts

- **Fetch.** `WebFetch`, or `playwright-cli` for JS-rendered pages.
- **`document_id`.** `web:<host>:<slug>` — strip query strings and trailing slashes; replace `/` with `-` in slugs.
- **Tags.** `scope:global`, `source:external`, `origin:web` (or `origin:docs` for product/API docs), `kind:semantic`, plus caller tags `topic:<area>`, `tool:<name>` when applicable.
- **For multi-page docs sites**, retain each page as its own document.

### User statements ("remember that X")

- **`document_id`.** Anchor on topic, not timestamp: `preference:<name>`, `convention:<name>`, `repo:<repo>:convention:<slug>`, or `topic:<slug>`.
- **Tags.** `scope:repo` (or `scope:global`), `source:manual`, `origin:user`, `kind:semantic` (or `kind:procedural` for how-to), plus a caller tag matching the document_id namespace.
- **Content.** Keep the user's phrasing; add brief context only when needed for future recall.
- **One document per discrete fact.** Three unrelated user statements → three documents.

### Agent observations

- **`document_id`.** `repo:<repo>:pattern:<slug>`, `repo:<repo>:convention:<slug>`, or `system:<name>:behavior:<slug>`.
- **Tags.** `scope:repo`, `source:agent`, `origin:chat` (or `origin:github` if derived from code inspection), `kind:semantic` (or `kind:procedural`).
- **Only retain observations that are reusable across sessions, non-obvious from the code, and likely stable.** Task-specific state belongs in plans, not memory.

### Episodic memories

- **`document_id`.** `session:<yyyy-mm-dd>:<short-slug>` or `incident:<id>` — every session/event is its own document. Don't reuse IDs across sessions.
- **Tags.** `source:agent`, `kind:episodic`, `origin:chat` (plus `scope:` and `repo:` as appropriate).

## Bulk ingestion

For many sources in one call, use `hindsight_retain` (async, batch). Call-level `tags` apply to every item; per-item `tags` are merged with them. `scope`/`source`/`kind`/`origin` are tag values, not separate fields.

```jsonc
{
  "tags": [
    "scope:global",
    "source:external",
    "kind:semantic",
    "origin:jira",
    "topic:q2-roadmap",
  ],
  "items": [
    {
      "content": "...",
      "document_id": "ticket:abc-100",
      "tags": ["ticket:abc-100"],
    },
    {
      "content": "...",
      "document_id": "ticket:abc-101",
      "tags": ["ticket:abc-101"],
    },
  ],
}
```

For very large bulk jobs (50+ sources), dispatch a subagent that fetches and retains in a loop and returns a summary — keeps raw fetch output out of the main context. **Be explicit about whether `retain` is in scope** in the subagent prompt: phrasing like "plan what to ingest" can be read as authorization to retain, and an eager subagent may bulk-ingest unprompted. If you only want exploration, include a "DO NOT call `retain` / `sync_retain` / `delete_*`" boundary.
