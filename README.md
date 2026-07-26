# Agent Config

My personal [Pi](https://pi.dev/) setup for software development. It adds a structured workflow for clarifying requirements, planning and challenging an approach, implementing against a durable goal, and independently reviewing the result.

The repository contains the skills, extensions, prompts, and saved workflows that power that setup. Custom extensions are written in TypeScript and maintained with tests and documentation.

## Pi Agent Harness

The harness combines a simple development loop with tools that keep work scoped, observable, and verifiable.

### Workflow

1. **Clarify** unclear requirements, edge cases, and acceptance criteria with `clarify`.
2. **Plan and challenge** the approach with `plan` and, for substantial work, `challenge`.
3. **Implement** against a session-scoped objective with `goal`, using `todo` to track work in progress.
4. **Review** completed changes with `review`, which combines repository context, deterministic checks, and independent analysis.

Isolated subagents support research and verification throughout the workflow. Each receives a self-contained task and explicit filesystem, shell, web, or broker permissions.

### Extensions

Custom TypeScript extensions under [`pi/agent/extensions/`](pi/agent/extensions/) provide:

- **Work tracking and automation:** goals, TODOs, and scheduled tasks
- **Delegation and orchestration:** isolated subagents, saved workflows, and structured output
- **External access:** broker-backed services and web research
- **Interaction and context:** user prompts, context reporting, compact tool output, and TUI status information

See [`pi/README.md`](pi/README.md) for the complete extension and skill catalog.

### Development

Extensions are directory-based TypeScript modules with colocated tests and user-facing documentation. Non-trivial extensions also include design guidance, while shared helpers live under [`pi/agent/extensions/_shared/`](pi/agent/extensions/_shared/).

```sh
make install-dev      # install dependencies and Git hooks
npm run lint          # lint extensions and saved workflows
npm run format:check  # check formatting
make typecheck        # run TypeScript checks
make test             # run unit tests
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
