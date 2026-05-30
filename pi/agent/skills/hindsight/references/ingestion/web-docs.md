# Web Docs Ingestion

Use for public documentation pages, blog posts, API references, standards, and product docs fetched from the web.

## Fetch

Use web fetch/search tools for static pages. Use browser automation only when content requires JavaScript rendering or interaction. Prefer canonical URLs when available.

## Document IDs

| Artifact                              | Shape                                | Example                                           |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| Web page                              | `web:<host>:<normalized-path-slug>`  | `web:hindsight.vectorize.io:developer-api-retain` |
| Docs page                             | `docs:<host>:<normalized-path-slug>` | `docs:playwright.dev:docs-api-class-page`         |
| Blog post                             | `web:<host>:blog:<slug>`             | `web:example.com:blog:agent-memory-patterns`      |
| User-provided page with no stable URL | `web:user-paste:<sha256-prefix>`     | `web:user-paste:a1b2c3d4e5f6`                     |

Normalize by lowercasing the host, stripping query strings/fragments/trailing slashes unless the fragment is the stable section identity, and replacing path separators with `-`.

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: usually `scope:global`, `source:external`, `origin:docs` for product/API docs or `origin:web` for general pages/blogs, and `kind:semantic` for references or `kind:procedural` for how-to guides.

Add meaning tags: `topic:<area>`, `tool:<name>`, `system:<name>` when applicable, and `convention:<slug>` only when the page defines a durable convention.

## Context

For API/product docs:

```text
Public documentation for <tool-or-product>. Extract agent-usable APIs, commands, configuration fields, constraints, version notes, and examples. Ignore navigation, marketing copy, and unrelated links.
```

For blog posts:

```text
Web article about <topic>. Extract durable claims, techniques, trade-offs, examples, and caveats relevant to future agent work. Ignore author bio, newsletter prompts, and page chrome.
```

## Content shaping

Retain:

- Title, canonical URL, publication/update date when available.
- Main content, headings, code examples, constraints, warnings.
- Version applicability.

Strip:

- Navigation, cookie banners, sidebars, related posts.
- Tracking query params and session identifiers.
- Marketing boilerplate unless it defines product capabilities.

## Split guidance

For multi-page docs sites, retain each page as its own document. For very large single pages, split by stable section anchor when future recall should target sections independently.
