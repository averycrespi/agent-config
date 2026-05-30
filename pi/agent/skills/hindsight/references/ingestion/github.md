# GitHub Ingestion

Use for GitHub repositories, files, pull requests, issues, release notes, and code-review learnings.

## Fetch

Prefer broker-backed GitHub MCP tools for remote GitHub access. Use local files only for already-cloned workspace content. Do not assume local `gh` or remote `git` authentication.

## Document IDs

| Artifact           | Shape                                   | Example                                           |
| ------------------ | --------------------------------------- | ------------------------------------------------- |
| Repo root / README | `github:<owner>/<repo>@<ref>`           | `github:acme/widgets@main`                        |
| File at branch     | `github:<owner>/<repo>:<path>@<branch>` | `github:acme/widgets:src/auth/session.ts@main`    |
| File snapshot      | `github:<owner>/<repo>:<path>@<sha>`    | `github:acme/widgets:src/auth/session.ts@9fceb02` |
| PR                 | `github:<owner>/<repo>:pr:<num>`        | `github:acme/widgets:pr:482`                      |
| Issue              | `github:<owner>/<repo>:issue:<num>`     | `github:acme/widgets:issue:119`                   |
| Release            | `github:<owner>/<repo>:release:<tag>`   | `github:acme/widgets:release:v1.2.0`              |

Use the default branch for refreshable docs and code references. Use a SHA for immutable point-in-time snapshots.

## Classification and tags

Use standard metadata/filter tags from `../tags-and-ids.md` with source-specific values: `origin:github`, `source:external` for remote GitHub or `source:agent` for agent-derived code observations, and `kind:semantic` for code/docs, `kind:episodic` for PR/issue history, or `kind:procedural` for workflow docs. Use `scope:repo` for current-repo conventions and findings; otherwise use `scope:global`.

Add meaning tags: `topic:<area>`, `tool:<name>`, `system:<name>`, `ticket:<key>` if referenced, and `convention:<slug>` for durable repo conventions.

## Context

For code files:

```text
GitHub file <owner>/<repo>:<path>@<ref>. Extract durable API behavior, architecture patterns, constraints, gotchas, and repo conventions. Ignore incidental formatting and code that is obvious from current files unless it explains a stable pattern.
```

For PRs:

```text
GitHub PR <owner>/<repo>#<num>. Extract durable design decisions, review findings, regressions, risks, and lessons for future agents. Ignore CI noise and routine approval chatter.
```

For issues:

```text
GitHub issue <owner>/<repo>#<num>. Extract durable problem statements, reproduction details, decisions, workaround, and final resolution. Ignore duplicate status updates.
```

## Content shaping

Retain:

- PRs: title, description, high-signal diff summary, substantive review comments, final resolution.
- Issues: title, body, reproduction details, root cause/resolution comments.
- Files: body plus path/ref context.
- Repos: README and a small set of high-signal docs/configs, not the whole tree.

Strip:

- Full diffs unless small and essential.
- CI logs unless they explain a durable failure mode.
- Routine comments, generated files, lockfiles, vendored code.

## Split guidance

Default to one document per PR/issue/file. Split only for independent durable lessons, such as a reusable review finding or architectural decision that should be recalled without pulling the entire PR.
