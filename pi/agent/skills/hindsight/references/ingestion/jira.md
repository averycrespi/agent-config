# Jira Ingestion

Use for Jira tickets, ticket comments, decision-bearing facets, and ticket-linked requirements.

## Fetch

Use the available Jira/Atlassian MCP broker tool when present. If no authenticated broker tool is available, ask the user for the ticket content or URL content rather than guessing.

## Document IDs

Prefer Jira-specific IDs over generic `ticket:` IDs:

| Artifact              | Shape                             | Example                                 |
| --------------------- | --------------------------------- | --------------------------------------- |
| Ticket                | `jira:<key>`                      | `jira:abc-123`                          |
| Ticket comment        | `jira:<key>:comment:<comment-id>` | `jira:abc-123:comment:10042`            |
| Ticket decision/facet | `jira:<key>:<facet>:<slug>`       | `jira:abc-123:constraint:archived-rows` |
| Ticket snapshot       | `jira:<key>@<date>`               | `jira:abc-123@2026-05-29`               |

Use the plain ticket ID for refreshable ticket state. Use dated snapshots only when preserving point-in-time history is intentional.

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: `source:external`, `origin:jira`, and usually `kind:semantic`. Use `kind:episodic` for incident history or status chronology. Set `scope:repo` only when the ticket describes the current repo; otherwise use `scope:global`.

Add meaning tags: `ticket:<key>`, `topic:<area>`, `system:<name>` when the ticket names a subsystem, and `team:<name>` only when useful and public/safe for this repo.

## Context

Use context that focuses extraction on durable engineering facts:

```text
Jira ticket ABC-123 for repo <repo>. Extract durable requirements, acceptance criteria, constraints, decisions, dependencies, and unresolved risks. Ignore status chatter, assignment changes, sprint logistics, and duplicate comments.
```

For incident tickets:

```text
Jira incident ABC-123. Extract what happened, affected systems, root cause, mitigation, follow-up actions, and dates. Ignore notification noise and repeated status updates.
```

## Content shaping

Retain:

- Key, summary, and canonical link if safe.
- Description.
- Acceptance criteria.
- Decision-bearing comments.
- Final resolution or implementation notes.
- Relevant dates for temporal recall.

Strip:

- Watcher/assignee churn.
- Sprint moves and priority changes unless they explain a decision.
- Bot comments and repeated automation.
- Internal URLs or names that should not be retained in a public/shared memory.

## Split guidance

Default to one document per ticket. Split into facet documents only when the ticket contains independent facts future agents would recall separately, such as a reusable architectural constraint, rollout rule, or incident lesson.
