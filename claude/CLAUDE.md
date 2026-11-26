# Global instructions

## Git

- Prefix new branches with `avery/`: `avery/<description>` or `avery/<ticket>-<description>`.
- Commit messages use imperative conventional commits, under 50 characters, with no trailing period, and explain why.
- Stage files by name. Never commit secrets or unrelated work.
- Push, open PRs, merge, rewrite history, or run destructive Git commands only with explicit authorization.
- Use native `git` for clone, fetch, pull and push. Use the `gh` CLI for GitHub API operations such as pull requests and CI status.

## Herdr and worktrees

- Load the `herdr` skill for Herdr control and for any Git worktree management. Use `herdr worktree`, not bare `git worktree`.
- To delegate work to other Claude sessions, use the `coordinate` and `spawn-agent` skills. Each child gets its own worktree; never write in another session's worktree.
