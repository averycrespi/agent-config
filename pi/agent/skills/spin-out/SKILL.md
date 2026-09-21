---
name: spin-out
description: Use only when the user explicitly asks to "spin out" work or delegate work to another agent in a new Herdr-managed Git worktree. Do not use merely because delegation might help.
---

# Spin Out

Create a Herdr-managed Git worktree, write a self-contained task handoff inside it, start Pi in its root pane, and prompt the new agent to read the handoff and begin. Activate only for an explicit user request to spin out or delegate work to another agent; an explicit [work-stack](../work-stack/SKILL.md) request delegates its ordered tickets serially. Never infer delegation from task size, complexity, or the potential usefulness of parallel work.

## Preflight

Treat invocation as approval to create the local branch, worktree, Herdr workspace, handoff, and Pi process. Do not commit, push, focus the new workspace, or remove existing resources unless separately requested.

1. Require a concrete task. If the invocation does not provide one and the intended task cannot be inferred safely from the conversation, ask for it before creating anything.
2. Verify `HERDR_ENV=1`. If not, stop because the worktree cannot be managed through the active Herdr session.
3. Require an active Git repository. Resolve its root, current branch, and `HEAD`, then inspect `git status --short --branch`.
4. Inspect `herdr --help` and the installed `herdr worktree`, `herdr pane`, and `herdr agent` command groups before issuing control commands; the installed CLI is authoritative.
5. Run `herdr worktree list --cwd <path-inside-repo>` and read the parent checkout and workspace identifiers from its JSON. Do not guess identifiers or use bare `git worktree` commands.

Use the current `HEAD` as the default base unless the user supplied another ref. Resolve the chosen ref to an immutable commit with `git rev-parse --verify '<ref>^{commit}'`, stop if it does not resolve, and retain that exact SHA for creation, the handoff, and the final report. Uncommitted changes do not transfer to the new worktree. If the delegated task depends on them, stop and ask the user to make the changes reachable from the target worktree; never commit or stash them automatically. If they are unrelated, continue and note that they remain only in the source checkout.

## Choose the branch and path

Honor an explicit branch or base ref. Otherwise derive a short descriptive branch from the task using `avery/<description>`, or `avery/ABC-123-<description>` when a ticket is known. The branch must be new; do not reuse, reset, or overwrite an existing local or remote-tracking branch. Check `refs/heads/<branch>` and matching `refs/remotes/*/<branch>` with `git show-ref` or `git for-each-ref`. If an agent-derived name collides, choose and verify a fresh variant; ask before changing a conflicting name explicitly requested by the user.

Place the checkout at `$HOME/worktrees/<repo-slug>/<branch-slug>`:

- Derive `<repo-slug>` from the primary repository basename.
- Derive `<branch-slug>` from the full branch name.
- Normalize each by lowercasing, replacing every run of non-ASCII-alphanumeric characters, including `/`, with `-`, and trimming leading or trailing `-`.

Inspect both the filesystem path and the `herdr worktree list` result. For a collision under an agent-derived name, choose another branch variant and verify both its refs and normalized path before creation. For an explicitly requested name or unresolved identity conflict, stop and ask. Never overwrite an occupied path or conflicting worktree.

## Create the worktree

Create and open the worktree as an unfocused Herdr workspace:

```bash
herdr worktree create \
  --cwd <parent-checkout> \
  --branch <new-branch> \
  --base <base-commit-sha> \
  --path <normalized-path> \
  --no-focus
```

Read the new workspace and root-pane identifiers from the command's JSON response. If the root pane is not included directly, use the inspected `herdr pane` commands to list panes in the returned workspace and select its available root shell pane. Confirm through pane inspection that it belongs to the new workspace, is available at a shell prompt, and starts in the worktree path before launching Pi.

## Write the handoff in the target

Write the handoff only after creating the worktree. Because `.handoffs/` is ignored and untracked, a handoff written in the source checkout will not transfer to the target.

Resolve the target worktree's local Git exclude file through Git, then add the root-anchored `/.handoffs/` pattern if absent. Do not modify the tracked `.gitignore`:

```bash
exclude_path="$(git -C "$worktree_path" rev-parse --path-format=absolute --git-path info/exclude)" &&
  mkdir -p "$(dirname "$exclude_path")" &&
  touch "$exclude_path" &&
  { grep -qxF '/.handoffs/' "$exclude_path" ||
    printf '\n/.handoffs/\n' >> "$exclude_path"; }
```

Create a unique target file and verify that Git ignores it:

```bash
mkdir -p "$worktree_path/.handoffs" &&
  handoff_path="$(mktemp "$worktree_path/.handoffs/pi-handoff-XXXXXX.md")" &&
  git -C "$worktree_path" check-ignore -q "$handoff_path" &&
  printf '%s\n' "$handoff_path"
```

