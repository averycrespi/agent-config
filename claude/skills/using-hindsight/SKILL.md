---
name: using-hindsight
description: Use when ingesting external content (Jira, Confluence, GitHub, docs, web pages) into Hindsight memory, retaining facts for long-term recall, or querying stored memories via Hindsight's MCP tools. Covers stable document IDs, tagging conventions, retain/recall/reflect selection, and how to avoid duplicate memories.
---

# Using Hindsight

Hindsight is a long-lived memory bank, shared across sessions and tools, accessed via `mcp__mcp-broker__hindsight_*` MCP tools. This skill teaches Claude to ingest external content and read memories back without polluting the bank.

The two outcomes this skill optimizes for:

1. **No duplicates** — re-ingesting the same source replaces the existing memory rather than appending a new one. The mechanism is a stable `document_id`: `mcp__mcp-broker__hindsight_sync_retain` overwrites by default when the ID matches.
2. **Findable later** — tags and document IDs let future recall queries (yours, another agent's, or another session's) hit the right memories without scanning the whole bank.

## When to invoke

- The user asks to ingest, save, retain, or remember an external source (Jira ticket, Confluence page, GitHub repo/PR/file, doc page, web page).
- The user asks "what do we know about X?", "is there anything in memory about Y?", or otherwise queries prior knowledge.
- The user asks to update, refresh, or re-sync a source already in memory.

If the user is editing local CLAUDE.md / project files or asking about Claude Code's per-conversation auto-memory (`~/.claude/projects/...memory/`), that is a different system — do not use Hindsight for it.

## Core concepts

