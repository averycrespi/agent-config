# Agent Config

This is my [Pi](https://pi.dev/) agent configuration for software development. It combines:

- **A Pi-native workflow layer** for planning, executing, reviewing, and completing engineering tasks
- **Custom TypeScript extensions** for TODOs, workflows, goals, scheduled tasks, MCP, web access, and more
- **Reusable skills and saved workflows** for planning, research, review, and more
- **Centrally governed subagents** with explicit composable capabilities, model tiers, and thinking
- **Extension development conventions** with shared helpers, colocated tests, and deterministic checks

This repo pairs well with my [agent-tools](https://github.com/averycrespi/agent-tools), especially the MCP broker for safe external tool access.

## Pi Agent Harness

### Core Workflow

The Pi setup is built around a durable development loop:

- **Clarify scope** with `clarify` when requirements, edge cases, acceptance criteria, or design intent are fuzzy
- **Plan the work** with `plan`, then stress-test substantial plans, proposals, designs, and architecture decisions with `challenge` before implementation
- **Execute deliberately** with session-scoped goals via `goal`, optional fail-closed independent completion review, and in-session task tracking via `todo`
- **Delegate isolated research** with self-contained prompts and explicit filesystem, web, broker, or shell capabilities
- **Review independently** with the `review` skill, which prepares target, patch, acceptance-criteria, and deterministic-check evidence for the saved `review` workflow

### Extensions

The Pi extensions are directory-based TypeScript modules under [`pi/agent/extensions/`](pi/agent/extensions/). They are grouped around the capabilities I want the agent to have:

- **Workflow state:** `goal`, `todo`, `scheduled-tasks`
- **Delegation and orchestration:** `subagents`, `workflows`, `structured-output`
- **External access:** `mcp-broker`, `web-access`
- **Agent/user interaction:** `ask-user`
- **Context and TUI polish:** `context-usage`, `extra-context`, `compact-tools`, `startup-header`, `statusline`
- **Shared infrastructure:** `_shared` helpers for rendering, config, logging, and common extension behavior

### Extension Development

Pi extension work is treated like real software, not just config:

- TypeScript source lives beside extension docs and tests
- shared helpers live under [`pi/agent/extensions/_shared/`](pi/agent/extensions/_shared/)
- meaningful logic has colocated `*.test.ts` coverage
- `README.md` documents user-facing behavior
- `DESIGN.md` documents architecture and maintenance invariants for non-trivial extensions
- `API.md` / `api.ts` define reusable public surfaces when an extension exposes code to other extensions

Useful development commands:

```sh
make install-dev      # install Node dependencies and Husky git hooks
npm run lint          # lint Pi extension and saved-workflow TypeScript files
npm run format:check  # check formatting for TS/JS/JSON/Markdown/YAML files
make typecheck        # type-check Pi extension and saved-workflow TypeScript files
make test             # run Pi extension and saved-workflow unit tests
```

## Companion: agent-tools

[`agent-tools`](https://github.com/averycrespi/agent-tools) provides external utilities that complement this configuration repo.

The main integration point is the **MCP broker**: a credentials-holding proxy that lets sandboxed agents use authenticated external services without holding secrets directly. In Pi, the [`mcp-broker`](pi/agent/extensions/mcp-broker/) extension exposes broker-backed tools through `mcp_search`, `mcp_describe`, and `mcp_call`, and guards direct `gh` or remote-git usage when broker tools are preferred.

`agent-tools` also includes a sandbox manager (`sb`) for isolated agent runs. It is relevant to Pi as an outer isolation layer: this Pi config adds workflow guidance and broker preferences, but it does not implement shell command restrictions itself.

## Notes

[`notes/`](notes/) contains public essays and working notes about agent harness design, permissions, subagents, planning workflows, and related topics.

## Quick Start

### Requirements

- [Pi agent](https://pi.dev/)
- [Homebrew](https://brew.sh/)
- [Node.js](https://nodejs.org/) 24+
- macOS assumed, adaptable for Linux

### Setup

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle             # install system dependencies on macOS
make install-dev        # install Node dependencies and Husky git hooks
make install-playwright # for browser automation and web-access JS rendering
make stow-pi            # symlink pi/agent/ into ~/.pi/agent/
```

## License

- Repository licensed under [MIT](./LICENSE)
- Individual components may have their own licenses
