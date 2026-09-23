# Shared exact-base launch

Use this procedure from [spin-out](../SKILL.md), [coordinate-repo](../../coordinate-repo/SKILL.md), or [work-stack](../../work-stack/SKILL.md). The active workflow owns delegation authority and observation policy; this reference grants none. Resolve it from the conversation and retained agreement/index before creation: calling spin-out within active coordinate-repo or work-stack does not select standalone mode, even for one worker. Standalone mode needs no coordinator/index and leaves question UI unchanged. Managed mode requires the assignment/parent reference and [decision contract](decisions.md). Never infer delegation from task size or potential parallelism.

## Preflight

Require scoped delegation authority covering the assignment, local branch/worktree, Herdr workspace, handoff and Pi process. A covering allowance needs no per-launch approval. Distinguish child execution/commit/publication authority from launch authority. Do not focus or remove resources without authority. Managed parents record consequential intent before each creation/start/submission and confirm its exact identity afterward; unresolved effects remain unresolved, never replayed. Use the [canonical index helper and persistence gate](../../coordinate-repo/references/index.md#confirm-before-effects): validate the response identity/path/base/digest and read back the complete intended state before each effect. Exit zero or a shell `&&` chain is not confirmation. Missing/malformed output blocks the effect pending reconciliation, never automatic write replay.

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

For handoffs authorized through publication/green CI, retain the user's completion criteria and identify the sole implementation/publication/CI-fix owner. Include a finite task-level monitoring policy: absolute deadline from first post-publication check, cumulative wake attempts (including uncertain handoffs), and separate diagnosed code-repair allowance. Reuse existing ticket checkpoints or this handoff, not a second ledger; carry consumed amounts, reservations, expected head and exact observer IDs across replacements/resumption. Follow [delivery reconciliation](../../work-ticket/references/publication.md#reconcile-attention): observer termination is not task termination. Pending CI with retained authority/allowance continues bounded observation after receipt and fresh-state reconciliation; failures enter diagnosis, while exhausted allowances, unresolved uncertain effects or genuine external blockers require precise reporting. Agent-authored continuation messages cannot silently narrow the user's criteria, reset budgets or authorize replay.

Read the completed file once before starting Pi. Confirm that it describes the delegated task rather than the current session generally, contains testable acceptance criteria, and does not depend on uncommitted source state unavailable in the target.

## Start and prompt Pi

Derive a useful unique agent name from the branch slug. It must match `[a-z][a-z0-9_-]{0,31}`. Inspect `herdr agent list`, truncate before adding a numeric suffix when needed, and never replace an existing agent.

Standalone spin-outs leave ordinary interactive questions unchanged. Managed children use the same startup command and the [explicit mailbox reporting contract](decisions.md#child-only-launch). Include mailbox address, assignment ID/revision, exact parent identity/index, child checkpoint path and resolved readable workflow references in the handoff. Require checkpoint-before-report for meaningful questions, blockers and results; routine progress stays in the checkpoint. Require the child to read the shared protocol; do not copy parent counters or change environment-based routing.

Start Pi in the returned root pane:

```bash
herdr agent start <agent-name> --kind pi --pane <root-pane-id>
```

After Herdr reports that Pi is ready, follow Herdr's [asynchronous launch handshake](../../herdr/SKILL.md#confirm-asynchronous-launch): capture the pre-submission identity/state baseline, then submit a short prompt once through the agent surface without `--wait`. For managed children, correlate the session UUID with the verified Herdr occupant/process identity and retain it as the worker incarnation. Confirm mailbox availability and bounded mailbox observation before submission under the retained allowance. Initial durable list plus polling catches reports before and during registration; notification loss never discards messages. Failed registration retains the unprompted child; never launch a substitute.

```text
Read `.handoffs/<filename>.md` completely before taking any action. Treat it as the task brief. Then inspect the worktree and its AGENTS.md instructions, execute the objective, and verify the acceptance criteria. Investigate answerable uncertainty and use reasonable, reversible defaults within scope. Stop and ask when unresolved ambiguity or conflicting repository state materially affects scope, authorization, correctness, identity, or required source state; do not proceed with required source changes unavailable in this checkout.
```

Keep the prompt path-based; do not duplicate the handoff body into it. Use the unique handoff path to correlate the handshake's bounded start-of-work check with this task. Confirm execution from the submitted prompt and fresh work activity, or the child reading/acting on this handoff, before reporting a successful launch. Sending without `--wait` keeps task execution asynchronous; it does not waive launch verification or require waiting for task completion.

## Managed launch completion gate

For managed launches, require all four pieces of evidence in the existing coordinator index before marking the launch step complete:

1. Persist the current assignment/revision and reporting contract: explicit mailbox, parent/index, child checkpoint and readable handoff references, with before-effect persistence confirmation/readback.
2. Persist the exact worker session/incarnation and verified Herdr occupant/process identity after startup, before submission; make that identity available to the child through the handoff or its explicit parent-index reference.
3. Retain an attached host receipt for matching bounded observation covering that assignment and exact worker **before the task prompt**, within the original deadline, consumed attempts and uncertain reservations. Registration intent, provider availability or a child's CI watcher is not parent coverage; reuse an active matching observer rather than duplicating it.
4. Persist task-correlated execution confirmation from the shared handshake, not readiness, startup or prompt submission alone.

The coordinator's delivery TODO remains open until the assigned completion boundary is evidenced and accepted under the active workflow. Launch completion is only an intermediate milestone, never delivery or permission to abandon supervision. End the turn with attached bounded observation while work is pending; do not model-turn poll or mirror worker CI.

If the contract or observation is missing, retain unprompted resources and report blocked/uncertain launch with the missing evidence and next actor; no replay or restart. If submission may already have occurred, retain its uncertainty and reconcile the existing worker instead of calling it unprompted or sending again. Missing execution confirmation likewise retains the original submission and owner. Preserve authority and before-effect/readback gates during reconciliation; do not invent coverage or replenish allowances.

## Failure and finish behavior

If worktree creation fails, stop without writing a handoff or starting Pi. If a later step fails, leave the created worktree and workspace intact, do not attempt destructive rollback, and report the completed resources plus the exact failed step. If prompting fails, blocks, or remains unconfirmed at the handshake bound, report the agent name, pane, submission status, evidence and next action. Do not treat a timeout as non-delivery or resend an uncertain prompt; follow the handshake's reconciliation rules and any stricter workflow no-retry boundary.

On launch success (subject to the managed gate above), report:

- target branch and exact base commit
- worktree path
- Herdr workspace and pane IDs
- Pi agent name
- repo-relative handoff path
- confirmation that the handoff is ignored
- launch status and task-correlated evidence of execution; do not infer acceptance from `agent_prompted`, readiness, or `idle`/`done` alone

Keep the original workspace focused unless the user explicitly requested otherwise.