Write the document to the returned absolute path with the `write` tool. Never interpolate the task or handoff contents into a shell command. Do not stage or commit the handoff.

Use this structure, omitting empty sections:

```markdown
# Worktree Handoff

## Objective

## Acceptance criteria

## Starting point

## Decisions and constraints

## Relevant artifacts and evidence

## Suggested next actions

## Verification

## Risks, blockers, and open questions

## Suggested skills
```

Make the handoff self-contained because the new agent cannot see the current conversation. Include the source branch, exact base commit, target branch, and any source-only working-tree caveat under `Starting point`. Prefer repo-relative paths and concise references over copied content. Distinguish observed evidence from assumptions, redact sensitive information, and include exact verification commands only when useful. Suggest only skills expected to be available to the new agent and materially useful for the task.

For implementation handoffs, make required checkout-local dependency setup part of the child's preparation under repository instructions. Fresh worktrees do not inherit installed dependencies. Direct the child to inspect setup commands and lifecycle effects, use declared locked dependencies without unrelated upgrades, and continue the authorized task after setup. Leave repository-specific setup to the child. Distinguish this from installing the delivered software/configuration, global/system installation, or changing running sessions; do not invent a blanket "do not install" restriction. Preserve any actual user restriction and report a concrete conflict if it prevents required setup.

For handoffs authorized through publication/green CI, retain the user's completion criteria and identify the sole implementation/publication/CI-fix owner. Include a finite task-level monitoring policy: absolute deadline from first post-publication check, cumulative wake attempts (including uncertain handoffs), and separate diagnosed code-repair allowance. Reuse existing ticket checkpoints or this handoff, not a second ledger; carry consumed amounts, reservations, expected head and exact observer IDs across replacements/resumption. Follow [delivery reconciliation](../work-ticket/references/publication.md#reconcile-attention): observer termination is not task termination. Pending CI with retained authority/allowance continues bounded observation after receipt and fresh-state reconciliation; failures enter diagnosis, while exhausted allowances, unresolved uncertain effects or genuine external blockers require precise reporting. Agent-authored continuation messages cannot silently narrow the user's criteria, reset budgets or authorize replay.

Read the completed file once before starting Pi. Confirm that it describes the delegated task rather than the current session generally, contains testable acceptance criteria, and does not depend on uncommitted source state unavailable in the target.

## Start and prompt Pi

Derive a useful unique agent name from the branch slug. It must match `[a-z][a-z0-9_-]{0,31}`. Inspect `herdr agent list`, truncate before adding a numeric suffix when needed, and never replace an existing agent.

Standalone spin-outs leave ask-user mode unchanged. For work-stack children only, follow its [child-only parent-managed launch](../work-stack/references/decisions.md#child-only-launch) instead of the default startup command below; include that decision escalation contract in the initial handoff. Do not change the parent/global environment.

Start Pi in the returned root pane:

```bash
herdr agent start <agent-name> --kind pi --pane <root-pane-id>
```

After Herdr reports that Pi is ready, follow Herdr's [asynchronous launch handshake](../herdr/SKILL.md#confirm-asynchronous-launch): capture the pre-submission identity/state baseline, then submit a short prompt once through the agent surface without `--wait`. For work-stack children, preserve its required attention registration before submission.

```text
Read `.handoffs/<filename>.md` completely before taking any action. Treat it as the task brief. Then inspect the worktree and its AGENTS.md instructions, execute the objective, and verify the acceptance criteria. Investigate answerable uncertainty and use reasonable, reversible defaults within scope. Stop and ask when unresolved ambiguity or conflicting repository state materially affects scope, authorization, correctness, identity, or required source state; do not proceed with required source changes unavailable in this checkout.
```

Keep the prompt path-based; do not duplicate the handoff body into it. Use the unique handoff path to correlate the handshake's bounded start-of-work check with this task. Confirm execution from the submitted prompt and fresh work activity, or the child reading/acting on this handoff, before reporting a successful launch. Sending without `--wait` keeps task execution asynchronous; it does not waive launch verification or require waiting for task completion.

## Failure and finish behavior

If worktree creation fails, stop without writing a handoff or starting Pi. If a later step fails, leave the created worktree and workspace intact, do not attempt destructive rollback, and report the completed resources plus the exact failed step. If prompting fails, blocks, or remains unconfirmed at the handshake bound, report the agent name, pane, submission status, evidence and next action. Do not treat a timeout as non-delivery or resend an uncertain prompt; follow the handshake's reconciliation rules and any stricter workflow no-retry boundary.

On success, report:

- target branch and exact base commit
- worktree path
- Herdr workspace and pane IDs
- Pi agent name
- repo-relative handoff path
- confirmation that the handoff is ignored
- launch status and task-correlated evidence of execution; do not infer acceptance from `agent_prompted`, readiness, or `idle`/`done` alone

Keep the original workspace focused unless the user explicitly requested otherwise.
