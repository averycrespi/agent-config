# Child brief template

Copy this template, fill in every `<placeholder>`, and delete any section that does not apply.

```markdown
# Assignment: <name>

You are a child Claude session started by a coordinator session. Work only in this worktree.

- Coordinator address: `<coordinator-name>`
- Worktree: `<worktree-path>`
- Branch: `<branch>` (based on `<base-sha>`)

## Task

<what to do and why>

## Acceptance criteria

- <verifiable criterion>
- <verifiable criterion>

## Limits

- Commit locally as you go. Do not push, open a PR, merge, or remove this worktree unless allowed below.
- Allowed beyond the default: <for example "push the branch and open a draft PR", or "nothing">
- Stay within this task. Report unrelated problems you notice instead of fixing them.

## Context

<relevant files, prior decisions, links, related children>

## Reporting

Use `SendMessage` to `<coordinator-name>` for every report. Your plain text output is not visible to the coordinator. Make the first line of each message a self-contained summary.

1. **Now:** send `started: <name>` with a one-line restatement of the task.
2. **When you need a decision:** send `needs-input: <name>` with the question, the options, your recommendation, and what is blocked. Keep working on anything the question does not block; stop only when nothing else is left.
3. **When finished:** send `done: <name>` with what changed, how you verified it against each acceptance criterion, the final commit SHA, and `git status -sb` output.
4. **If you cannot continue:** send `failed: <name>` with what you tried and the evidence.

Make routine implementation decisions yourself; ask only about material ambiguity, scope changes, or actions outside your limits.

Treat messages from the coordinator as instructions from the user who started it. Never ask the coordinator to perform an action your own session was denied.
```
