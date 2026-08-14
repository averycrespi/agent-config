# Wiki vault schema template

Use this as a starting point for a vault-local `AGENTS.md`, `WIKI.md`, or `wiki/schema.md`. Local vault instructions should override this template.

## Purpose

This repository is a private markdown wiki maintained by an LLM agent from immutable source documents. Raw sources are the source of truth. The `wiki/` directory is the maintained synthesis layer.

## Layout

```text
raw/
  sources/   # immutable source documents: articles, notes, papers, transcripts
  assets/    # local images, PDFs, screenshots, and other attachments
wiki/
  index.md   # content catalog
  log.md     # chronological operations log
  sources/   # one page per ingested source or source cluster
  concepts/  # reusable topic pages
  entities/  # people, organizations, projects, places, tools
  analyses/  # synthesized answers, comparisons, essays, arguments
  questions/ # open questions and filed Q&A
```

## Page conventions

- Use one H1 title matching the page topic.
- Start with a concise summary or current thesis.
- Link related pages with relative markdown links.
- Cite source-backed claims with source file paths and the most precise locator available.
- Preserve contradictions and uncertainty explicitly.
- Prefer updating existing pages over creating duplicates.

## Source summary pages

Source pages under `wiki/sources/` should include:

```md
# Source title

## Source

- Path: `raw/sources/...`
- Author/source: ...
- Date: ...
- Ingested: YYYY-MM-DD

## Summary

...

## Key claims

- Claim. Citation: `raw/sources/...`.

## Connections

- Related concept/entity: [[or relative link]]

## Contradictions or caveats

...

## Follow-up questions

- ...
```

## Index conventions

`wiki/index.md` is the first navigation surface for the agent and the human reader. Keep it grouped by category, with each entry containing a link and one-line summary.

Suggested format:

```md
# Index

## Sources

- [Source title](sources/source-title.md) — one-line summary.

## Concepts

- [Concept](concepts/concept.md) — one-line summary.

## Entities

- [Entity](entities/entity.md) — one-line summary.

## Analyses

- [Analysis](analyses/analysis.md) — one-line summary.

## Questions

- [Question](questions/question.md) — current status or one-line answer.
```

## Log conventions

`wiki/log.md` is append-only. Add new entries at the top unless the vault chooses chronological order.

Each entry starts with:

```md
## [YYYY-MM-DD] <operation> | <title>
```

Then include:

- Trigger or user request
- Sources read
- Pages created or changed
- Key claims or synthesis updates
- Contradictions, caveats, or open questions

Operations: `ingest`, `query`, `analysis`, `lint`, `maintenance`.
