# Confluence Ingestion

Use for Confluence pages, runbooks, design docs, decisions, and large internal reference pages.

## Fetch

Use the available Confluence/Atlassian MCP broker tool when present. Prefer page IDs and version numbers from the source over visible titles.

## Document IDs

| Artifact         | Shape                                                          | Example                                               |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| Latest page      | `confluence:<space-key>:<page-id>`                             | `confluence:eng:1234567890`                           |
| Page snapshot    | `confluence:<space-key>:<page-id>@v<version>`                  | `confluence:eng:1234567890@v12`                       |
| Page section     | `confluence:<space-key>:<page-id>:section:<anchor>`            | `confluence:eng:1234567890:section:rollback-plan`     |
| Section snapshot | `confluence:<space-key>:<page-id>:section:<anchor>@v<version>` | `confluence:eng:1234567890:section:rollback-plan@v12` |

Use latest-page IDs for refreshable docs. Use `@v<version>` only when the exact historical version matters.

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: `source:external`, `origin:confluence`, and `kind:procedural` for runbooks or `kind:semantic` otherwise. Scope is usually `global` unless the page only describes the current repo.

Add meaning tags: `topic:<area>`, `system:<name>`, `tool:<name>` if the page documents a tool, and `convention:<slug>` if it defines a durable convention.

## Context

For runbooks:

```text
Confluence runbook for <system-or-topic>. Extract durable procedures, commands, prerequisites, rollback steps, safety checks, and known failure modes. Ignore page navigation, ownership boilerplate, and stale status banners unless they affect execution.
```

For design/reference pages:

```text
Confluence reference page for <system-or-topic>. Extract durable architecture, decisions, constraints, terminology, dependencies, and rationale. Ignore meeting logistics and page chrome.
```

## Content shaping

Retain:

- Page title, page ID, and version/date when available.
- Summary and substantive sections.
- Decision tables, runbook steps, constraints, warnings, examples.
- Stable diagrams only as textual summaries unless image content is accessible and important.

Strip:

- Navigation, breadcrumbs, comments with no decision value.
- Labels/macros that do not affect meaning.
- Generated table-of-contents noise.
- Proprietary details that should not be retained.

## Split guidance

Default to one document per page. Split large pages when sections are independently useful during recall, especially long runbooks, API references, or design docs with separate decisions.
