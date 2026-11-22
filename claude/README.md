# Claude Code configuration

[Back to the repository overview](../README.md).

GNU Stow links this directory's contents into `~/.claude/`. It supplies global instructions and skills for a coordinator workflow in [Herdr](https://herdr.dev/). Install Claude Code separately. Credentials and machine-specific settings are not supplied; put those in `~/.claude/settings.local.json`.

## Contents

| Path                                                     | Purpose                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                   | Global instructions: Git conventions and where Herdr and delegation guidance lives                                                                |
| [skills/herdr](skills/herdr/SKILL.md)                    | Control Herdr panes, tabs, workspaces, agents, and Git worktrees (adapted from upstream)                                                          |
| [skills/coordinate](skills/coordinate/SKILL.md)          | Run this session as the coordinator: delegate, stay unblocked, surface child needs                                                                |
| [skills/spawn-agent](skills/spawn-agent/SKILL.md)        | Start a child Claude session in a new Herdr worktree with a written brief                                                                         |
| [settings.json](settings.json)                           | Shared settings: registers the Herdr session hook and the status line                                                                             |
| [scripts/statusline.sh](scripts/statusline.sh)           | Status line: working dir, git branch with `+` staged, `!` modified, `?` untracked, `↑`/`↓` ahead/behind, and session (five-hour) and weekly usage |
| [hooks/herdr-agent-state.sh](hooks/herdr-agent-state.sh) | Herdr's generated Claude integration hook, committed unchanged ([attribution](hooks/ATTRIBUTION))                                                 |

## Install

Inspect `~/.claude/` and reconcile any existing `CLAUDE.md`, `settings.json`, `hooks`, or `skills` entries before linking; Stow refuses to replace files it does not own.

`stow-claude` uses `--no-folding`, so `~/.claude/skills/` and `~/.claude/hooks/` stay real directories that hold one link per file. Claude Code writes runtime data such as `skills/synced/` there, and that data must not land in the repository.

```sh
make stow-claude          # link claude/ into ~/.claude/
herdr integration status  # expect "claude: current"
```

This repository provides what `herdr integration install claude` would write: the hook script in `hooks/` and its `SessionStart` registration in `settings.json`, using a `$HOME`-relative path. Do not run `herdr integration install claude` afterwards. It would write through the symlinks, overwrite the committed hook, and add a second registration with an absolute path. To update the hook after a Herdr upgrade, run the install command with `HOME` set to an empty scratch directory, copy the generated `hooks/herdr-agent-state.sh` over the committed one, and update the version in [hooks/ATTRIBUTION](hooks/ATTRIBUTION).

## Coordinator workflow

Start one Claude session inside Herdr in auto mode and run `/coordinate`:

```sh
claude --permission-mode auto
```

The coordinator turns tasks into children with `spawn-agent`. Each child gets:

- its own `avery/<description>` branch and worktree under `~/worktrees/<repo>/<branch>`, opened as a Herdr workspace without taking focus;
- a brief in the worktree's private Git directory, so it is never committed;
- auto mode, matching the coordinator. Cross-session messages between sessions in different permission modes may be held for approval.

Claude Code asks you to trust each new folder, and trusting `~/worktrees` does not cover the worktrees inside it. `spawn-agent` therefore accepts the trust dialog for each worktree it has just created, after checking that the dialog names that path. It never pre-trusts folders by editing `~/.claude.json`.

After launch, all conversation uses Claude Code's `SendMessage`. Children report `started`, `needs-input`, `done`, or `failed`. The coordinator subscribes to each child's idle notice to catch silent stops, and uses Herdr only to inspect a quiet child, for example one waiting at an approval prompt.

The coordinator never waits in the foreground. It answers questions that fall clearly within a task, verifies finished work against acceptance criteria, and starts each reply with a **Needs you** list of open questions and approvals. Finished work keeps its worktree until you ask for removal.
