# Tags and Document IDs

Reference for planning tags and `document_id` values for Hindsight retains. The goal of these conventions is consistent dedup and findable recall.

## Document ID shapes

`document_id` is the dedup key. Scope is **per-bank** — re-retaining with the same `document_id` and `update_mode: "replace"` wipes the prior document and all its derived memories before reprocessing. Omitting `document_id` assigns a random UUID and every re-ingest creates duplicates.

Rules:

- Lowercase. Separator `:`. No spaces. No leading/trailing punctuation.
- Anchored on a **stable external identifier** (ticket key, page ID, repo + path + ref), not the title or any current content.
- Same source → same ID, always.

| Source type               | Document ID shape                            | Example                                               |
| ------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| Jira ticket               | `ticket:<key>`                               | `ticket:abc-123`                                      |
| Jira ticket sub-fact      | `ticket:<key>:<facet>:<slug>`                | `ticket:abc-123:constraint:archived-rows`             |
| Confluence page           | `confluence:<space-key>:<page-id>`           | `confluence:eng:1234567890`                           |
| Confluence section        | `confluence:<space-key>:<page-id>:<heading>` | `confluence:eng:1234567890:rollback-plan`             |
| GitHub repo (root README) | `github:<owner>/<repo>@<ref>`                | `github:acme/widgets@main`                            |
| GitHub file               | `github:<owner>/<repo>:<path>@<ref>`         | `github:acme/widgets:src/auth/session.ts@main`        |
| GitHub PR                 | `github:<owner>/<repo>:pr-<num>`             | `github:acme/widgets:pr-482`                          |
| GitHub issue              | `github:<owner>/<repo>:issue-<num>`          | `github:acme/widgets:issue-119`                       |
| Web doc                   | `web:<host>:<slug>`                          | `web:hindsight.vectorize.io:developer-api-quickstart` |
| Repo-local convention     | `repo:<repo>:convention:<slug>`              | `repo:agent-config:convention:stow-editing`           |
| Topic note (cross-repo)   | `topic:<slug>`                               | `topic:memory-best-practices`                         |
| User preference           | `preference:<name>`                          | `preference:user-name`                                |
| Episodic session          | `session:<yyyy-mm-dd>:<short-slug>`          | `session:2026-05-12:hindsight-skill-design`           |

Notes:

- For GitHub refs, prefer the default branch name over a SHA unless the user wants a point-in-time snapshot. SHA-anchored IDs guarantee no future re-ingest will update them.
- For long heading slugs (Confluence sections), pick the stable anchor ID over the visible heading text when available.
- If you genuinely cannot derive a stable identifier (e.g., a screenshot the user pasted), use a short content-hash suffix: `web:user-paste:<sha256-prefix>`.

## When to split a source into multiple documents

Default to **one document per source artifact**. Split only when:

- A single ticket or page covers multiple genuinely independent facts that future recall would want individually.
- The source is a large reference doc (50+ pages) where chunked retrieval makes more sense than a single document.

When splitting, use suffix shapes (`ticket:abc-123:constraint:archived-rows`) so all sub-documents share a recognizable prefix.

## Tag taxonomy

No tags are added for you — set the auto tags below explicitly on every retain.

### Auto tags (always set these)

| Tag pattern        | When to set                                                            | Example             |
| ------------------ | ---------------------------------------------------------------------- | ------------------- |
| `scope:repo`       | Memory is specific to one repository                                   | `scope:repo`        |
| `scope:global`     | Memory applies across repos                                            | `scope:global`      |
| `repo:<base-name>` | Required when `scope:repo`. Use base repo name, not worktree dir name. | `repo:agent-config` |
| `source:<who>`     | Who supplied this memory to the agent                                  | `source:external`   |
| `kind:<class>`     | Required. One of `semantic`, `episodic`, `procedural` — no others      | `kind:semantic`     |
| `origin:<system>`  | Where the underlying information came from                             | `origin:jira`       |

