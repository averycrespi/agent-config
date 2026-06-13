# Agent Config

My configuration for working with AI coding agents — currently [Claude Code](https://www.anthropic.com/claude-code) and [Pi](https://pi.dev/). Pairs well with my [agent-tools](https://github.com/averycrespi/agent-tools).

This repo is opinionated. It provides a structured development workflow, security-first hooks, and reusable skills that turn a general-purpose coding agent into a reliable development partner. Use it as-is, fork it, or cherry-pick the parts that fit your setup.

## What's Included

### [Claude Code](claude/README.md) → `~/.claude/`

- **Structured development workflow** — `/brainstorming → /writing-plans → /executing-plans → /verifying-work → /completing-work`, a pipeline of skills (adapted from [superpowers](https://github.com/obra/superpowers)) that turns ideas into pull requests with subagent-isolated implementation and parallel reviewers
- **Reference skills** — TDD discipline, PR review, browser automation (Playwright), Jira ticket creation, frontend design, incident troubleshooting, skill creation, and more
- **Security and quality hooks** — Pre-commit secret scanning with [gitleaks](https://github.com/gitleaks/gitleaks); auto-formatting on every write via Prettier for web/Markdown/config files, plus gofmt, rustfmt, and shfmt
- **Sandbox mode** — Locked-down config for headless or remote environments that hints agents to prefer MCP tools for `gh` and remote git
- **Custom status line** — Powerline-style display showing model, branch, context window usage, and session rate-limit usage

### [Pi](pi/README.md) → `~/.pi/agent/`

- **Workflow-aware agent setup** — Pi-specific `AGENTS.md`, model/settings config, planning/review/completion skills, `/goal` execution steering, and compaction behavior
- **Custom TypeScript extensions** — Subagent dispatch, MCP broker tools, web search/fetch/PDF/GitHub access, TODO tracking with sticky widget, compact tool rendering, startup header, status line, and interactive `ask_user`
- **Reusable skills** — Agent engineering, TDD, PR review, Playwright browser automation, Jira ticket creation, frontend design, and skill creation, adapted for Pi conventions and GPT-5.x prose
- **Delegated subagents** — Definitions for focused exploration, fast research, deep research, and review, loaded dynamically by the `subagents` extension
- **Extension dev harness** — Colocated TypeScript tests, shared extension helpers, and `make typecheck` / `make test` coverage for Pi extension logic

### [Notes](notes/)

Public essays and working notes about agent harness design, permissions, subagents, planning workflows, and related topics.

## Companion: [agent-tools](https://github.com/averycrespi/agent-tools)

`agent-config` configures the agent; [`agent-tools`](https://github.com/averycrespi/agent-tools) provides tools for working with AI agents. Two of its tools are explicit integration points for this repo:

- **MCP broker** — credentials-holding proxy that lets sandboxed agents use external tools without ever holding the secrets themselves. Pairs with the `mcp-broker` Pi extension and Claude's sandbox-mode `gh`/git MCP guidance hooks
- **Sandbox manager (`sb`)** — provisions and manages a Lima-based Linux VM for isolated agent runs. Pairs with the overrides in `claude/sandbox/`

## Quick Start

### Requirements

- [Claude Code](https://github.com/anthropics/claude-code) and/or [Pi agent](https://pi.dev/)
- [Homebrew](https://brew.sh/)
- [Node.js](https://nodejs.org/) 24+
- macOS assumed, adaptable for Linux

### Setup

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle             # install system dependencies on macOS
make install-playwright # for the playwright skill
make stow-claude        # symlink claude/ into ~/.claude/
make stow-claude-sandbox # symlink claude/ and apply sandbox overrides
make stow-pi            # symlink pi/agent/ into ~/.pi/agent/
```

### Development

```sh
make install-dev      # install Pi dev dependencies and Husky git hooks
npm run lint          # lint Pi extension TypeScript files
npm run format:check  # check formatting for TS/JS/JSON/Markdown/YAML files
make typecheck        # type-check Pi extension TypeScript files
make test             # run Pi extension unit tests
```

`npm install` runs Husky's `prepare` script, which installs the repo's pre-commit hook. The hook runs `lint-staged` for staged formatting/lint fixes, then `npm run typecheck`.

## License

- Repository licensed under [MIT](./LICENSE)
- Individual components may have their own licenses
