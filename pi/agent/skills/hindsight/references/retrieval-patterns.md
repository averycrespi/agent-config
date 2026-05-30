# Retrieval Patterns

Use before non-trivial Hindsight queries, repo work that should use prior memory, or sparse/noisy recall results.

## Default reader

Use `hindsight.recall` for grounding. Use `hindsight.reflect` only for synthesis across memories. Memory is evidence, not authority; current repo state and current user instructions override it.

## Active recall schema

The current Pi broker `hindsight.recall` schema supports `query`, `budget`, `max_tokens`, `query_timestamp`, `tags`, `tags_match`, and `types`. Do not pass unsupported fields such as `scope` directly unless `mcp_describe` shows they exist. Scope is represented through tags like `scope:repo` and `scope:global`.

## Parameter rules

- Use `tags_match: "all_strict"` for precise boundaries: repo + ticket, repo + convention, global + tool.
- Use `tags_match: "any_strict"` for broader discovery across known tags.
- Avoid default `any` unless intentionally including untagged memories.
- Use `budget: "low"` for quick preflight, `"mid"` for normal repo/tool lookup, and `"high"` for research, debugging, or sparse multi-hop results.
- Use `max_tokens: 1000-2000` for quick preflight, `4096` for normal context, and `8000+` only for broad research when worth the context cost.
- Use `types: ["world", "experience"]` for factual work when supported. Use `types: ["experience"]` for sessions/incidents/history.

## Repo preflight

Before non-trivial work in a repo, recall repo-scoped memory first:

```jsonc
{
  "name": "hindsight.recall",
  "arguments": {
    "query": "What durable conventions, gotchas, and workflows matter for working in repo <repo>?",
    "tags": ["scope:repo", "repo:<base>"],
    "tags_match": "all_strict",
    "budget": "mid",
    "max_tokens": 2000,
    "types": ["world", "experience"],
  },
}
```

If results are sparse and the task involves tools or cross-repo conventions, run a second global recall.

## Two-pass recall

Use two-pass recall when local and general knowledge could both matter:

1. **Repo pass** — `scope:repo` + `repo:<base>` with `all_strict`.
2. **Global pass** — `scope:global` plus `tool:<name>`, `topic:<area>`, or `preference:<slug>` with `all_strict` when tags are known, or `any_strict` for broader discovery.

Global tool example:

```jsonc
{
  "name": "hindsight.recall",
  "arguments": {
    "query": "What durable commands, APIs, constraints, and gotchas are known for <tool>?",
    "tags": ["scope:global", "tool:<name>"],
    "tags_match": "all_strict",
    "budget": "mid",
    "max_tokens": 3000,
  },
}
```

## Common recipes

### User preferences

```jsonc
{
  "query": "What durable user preferences apply to <decision-or-workflow>?",
  "tags": ["scope:global", "source:manual", "origin:user"],
  "tags_match": "all_strict",
  "budget": "low",
  "max_tokens": 1500,
}
```

Add a known preference tag, such as `preference:concise-status-updates`, when available.

### Ticket or issue

```jsonc
{
  "query": "What requirements, constraints, decisions, and risks are known for ticket ABC-123?",
  "tags": ["ticket:abc-123"],
  "tags_match": "any_strict",
  "budget": "mid",
  "max_tokens": 3000,
  "types": ["world", "experience"],
}
```

If the ticket is repo-scoped, prefer `all_strict` with `scope:repo`, `repo:<base>`, and `ticket:<key>`.

### Incident or session

```jsonc
{
  "query": "What happened during the May 2026 <system-or-topic> incident, and what follow-ups remained?",
  "tags": ["kind:episodic", "system:<name>"],
  "tags_match": "all_strict",
  "budget": "high",
  "max_tokens": 5000,
  "types": ["experience"],
}
```

Use `query_timestamp` only when the active schema documents the expected format and the query depends on relative time.

## Sparse or noisy recall

If recall is sparse:

1. Retry with exact names, IDs, and synonyms in the query.
2. Broaden `all_strict` to `any_strict`.
3. Remove one meaning tag but keep scope tags when possible.
4. Increase `budget` before greatly increasing `max_tokens`.
5. Try global recall if repo recall was too narrow.

If recall is noisy:

1. Add `scope:repo` or `scope:global`.
2. Add `repo:<base>`, `tool:<name>`, `ticket:<key>`, or `system:<name>`.
3. Switch from `any_strict` to `all_strict`.
4. Lower `max_tokens`.
5. Ask a more specific query with stable IDs and proper nouns.

Do not conclude a fact is false just because recall misses it; conclude only that memory did not retrieve it.

## Reflect pattern

Use reflect for synthesis, not first-pass evidence:

```jsonc
{
  "name": "hindsight.reflect",
  "arguments": {
    "query": "Synthesize the recurring gotchas and conventions for working in repo <repo>. Ground the answer in remembered facts and note uncertainty.",
    "tags": ["scope:repo", "repo:<base>"],
    "tags_match": "all_strict",
  },
}
```

Do not create or update directives or mental models unless explicitly requested.

## Pre-recall checklist

1. Is this repo-scoped, global, or both?
2. Which filter tags enforce that boundary?
3. Which meaning tags identify the tool, ticket, system, preference, or topic?
4. Is `all_strict` appropriate, or should discovery start with `any_strict`?
5. What token budget is enough?
6. Is raw recall enough, or is reflect genuinely needed?
