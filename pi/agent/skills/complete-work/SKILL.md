---
name: complete-work
description: Use when finishing implementation work after verification has passed; cleans up plan artifacts and offers branch or PR next steps.
---

# Complete Work

Finish implementation work cleanly. Optimize for preserving evidence, removing temporary plan artifacts, and presenting a small set of safe next steps.

## Core rule

Do not declare completion from memory. First audit the concrete state: verification result, acceptance criteria evidence, git status, plan artifacts, and branch/PR state.

## Process

### 1. Confirm completion context

Use this skill after implementation has been verified. If the prior verification result is missing or ambiguous:

1. Inspect the known plan file, TODOs, recent command output, and `git status --porcelain=v1`.
2. Map every explicit requirement to concrete evidence from files, command output, tests, or other observable state.
3. If evidence is incomplete, report the missing verification and stop instead of continuing to PR options.

If the work is blocked or still has fixable findings, do not run completion cleanup. Report the blocker and the next required step.

### 2. Clean up plan artifacts

If a plan path is known from context or can be identified unambiguously under `.plans/`:

1. Strip the `.md` extension to get the stem.
2. Remove `.plans/<stem>.md`, whether it is tracked or untracked.
3. If the plan file was tracked, stage that specific deletion. If it was untracked, do not stage anything for it.
4. Commit the cleanup only when the just-finished work is already using checkpoint commits or the user explicitly requested completion commits.

Use local `git` for workspace inspection and local commits. Use `git status --short -- .plans/<stem>.md` to distinguish tracked deletions from untracked files when needed. Do not delete unrelated `.plans/` files. If no plan path is known, skip silently.

### 3. Detect branch and PR state

Use local `git` for branch, status, and summary inputs:

```bash
git branch --show-current
git status --short
git log --oneline --decorate -n 10
git symbolic-ref --short refs/remotes/origin/HEAD
```

Fall back to `origin/main`, then `main`, if the default-branch command fails. Use merge-base semantics for local summaries and PR body inputs: `git diff <default-branch>...HEAD` and `git diff --name-only <default-branch>...HEAD`.

Use MCP broker tools for remote Git and GitHub operations. Prefer the broker tools listed in the system prompt; otherwise use `mcp_search` and `mcp_describe` before calling them. Do not use the `gh` CLI or shell remote `git` commands.

To detect an existing PR, use GitHub broker tools such as `github.list_pull_requests` or `github.search_pull_requests` when available. If the schema requires repository details, derive owner/repo from `git remote -v` and the current branch from `git branch --show-current`. If broker access is unavailable, say remote PR detection is unavailable and present only local-safe options.

### 4. Present exactly two options

Use `ask_user` with exactly two choices and mark the push/create or push/update option as recommended when the branch is clean and verification passed.

If an existing PR is found:

1. **Push and update PR** — push the branch, then regenerate the PR title/body from the branch changes and update the PR.
2. **Keep branch as-is** — leave remote/PR state unchanged.

If no PR is found:

1. **Push and create draft PR** — push the branch and create a draft PR.
2. **Keep branch as-is** — leave remote/PR state unchanged.

If remote broker access is unavailable:

1. **Show local summary** — report branch, commits, changed files, verification evidence, and suggested PR title/body for the user to copy.
2. **Keep branch as-is** — stop after reporting the current branch.

### 5. Execute the selected option

For push/create/update operations:

1. Ensure the working tree is in the expected state. If cleanup edits were made, they should be committed or explicitly left unstaged by user choice.
2. Push through MCP broker `git` tools such as `git.git_push`, not shell remote git.
3. Create draft PRs through `github.create_pull_request` with `draft: true` when available; update existing PRs through `github.update_pull_request`.
4. Draft PR titles and descriptions from all branch changes relative to the base branch. Follow any existing repository PR template and the Pull Request Titles and Descriptions guidance in `AGENTS.md`.

For keep-as-is, report the current branch name and any unpushed/local-only state discovered.

## Common mistakes

- Asking "what next?" instead of presenting two concrete options.
- Treating TODO completion or passing tests alone as sufficient evidence when acceptance criteria were broader.
- Using `gh` or unauthenticated remote `git` commands when MCP broker tools are available.
- Deleting all plan files instead of only the known completed plan file.

## Safety rules

Never force-push, rewrite history, merge a PR, close a PR, or delete branches unless the user explicitly asks. Never delete unrelated artifacts.
