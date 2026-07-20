# Agent Config

A Pi-first coding-agent harness: configuration, TypeScript extensions, skills, subagents, and workflow conventions for turning a general-purpose coding agent into a reliable software engineering partner.

The active focus of this repository is [Pi](https://pi.dev/) under [`pi/agent/`](pi/README.md). The older [Claude Code](https://www.anthropic.com/claude-code) setup remains in [`claude/`](claude/README.md) as legacy/reference material.

This repo pairs well with my [agent-tools](https://github.com/averycrespi/agent-tools), especially the MCP broker for safe external tool access.

## What This Repo Is

This is my personal agent operating system for software work. It combines:

- **A Pi-native workflow layer** for planning, executing, independently reviewing, and completing engineering tasks
- **Custom TypeScript extensions** that add durable goals, TODO tracking, subagents, prechecked scheduled tasks, brokered external tools, web access, and TUI polish
- **Reusable skills and saved workflows** for planning, plan visualization, diagnosis, TDD, browser automation, frontend design, Jira ticket creation, evidence-based review, deep public-web research, memory workflows, and agent-harness engineering
- **Centrally governed subagents** with explicit composable capabilities, model tiers, and thinking
- **Extension development conventions** with shared helpers, colocated tests, and deterministic checks

The goal is not just to store settings. The goal is to make the agent more stateful, safer, more inspectable, and better at real development workflows.

## Pi Agent Harness

[`pi/agent/`](pi/README.md) is the main artifact in this repository. Running `make stow-pi` symlinks it into `~/.pi/agent/`.

### Core Workflow

The Pi setup is built around a durable development loop:

- **Clarify scope** with `clarify` when requirements, edge cases, acceptance criteria, or design intent are fuzzy
- **Plan the work** with `plan`, then stress-test substantial plans with `challenge-plan` before execution
- **Execute deliberately** with session-scoped goals via `goal`, optional fail-closed independent completion review, and in-session task tracking via `todo`
- **Delegate isolated research** with self-contained prompts and explicit filesystem, web, broker, or shell capabilities
- **Review independently** with the `review` skill, which prepares target, patch, acceptance-criteria, and deterministic-check evidence for the saved `review` workflow

Supporting rails keep the loop safer and more inspectable:

- **Route authenticated external access** through `mcp-broker` instead of exposing credentials directly to the agent
- **Use direct web access** through `web-access` for public search and page fetching
- **Orchestrate multi-agent work** with inline or reusable named `workflow` definitions—including a repository-managed `deep-research` workflow—that fan out explicitly routed subagents under host-enforced concurrency, central tier policy, run budgets, and structured verification/report gates

This turns Pi from a chat interface with tools into a more structured development harness.

### Extensions

The Pi extensions are directory-based TypeScript modules under [`pi/agent/extensions/`](pi/agent/extensions/). They are grouped around the capabilities I want the agent to have:

- **Workflow state:** `goal`, `todo`, `scheduled-tasks`
- **Delegation and orchestration:** `subagents`, `workflows`, `structured-output`
- **External access:** `mcp-broker`, `web-access`
- **Agent/user interaction:** `ask-user`
- **Context and TUI polish:** `context-usage`, `extra-context`, `compact-tools`, `startup-header`, `statusline`
- **Shared infrastructure:** `_shared` helpers for rendering, config, logging, and common extension behavior

See the [Pi README](pi/README.md#extensions) for the full extension table.

### Skills and Subagents

The Pi skill set lives in [`pi/agent/skills/`](pi/agent/skills/) and is written for Pi's tool surface and GPT-5.x-style instruction following. It includes workflow skills for clarifying requirements, planning, visualizing plans as HTML artifacts, diagnosing failures, building frontend UI, using Playwright, creating skills, and working with retained memory.

The [`subagents`](pi/agent/extensions/subagents/) extension runs isolated child contexts from self-contained prompts. Each call explicitly selects from four fixed capabilities—filesystem reads, shell execution, read-only broker access, and public web access—plus a centrally configured small/medium/large model tier and allowed thinking level. There are no named roles or Markdown agent presets; intent is the visible identity and authority is composed per request.

The [`workflows`](pi/agent/extensions/workflows/) extension adds compound listing, validation, and foreground JavaScript execution for inline or reusable named user-scoped definitions. Workflow calls carry the same explicit capability/tier/thinking contract and use host-enforced concurrency, run budgets, structured verification/report gates, and compact progress. The repository ships [`deep-research`](pi/agent/workflows/deep-research.js), a bounded public-web workflow that cross-checks source-backed claims, and [`review`](pi/agent/workflows/review.js), a read-only workflow that reviews caller-prepared evidence through independent structured lenses and one fail-closed adjudication. The companion [`review` skill](pi/agent/skills/review/SKILL.md) prepares the evidence package, invokes that workflow, and preserves its report.

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

## Legacy Claude Code Configuration

[`claude/`](claude/README.md) contains my earlier Claude Code setup. It is retained for reference and compatibility, but new harness development in this repo is focused on Pi.

The Claude setup includes:

- structured workflow skills adapted from earlier agent workflow experiments
- security and quality hooks, including secret scanning and format-on-write behavior
- sandbox-mode overrides for headless or remote environments
- a custom status line

Some skills and workflow ideas originated there and were later adapted into Pi-specific versions with Pi tool names, Pi extension conventions, and GPT-5.x-friendly prose.

## Notes

[`notes/`](notes/) contains public essays and working notes about agent harness design, permissions, subagents, planning workflows, and related topics.

## Quick Start

### Requirements

- [Pi agent](https://pi.dev/)
- [Homebrew](https://brew.sh/)
- [Node.js](https://nodejs.org/) 24+
- macOS assumed, adaptable for Linux

Claude Code is only required if you want to use the legacy `claude/` configuration.

### Pi Setup

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle             # install system dependencies on macOS
make install-dev        # install Node dependencies and Husky git hooks
make install-playwright # for browser automation and web-access JS rendering
make stow-pi            # symlink pi/agent/ into ~/.pi/agent/
```

### Legacy Claude Setup

```sh
make stow-claude         # symlink claude/ into ~/.claude/
make stow-claude-sandbox # stow claude/ and apply sandbox overrides
```

## License

- Repository licensed under [MIT](./LICENSE)
- Individual components may have their own licenses
