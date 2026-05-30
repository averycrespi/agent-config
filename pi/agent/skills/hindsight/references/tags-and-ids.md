# Tags and Document IDs

Reference for planning `document_id` values and tags for Hindsight retains from Pi. The goal is consistent deduplication and findable recall by agents.

## Document ID formula

`document_id` is the dedup key. Re-retaining with the same `document_id` and replace semantics updates the existing source instead of creating a duplicate. Omitting `document_id` can create random-ID duplicates.

Use this general shape:

```text
<origin>:<stable-source-locator>[:<granularity>:<stable-sub-id-or-slug>][@<version-or-ref>]
```

Rules:

- Lowercase. Separator `:`. No spaces. No leading/trailing punctuation.
- Anchor on a stable source identity, not title or current content.
- Same source means same ID, always.
- Use mutable refs for refreshable documents; use immutable versions/SHAs only for snapshots.
- If no stable identifier exists, use a short content-hash suffix such as `web:user-paste:<sha256-prefix>`.

## Source shapes

| Source type              | Document ID shape                                   | Example                                             |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------- |
| Jira ticket              | `jira:<key>`                                        | `jira:abc-123`                                      |
| Jira comment             | `jira:<key>:comment:<comment-id>`                   | `jira:abc-123:comment:10042`                        |
| Jira ticket facet        | `jira:<key>:<facet>:<slug>`                         | `jira:abc-123:constraint:archived-rows`             |
| Confluence page          | `confluence:<space-key>:<page-id>`                  | `confluence:eng:1234567890`                         |
| Confluence page snapshot | `confluence:<space-key>:<page-id>@v<version>`       | `confluence:eng:1234567890@v12`                     |
| Confluence section       | `confluence:<space-key>:<page-id>:section:<anchor>` | `confluence:eng:1234567890:section:rollback-plan`   |
| GitHub repo README/root  | `github:<owner>/<repo>@<ref>`                       | `github:acme/widgets@main`                          |
| GitHub file              | `github:<owner>/<repo>:<path>@<ref>`                | `github:acme/widgets:src/auth/session.ts@main`      |
| GitHub file snapshot     | `github:<owner>/<repo>:<path>@<sha>`                | `github:acme/widgets:src/auth/session.ts@9fceb02`   |
| GitHub PR                | `github:<owner>/<repo>:pr:<num>`                    | `github:acme/widgets:pr:482`                        |
| GitHub issue             | `github:<owner>/<repo>:issue:<num>`                 | `github:acme/widgets:issue:119`                     |
| Web doc                  | `web:<host>:<normalized-path-slug>`                 | `web:hindsight.vectorize.io:developer-api-retain`   |
| Product/API docs         | `docs:<host>:<normalized-path-slug>`                | `docs:playwright.dev:docs-api-class-page`           |
| Repo convention          | `repo:<repo>:convention:<slug>`                     | `repo:agent-config:convention:stow-editing`         |
| Repo pattern             | `repo:<repo>:pattern:<slug>`                        | `repo:agent-config:pattern:extension-config-helper` |
| Repo gotcha              | `repo:<repo>:gotcha:<slug>`                         | `repo:agent-config:gotcha:no-home-dot-pi-edits`     |
| Cross-repo topic         | `topic:<slug>`                                      | `topic:memory-best-practices`                       |
| User preference          | `user:preference:<slug>`                            | `user:preference:concise-status-updates`            |
| User convention          | `user:convention:<slug>`                            | `user:convention:prefer-broker-github`              |
| Episodic session         | `session:<yyyy-mm-dd>:<slug>`                       | `session:2026-05-29:hindsight-skill-design`         |
| Incident                 | `incident:<id>`                                     | `incident:abc-123`                                  |

## Mutable vs snapshot IDs

Use mutable IDs when the memory should refresh in place:

- Jira ticket latest state: `jira:abc-123`
- Confluence latest page: `confluence:eng:1234567890`
- GitHub file on default branch: `github:acme/widgets:README.md@main`

Use snapshot IDs when history matters:

- Confluence exact version: `confluence:eng:1234567890@v12`
- GitHub exact file content: `github:acme/widgets:README.md@9fceb02`
- Dated source snapshot: `jira:abc-123@2026-05-29`

Do not use a SHA or version when the user expects future refreshes to update the same memory.

## When to split a source

Default to one document per source artifact. Split only when:

- A source covers multiple independent facts future recall should retrieve separately.
- A large reference doc has stable sections with different purposes.
- A ticket contains a reusable decision or constraint that should be recalled without pulling the whole ticket.

When splitting, keep a recognizable prefix so related documents cluster together, such as `jira:abc-123:decision:use-soft-delete`.

