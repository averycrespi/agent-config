# CLAUDE.md

## Conventional Commits

Use conventional commits: `<type>(<optional scope>): <description>`. Types: feat, fix, chore, docs, refactor, test. Imperative mood, under 50 chars, no trailing period. Breaking changes: `feat!: ...`

## Asking Questions

- **Decisions (2-4 options):** Use `AskUserQuestion` with recommendation labeled "(Recommended)"
- **Open-ended/yes-no:** Ask in plain text
- One question per message. Don't ask what you can figure out from files or git history.

## Pull Request Descriptions

Title under 70 chars: `TICKET-123: description` or conventional commit format. Body sections: Context (why), Changes (by concept, not file), Review Notes (if non-obvious), Test Plan (checklist). Explain _why_ not _how_. Be specific, not vague.

## Git Branching

Only create a new branch when currently on the default branch (`main`/`master`). If already on a non-default branch, keep working on it — never branch off an existing feature branch for the same work.

## Git Worktree Rules

In a worktree, **all git operations target the worktree, never the main repo**. Use `git -C <worktree-path>` if needed — never point it at the main repo. Do not `cd` to the main repo to run git. Verify with `git rev-parse --show-toplevel`.

## Git and GitHub Operations

Prefer MCP broker tools over shell `git` remote subcommands and the `gh` CLI:

- **Git remote ops** (fetch, pull, push, list remotes/refs): use `mcp__mcp-broker__git_*` tools instead of `git fetch/pull/push`.
- **GitHub ops** (PRs, issues, reviews, runs, releases, search): use `mcp__mcp-broker__github_gh_*` tools instead of the `gh` CLI.

Local-only git commands (`status`, `diff`, `log`, `add`, `commit`, `branch`, `rev-parse`, etc.) still go through the shell `git` command.

## Sorting

When sorting items alphabetically or numerically, always use `sort` (or equivalent shell command) — never sort by hand or from memory.

## MCP Usage

**Delegate to a subagent** any MCP call that returns verbose output: searches, multi-step lookups (2+ calls). The subagent should return a concise summary, not raw output.
