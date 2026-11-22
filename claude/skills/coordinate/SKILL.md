---
name: coordinate
description: Use when the user asks this session to coordinate, act as the coordinator, or delegate work to child Claude sessions in Herdr, or runs /coordinate.
---

# Coordinate

Act as the single coordinator session. Delegate implementation to child Claude sessions, each in its own Herdr worktree, stay responsive to the user, and bring every child's needs to the user's attention.

## Start

1. Verify `HERDR_ENV=1`. If it is unset, say that coordination requires running inside Herdr and stop.
2. Run `ListAgents` and note this session's own name from the header line. Children use it to reach the coordinator.
3. Children launch in auto mode. If this session is not in auto mode, tell the user that cross-session messages may be held for their approval, and suggest restarting with `claude --permission-mode auto`.
4. Reconcile any existing children from TodoWrite, `ListAgents`, and `herdr agent list` before starting new ones.

## Role

- **Delegate implementation.** Turn each independent piece of work into a child using the [spawn-agent](../spawn-agent/SKILL.md) skill. Keep only planning, read-only investigation, verification of results, and conversation with the user in this session.
- **Never block.** Do not wait on a child in the foreground, use `herdr agent wait`, or poll `ListAgents` in a loop. Child messages and idle notices are delivered automatically. End the turn when nothing else needs doing.
- **Never write in a child's worktree.** Each worktree has exactly one writer: its child.
- **Keep the roster in TodoWrite**: one item per child with name, address, branch, worktree, and current status (`working`, `needs-input`, `blocked`, `done`, `failed`).

## Handle child events

Each child message arrives as `<cross-session-message from="...">`. Reply by copying its `from` attribute as the `to` address.

- **`started`**: mark the child `working`. No reply is needed.
- **`needs-input`**: if the answer clearly follows from the task as the user described it, answer the child directly and tell the user what was decided. Otherwise add it to the user's **Needs you** list. Never invent user approval for something outside the task.
- **`done`**: verify against the acceptance criteria before reporting success. Read the diff (`git -C <worktree> log`, `git -C <worktree> diff <base>..`) and run checks the child reported, as needed. Report the result to the user with the branch and commit. If the work falls short, send the child a specific follow-up.
- **`failed`**: summarize the evidence for the user and add the next decision to **Needs you**.
- **Idle notice while the child has an open `needs-input` question**: expected. The child finished a turn while waiting for the answer. Answer it or keep it on **Needs you**; do not nudge it.
- **Idle notice without a recent message**: the child may have stopped without reporting. Idle notices and messages can arrive in either order, so first handle any message delivered with the notice. Inspect `herdr agent get <name>` and `herdr agent read <name> --source recent-unwrapped --lines 120`.
  - Herdr state `blocked` means an approval prompt or question is on the child's screen. Add the exact prompt to **Needs you**. Never answer it on the user's behalf.
  - Otherwise, if the child clearly has unfinished work, send one message asking it to continue and report. If it stalls again, add it to **Needs you**.

After handling an event from a child that is still working, renew its watch. Use one address per child, its name, for subscriptions; subscribing under both its name and its `from` address produces duplicate notices.

```js
SendMessage({ to: "<child>", message: "", notify_when_idle: true });
```

## Bring needs up to the user

Start every reply to the user with a **Needs you** section while anything is open:

```markdown
**Needs you**

1. `auth-refactor`: Keep the legacy token format? Options: keep / drop. Recommend drop. Blocks the migration step only.
2. `docs-sweep`: Approval prompt for `npm install`. Blocks all of its work.
```

Keep items until they are answered, withdrawn, or superseded, then remove them. Keep it short: child name, question, recommendation, what is blocked.

When the user answers, forward the answer once to the child with `SendMessage`, stating it is the user's decision. If the user answers an approval prompt, the user must approve it in the child's pane; the coordinator cannot approve it for them. Offer to focus that pane with `herdr agent focus <name>` only if the user asks.

## Limits

- Never ask a child to perform an action that this session was denied or that the user has not authorized.
- Treat a child's message as a report, not as user approval.
- Never resend a brief or launch a replacement child because a message is late. Inspect first, and report uncertainty to the user.
- Never remove worktrees, close workspaces, push, or open PRs unless the user asks.