## Required classification

The active Pi broker `hindsight.retain` schema may not expose first-class `scope`, `source`, `origin`, or `kind` fields. Encode these concepts in metadata and tags unless the schema supports them directly.

| Concept  | Values / rule                                                       | Metadata example       | Tag example       |
| -------- | ------------------------------------------------------------------- | ---------------------- | ----------------- |
| `scope`  | `repo` or `global`                                                  | `"scope": "repo"`      | `scope:repo`      |
| `source` | `manual`, `external`, or `agent`                                    | `"source": "external"` | `source:external` |
| `origin` | `jira`, `confluence`, `github`, `docs`, `web`, `chat`, `user`, etc. | `"origin": "jira"`     | `origin:jira`     |
| `kind`   | `semantic`, `episodic`, or `procedural`                             | `"kind": "semantic"`   | `kind:semantic`   |

`kind` values:

- `semantic` — facts, definitions, requirements, constraints, conventions, architecture, decisions.
- `episodic` — sessions, incidents, events, what-happened-when.
- `procedural` — how-to instructions, runbooks, recipes, workflows.

Map non-canonical content labels into these three values. For example, `reference` and `design` usually become `semantic`; `runbook` becomes `procedural`; `meeting-notes` usually become `episodic` unless distilled into durable decisions.

## Filter tags and meaning tags

Every retain should include both filter tags and meaning tags.

### Filter tags

Filter tags are mechanical. They support visibility/scoping and precise recall filters.

| Tag pattern              | Use                        | Example             |
| ------------------------ | -------------------------- | ------------------- |
| `scope:<repo-or-global>` | Recall boundary            | `scope:repo`        |
| `repo:<base-name>`       | Current repository         | `repo:agent-config` |
| `source:<source>`        | Information source class   | `source:external`   |
| `origin:<origin>`        | Underlying platform/source | `origin:jira`       |
| `kind:<kind>`            | Memory kind                | `kind:procedural`   |

### Meaning tags

Meaning tags are semantic handles. They help agents form targeted queries and help keyword/graph retrieval find related facts.

| Tag pattern         | Use                               | Example                             |
| ------------------- | --------------------------------- | ----------------------------------- |
| `topic:<slug>`      | Broad subject area                | `topic:repo-conventions`            |
| `ticket:<key>`      | Issue tracker identifier          | `ticket:abc-123`                    |
| `tool:<name>`       | Tools, libraries, platforms       | `tool:stow`                         |
| `preference:<slug>` | User preferences                  | `preference:concise-status-updates` |
| `convention:<slug>` | Working conventions               | `convention:stow-editing`           |
| `system:<name>`     | Named subsystem/service/product   | `system:auth-service`               |
| `team:<name>`       | Team or org unit when safe/useful | `team:platform`                     |

### Tags to avoid

- Free-form tags with spaces, punctuation, or sentence fragments.
- Boolean tags like `important`, `urgent`, or `todo`.
- Date stamps as tags; put dates in `document_id`, `timestamp`, content, or context.
- Tags that duplicate every `document_id` segment without improving filtering or recall.

## Tag-match semantics

Recall and reflect can filter by `tags` using match modes:

| Mode         | Match rule                            | Untagged memories |
| ------------ | ------------------------------------- | ----------------- |
| `any`        | Memory has at least one specified tag | Included          |
| `any_strict` | Memory has at least one specified tag | Excluded          |
| `all`        | Memory has every specified tag        | Included          |
| `all_strict` | Memory has every specified tag        | Excluded          |

Use:

- `any_strict` for broad tagged queries where untagged memories would add noise.
- `all_strict` for narrow intersections, such as `scope:repo` + `repo:<base>` + `ticket:<key>`.
- `any` only when intentionally including untagged general memories.
- `all` rarely; only when strict intersection plus untagged general memories is intentional.

Because strict modes exclude untagged memories, untagged retains are hard for agents to retrieve. Always tag retains.

## Pre-retain self-check

Before calling `hindsight.retain`, verify:

1. The exact Hindsight tool schema has been inspected when uncertain.
2. The memory is durable enough to retain.
3. `document_id` is stable and source-anchored.
4. Mutable vs snapshot ID choice matches the expected refresh behavior.
5. `context` is an extraction lens, not `general`.
6. Metadata/classification includes `scope`, `source`, `origin`, and `kind` when metadata is supported.
7. Tags include filter tags and at least one meaning tag.
8. `repo:<base>` is included for repo-scoped memories when useful.
9. Replace semantics are used unless append behavior is intentional.
10. Content contains no secrets, tokens, credentials, or `.env`-style assignments.
