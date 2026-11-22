---
name: spawn-agent
description: Use when coordinating and a task should go to a new child Claude session, or when the user asks to spawn, spin out, or delegate work to another Claude session in its own Herdr worktree.
---

# Spawn agent

Start a child Claude session in its own Herdr worktree, hand it a written brief, and connect it to the coordinator through `SendMessage`. Herdr owns the worktree, workspace, and process; `SendMessage` carries all conversation after launch.

Load the [herdr](../herdr/SKILL.md) skill first and verify `HERDR_ENV=1`. Run `herdr worktree` and `herdr agent start --help` to confirm the installed syntax before using the commands below.

## 1. Settle the assignment

Before launching, resolve:

- **Task and acceptance criteria**: concrete enough for the child to verify on its own.
- **Name**: unique, lowercase, matching `[a-z][a-z0-9_-]{0,31}`, for example `auth-refactor`. Check `herdr agent list` and `ListAgents` for collisions.
- **Branch**: a new `avery/<description>` branch.
- **Base**: the commit to start from. Default to the repository's current `HEAD` commit SHA; uncommitted changes in the coordinator's checkout do not carry over. For dependent work, use the predecessor child's verified commit.
- **Limits**: what the child may not do without asking. Default: no push, PR, merge, or worktree removal.

Ask the user only when the task or acceptance criteria are materially ambiguous.

## 2. Create the worktree

Follow the herdr skill's worktree procedure, including its path normalization (`$HOME/worktrees/<repo-slug>/<branch-slug>`) and collision checks:

```bash
herdr worktree create --cwd <repo-root> --branch avery/<description> --base <sha> \
  --path "$HOME/worktrees/<repo-slug>/<branch-slug>" --label <name> --no-focus
```

Read the new workspace ID and root pane ID from the JSON response. Verify with `git -C <worktree> status -sb`.

## 3. Write the brief

Write the brief to the worktree's private Git directory, so it is never committed and is removed with the worktree:

```bash
brief="$(git -C <worktree> rev-parse --absolute-git-dir)/claude-brief.md"
```

Do not overwrite an existing brief. Use [references/brief.md](references/brief.md) as the template. Fill in the coordinator's address from the header line of its own `ListAgents` output ("This session is `<name> [<ref>]`"); use the bare name.

## 4. Launch the child

Start Claude in the worktree's root pane in auto mode, with a short first prompt pointing at the brief:

```bash
herdr agent start <name> --kind claude --pane <root-pane-id> -- \
  --permission-mode auto --name <name> "Read your assignment at <brief-path> and follow it."
```

Launch children in auto mode, like the coordinator. Cross-session messages between sessions in different permission modes may be held for the user's approval.

### Accept the folder trust dialog

Claude Code asks whether to trust every new folder, and trusting `~/worktrees` does not cover the worktrees inside it. So every launch stops at the trust dialog, and `agent start` fails with `agent_not_ready` ("blocked during startup"). That failure is expected; the child is still in its pane.

The user has authorized trusting worktrees that this workflow creates. Accept the dialog only after confirming it names the worktree just created:

```bash
herdr pane read <root-pane-id> --source visible   # must show "Accessing workspace:" and <worktree-path>
herdr pane send-keys <root-pane-id> down          # select "Yes, I trust this folder"
herdr pane read <root-pane-id> --source visible   # confirm the selection before pressing Enter
herdr pane send-keys <root-pane-id> enter
```

Never accept a trust dialog for any other path, or any other kind of prompt, this way. Do not edit `~/.claude.json` to pre-trust folders.

After accepting, the child starts on its first prompt. Herdr may report `blocked` for a short while after this; read the pane instead of trusting that label.

## 5. Confirm and watch

`--name <name>` makes the child appear as `<name>` in `ListAgents`, so it can be addressed by name right away. The brief also asks the child to send a short "started" message, which confirms it read the brief. Reply to later messages using their `from` attribute.

Right after launch, subscribe to the child's next idle notice so a silent stop is caught:

```js
SendMessage({ to: "<name>", message: "", notify_when_idle: true });
```

If `<name>` does not resolve yet, run `ListAgents` and match the child by its worktree path. If the child is not listed, check `herdr agent get <name>` and `herdr agent read <name> --source recent-unwrapped` before deciding anything. Do not resend the brief or start a second child for the same task. Report the launch as uncertain instead.

Record the child in TodoWrite: name, address, branch, worktree path, workspace ID, and current status.

## Cleanup

Never remove worktrees or close workspaces because a task finished. Remove them only when the user asks, using the herdr skill's removal procedure.
