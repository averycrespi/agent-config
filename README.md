# Agent Config

[![CI](https://github.com/averycrespi/agent-config/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/averycrespi/agent-config/actions/workflows/ci.yml)

My personal configuration for the [Pi](https://pi.dev/) and [Claude Code](https://claude.com/claude-code) coding agents: shared instructions, skills, tools and automation for direct coding help, asynchronous research and review, and explicitly delegated implementation.

This is not a standalone agent. **Install each agent separately.** [GNU Stow](https://www.gnu.org/software/stow/) links this repository's resources into each agent's configuration directory; personal settings, model-provider selections and credentials are **not supplied**.

## What's included

| Agent       | Source                        | Installs into  | What it provides                                                                                                                                                                              |
| ----------- | ----------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi          | [`pi/`](pi/README.md)         | `~/.pi/agent/` | Agent instructions, activity skills, TypeScript tools and terminal UI extensions, background subagents and workflows, reusable Scripts, prompt templates and themes                           |
| Claude Code | [`claude/`](claude/README.md) | `~/.claude/`   | Global instructions, a status line, and skills for one coordinator session that delegates work to child Claude sessions, each in its own Herdr worktree, and passes their questions up to you |

Each directory's README is the reference for its components, configuration and workflows; detailed contracts live beside the relevant skill or extension.

## Quick start

### Requirements

- [Pi](https://pi.dev/) and/or [Claude Code](https://claude.com/claude-code), installed separately with a configured model provider
- [Node.js](https://nodejs.org/) 24+, ideally the [CI-pinned version](.tool-versions)
- [Homebrew](https://brew.sh/) for the macOS setup below; Linux needs equivalent system dependencies, including GNU Stow

### Setup

Inspect the existing target directory and reconcile conflicts before linking; do not overwrite an existing configuration blindly.

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle       # install system dependencies on macOS
make install-dev  # install Node dependencies and Husky Git hooks
make stow-pi      # symlink pi/agent/ into ~/.pi/agent/
make stow-claude  # symlink claude/ into ~/.claude/
```

Then follow the agent-specific setup in [Pi setup](pi/README.md#setup) or [Claude Code install](claude/README.md#install), including local settings and the optional integrations: [Herdr](https://herdr.dev/) for terminal and worktree control, an MCP gateway for authenticated services, and browser tooling.

## Developing this repository

Development is optional; using the configured agents does not require it. Edit Stow-managed resources at their source under `pi/` or `claude/`, not through installed symlinks. See [repository guidance](AGENTS.md) and the repo-local [extension authoring skill](.pi/skills/create-extension/SKILL.md) for required checks and conventions.

```sh
npm run lint         # lint extensions, saved workflows and saved Scripts
npm run format:check # check formatting
make typecheck       # check TypeScript
make test            # run repository tests
```

GitHub Actions runs these checks for pull requests and pushes to `main`.

## License

- Repository licensed under [MIT](LICENSE)
- Individual components may have their own licenses