`source` values:

- `manual` — user directly stated the fact in chat ("remember that X").
- `external` — fetched from an external system (Jira, Confluence, GitHub, web).
- `agent` — derived from agent observation or reasoning.

`kind` values (tagging convention only — Hindsight does not treat these specially server-side, but downstream filters expect the canonical set):

- `semantic` — facts, definitions, constraints, conventions.
- `episodic` — events, sessions, what-happened-when.
- `procedural` — how-to instructions, runbooks, recipes.

Non-canonical kinds (`reference`, `runbook`, `design`, `meeting-notes`, etc.) silently bypass canonical-kind filters. Map your content into one of the three values above; if it doesn't fit, default to `semantic`.

`origin` values (extend as needed): `jira`, `confluence`, `github`, `docs`, `web`, `chat`, `user`.

### Caller tags (namespaced, stable)

Pick from these patterns. Avoid ad-hoc one-off tags that won't be reused.

| Tag pattern         | Use for                    | Example                   |
| ------------------- | -------------------------- | ------------------------- |
| `topic:<slug>`      | Broad subject area         | `topic:repo-conventions`  |
| `ticket:<key>`      | Issue tracker identifier   | `ticket:abc-123`          |
| `tool:<name>`       | Tools or systems           | `tool:stow`               |
| `preference:<name>` | User preferences           | `preference:user-name`    |
| `convention:<name>` | Working conventions        | `convention:stow-editing` |
| `system:<name>`     | Named subsystem or service | `system:auth-service`     |
| `team:<name>`       | Team or org unit           | `team:platform`           |

### Tags to avoid

- Free-form tags with spaces, punctuation, or sentence fragments.
- Tags that duplicate `document_id` segments — the dedup key already covers that.
- Boolean tags like `important`, `urgent` — these don't help recall narrow results.
- Date stamps as tags (use document_id for time-anchored memories instead).

## Tag-match semantics

Recall and reflect filter by `tags` using one of four match modes:

| Mode         | Match rule                          | Untagged memories |
| ------------ | ----------------------------------- | ----------------- |
| `any`        | Memory has ≥1 of the specified tags | Included          |
| `any_strict` | Memory has ≥1 of the specified tags | **Excluded**      |
| `all`        | Memory has every specified tag      | Included          |
| `all_strict` | Memory has every specified tag      | **Excluded**      |

When to use each:

- **`any_strict`** (common default) — normal scoped queries where you want on-topic, tagged memories and don't want untagged general memories leaking in.
- **`all_strict`** — narrow intersection queries (e.g., `repo:foo` AND `ticket:abc-123`) where you want only memories matching the full filter.
- **`any`** — broaden the result set by including untagged general memories alongside scoped ones.
- **`all`** — rare; use when you specifically want strict intersection but also general untagged memories.

A consequence of `any_strict` being the typical default: **untagged retains are effectively invisible**. Always tag your retains.

## Self-check before retaining

Before calling `mcp__mcp-broker__hindsight_retain` / `mcp__mcp-broker__hindsight_sync_retain`, verify:

1. `document_id` is anchored on a stable external identifier (not a title or current content).
2. `scope:repo` or `scope:global` is in tags; if `scope:repo`, `repo:<base>` is too. Apply the scope decision rule: if recall from a different repo should still find it, use `scope:global`.
3. `source:`, `origin:`, and `kind:` (one of `semantic` / `episodic` / `procedural`) are in tags.
4. At least one namespaced caller tag identifies the topic, ticket, or subsystem.
5. `scope`, `source`, `kind`, `origin` live in the `tags` array — not as top-level retain fields. `update_mode` is only valid on `mcp__mcp-broker__hindsight_retain` (the async tool); `mcp__mcp-broker__hindsight_sync_retain` rejects it.
6. Content contains no secrets, tokens, credentials, or `.env`-style assignments.