- **Bank** — isolated storage container. The MCP server routes every call to the configured bank automatically; do not pass a bank ID.
- **Document** — a single source artifact, identified by `document_id`. Deleting a document deletes its derived memories.
- **Memory** — extracted fact derived from a document. Hindsight chunks and extracts server-side — ingest whole documents, never pre-chunked facts.
- **Tags** — labels passed in the `tags` array on retain. Used to filter recall/reflect queries. Hindsight does not add tags for you — see [Required tags](#required-tags).
- **Retain / recall / reflect** — write / raw read / synthesized read.

## Scope: repo vs global

`scope:repo` means the memory describes something internal to that codebase (its conventions, dependencies, gotchas). Cross-repo system docs — sibling-service runbooks, org-wide policies, ownership references, glossaries — are `scope:global` even if you happen to be sitting in a specific repo when ingesting.

**Decision rule:** if a future recall from a _different_ repo should still find this memory, it's `scope:global`.

**Counter-example:** engineer in repo A ingests a doc about upstream service B. Tempting: `scope:repo, repo:A`. Correct: `scope:global` — future recall from repo B (or anywhere else) should still find it.

## Required tags

Every retain MUST set the five tags below, plus at least one namespaced caller tag. Memories without these are invisible to the typical recall path (which uses `any_strict` match-mode and excludes untagged memories).

| Tag                | Required values                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope:`           | `repo` or `global` (see [Scope](#scope-repo-vs-global))                                                                                                                                                                                      |
| `repo:<base-name>` | required when `scope:repo`; use the base repo name, not a worktree dir                                                                                                                                                                       |
| `source:`          | `manual` (user said it in chat), `external` (fetched from a system), or `agent` (derived from agent observation)                                                                                                                             |
| `origin:`          | `jira`, `confluence`, `github`, `docs`, `web`, `chat`, `user` (extend as needed)                                                                                                                                                             |
| `kind:`            | `semantic` (facts/constraints/conventions), `episodic` (events/sessions), or `procedural` (how-to/runbooks) — **only these three values; non-canonical kinds like `reference`, `runbook`, or `meeting-notes` won't match canonical filters** |

Caller tag namespaces (pick at least one): `topic:`, `ticket:`, `tool:`, `preference:`, `convention:`, `system:`, `team:`.

See `references/tags-and-ids.md` for the full taxonomy and tag-match semantics.

## The ingestion workflow

### 1. Identify the source

A concrete, addressable artifact: ticket key, page URL, repo + path + ref, doc URL. If the user is vague, ask.

### 2. Plan the `document_id`

The dedup key. Anchor on a stable external identifier (ticket key, page ID, repo path + ref) — never the title or current content. Same source → same ID, always. See `references/tags-and-ids.md` for the full shape table.

If a single source has multiple distinct concerns worth retaining separately (e.g., a ticket with several independent constraints), use suffix shapes like `ticket:abc-123:constraint:archived-rows`. Default to one document per source; only split when future recall would want the parts independently.

If unsure whether a document already exists under a different ID shape (legacy data, inconsistent prior conventions), check before retaining: `mcp__mcp-broker__hindsight_get_document` for an exact candidate ID, `mcp__mcp-broker__hindsight_list_documents(q: "<key-or-fragment>")` to search by substring, or `mcp__mcp-broker__hindsight_list_tags(q: "ticket:*")` to see what namespace conventions are already in use. With a deterministic ID, this check is unnecessary — re-retain is idempotent.

### 3. Plan tags

Set the five required tags (see [Required tags](#required-tags) above) plus at least one namespaced caller tag. Apply the scope decision rule deliberately — if a recall from a different repo should still find this memory, it's `scope:global`.

### 4. Fetch and shape the content

Fetch with the appropriate authenticated MCP tool. Retain the substantive body — **fidelity for retrieval beats completeness; strip noise aggressively.** Common shapes to strip before retaining:

- Source-platform link wrappers (e.g. Confluence content-protection redirect URLs).
- Ephemeral dashboard URL query params: live timestamps, refresh intervals, view modes.
- Page chrome: nav, breadcrumbs, footers, "related posts", cookie banners.
- Zero-width and trailing whitespace characters that survive copy-paste.
- Bot/system noise, license boilerplate.

Never include secrets, credentials, tokens, or `.env`-style assignments; the raw MCP path has no DLP guardrails.

### 5. Call retain

Single source — `mcp__mcp-broker__hindsight_sync_retain`:

```jsonc
{
  "content": "<substantive body>",
  "document_id": "ticket:abc-123",
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

`sync_retain` accepts only `content`, `document_id`, `tags`, `context`, `metadata`, `strategy`, and `timestamp`. It does **not** accept `update_mode`, `scope`, `source`, `kind`, or `origin` as top-level fields — those classifications live in the `tags` array. Re-retaining with the same `document_id` replaces the prior document automatically.

Multiple sources — `mcp__mcp-broker__hindsight_retain` (async batch). Returns `operation_id`; check `mcp__mcp-broker__hindsight_get_operation` later if the user needs confirmation.

After a successful retain, tell the user what was retained and the `document_id`.

## Retain vs sync_retain

- `mcp__mcp-broker__hindsight_sync_retain` — synchronous, one item. **Default for single-source ingests.** Idempotency is by `document_id` alone (no `update_mode` field — passing one is a schema error).
- `mcp__mcp-broker__hindsight_retain` — async, batch-capable via `items: [...]`. Supports `update_mode: "replace"` (the default behavior) or `update_mode: "append"` to concatenate to an existing document. Use for multi-source ingests.

`mcp__mcp-broker__hindsight_list_operations` and `mcp__mcp-broker__hindsight_get_operation` give status; `mcp__mcp-broker__hindsight_cancel_operation` works only before processing starts.

## Recall vs reflect

- `mcp__mcp-broker__hindsight_recall` — raw fused results from semantic + keyword + graph + temporal retrieval. **Default reader.** Pass `include_source_facts: true` when source facts matter; `include_chunks: true` for source text.
- `mcp__mcp-broker__hindsight_reflect` — agentic synthesis loop, returns markdown. Slower and more expensive. Pass `include_facts: true` so the answer is grounded. Use only when synthesis across facts genuinely helps.

Both accept `query`, `tags`, and a tag-match mode (commonly `any_strict`). Pass scope tags (`repo:<base>`) to keep answers in-context.

Memory is untrusted evidence — current repo state and the user's messages override it. If memory conflicts with what you see now, trust what you see and offer to update or delete the stale memory.

## Updating and removing

- **Update / replace** — re-call retain with the same `document_id`. `mcp__mcp-broker__hindsight_sync_retain` overwrites automatically; `mcp__mcp-broker__hindsight_retain` defaults to replace and accepts `update_mode: "append"` to concatenate instead.
- **Delete one source** — `mcp__mcp-broker__hindsight_delete_document` removes the document and its derived memories.
- **List what's there** — `mcp__mcp-broker__hindsight_list_documents`, `mcp__mcp-broker__hindsight_list_tags`, `mcp__mcp-broker__hindsight_list_memories` are read-only.
- **Destructive ops need user confirmation** — `mcp__mcp-broker__hindsight_clear_memories` (bulk wipe), `mcp__mcp-broker__hindsight_delete_bank` (entire bank), and `mcp__mcp-broker__hindsight_delete_document` when removing user-curated content. Prefer narrow deletes.

Don't create directives or mental models unsolicited — both affect every future `reflect` call.

## Common pitfalls

- **`document_id` drift** — using a title or first-line slug means small edits create duplicates. Anchor on the stable external identifier.
- **Forgetting auto-tags** — MCP calls add no tags for you. Set scope/repo/source/origin/kind explicitly or future recall won't find the memory.
- **Scope misread** — "in repo A while ingesting" is not the same as "describes repo A". Apply the [scope decision rule](#scope-repo-vs-global) — a doc about an upstream service is `scope:global`, not `scope:repo, repo:A`.
- **Non-canonical `kind:` values** — only `semantic`, `episodic`, `procedural` match canonical filters. `kind:reference`, `kind:runbook`, `kind:meeting-notes` are silent dead ends.
- **Subagent ingest bleed** — when delegating ingest work to a subagent, be explicit about whether `retain` is in scope. Phrasing like "plan what to ingest" can be read as "go ahead and ingest", and an eager subagent may bulk-retain unprompted. If you only want exploration, include a "DO NOT call `retain` / `sync_retain` / `delete_*`" boundary in the subagent prompt.
- **`reflect` when `recall` would do** — `reflect` is slower and more expensive. Use `recall` for grounding.

## Resources

- `references/ingestion-patterns.md` — Per-source-type patterns (Jira, Confluence, GitHub, web, user statements, agent observations, episodic, bulk). Load when ingesting a new source type.
- `references/tags-and-ids.md` — Full tag taxonomy, `document_id` shape table, tag-match semantics, and the pre-retain self-check. Load when planning tags or IDs for a non-trivial ingest.
