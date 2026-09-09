# Agent Config

My personal [Pi](https://pi.dev/) setup for software development: research-first clarification, focused implementation, ticket-driven delivery, and independent review.

The repository contains skills, TypeScript extensions, prompt templates, themes, and saved workflows, installed into `~/.pi/agent/` with [GNU Stow](https://www.gnu.org/software/stow/).

## Capabilities

Custom extensions under [`pi/agent/extensions/`](pi/agent/extensions/) provide:

- **Work tracking and automation:** loops, TODOs, and scheduled tasks
- **Delegation and orchestration:** isolated subagents, saved workflows, and structured output
- **External access:** gateway-backed services and web research
- **Interaction and context:** user prompts, context reporting, compact tool output, and TUI status information

See [`pi/README.md`](pi/README.md) for the complete extension, skill, prompt, and saved-workflow catalog.

## Quick Start

### Requirements

- [Pi agent](https://pi.dev/), installed separately, with a configured model provider
- [Node.js](https://nodejs.org/) 24+; [`.tool-versions`](.tool-versions) pins the version used by CI (currently 25.9.0)
- [Homebrew](https://brew.sh/) for the macOS dependency setup below
- macOS assumed; Linux requires equivalent system dependencies, including GNU Stow

### Core setup

Before running Stow, inspect any existing files in `~/.pi/agent/` and reconcile conflicts; do not overwrite an existing configuration blindly.

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle      # install system dependencies on macOS
make install-dev # install Node dependencies and Husky git hooks
make stow-pi     # symlink pi/agent/ into ~/.pi/agent/
```

Personal `pi/agent/settings.json` is gitignored, so a fresh clone does not reproduce model/provider selections or local extension settings. Configure these for your environment, then start Pi (or run `/reload` in an existing session to load the installed extensions and skills).

### Optional integrations

- **Browser automation and local web rendering:** run `make install-playwright`. This installs browser tooling and Chromium for the pinned web-access dependency; without it, web-access still supports static extraction and hosted fallbacks. See [web-access](pi/agent/extensions/web-access/README.md).
- **Terminal and worktree integration:** install [Herdr](https://herdr.dev/), then run `herdr integration install pi` after Stow. Restart Pi or run `/reload` to load its lifecycle bridge. See [Herdr integration](pi/README.md#herdr-integration), including macOS-to-Lima remote setup.
- **Authenticated external services:** configure a separate MCP Gateway endpoint and supply `MCP_GATEWAY_AGENT_TOKEN` in Pi's process environment. Keep tokens out of settings and the repository. Missing gateway configuration leaves Pi usable, but MCP calls require it. See [gateway configuration](pi/agent/extensions/mcp-gateway/README.md#configuration).

## Development workflow

Use the activities that fit the request rather than treating every skill as a mandatory phase:

- **Clarify** material ambiguity with [`clarify`](pi/agent/skills/clarify/SKILL.md): research first, ask focused questions, and return a concise brief without creating artifacts. Skip the interview when the request is already clear.
- **Stress-test** concrete approaches with [`challenge`](pi/agent/skills/challenge/SKILL.md) for material risks or explicit-only [`simplify`](pi/agent/skills/simplify/SKILL.md) for unnecessary complexity.
- **Implement and verify** directly for authorized local work, or use the ticket workflow for prepared delivery. Keep evidence and checks proportionate to the change.
- **Review** changes with [`review`](pi/agent/skills/review/SKILL.md), combining repository context, deterministic checks, and independent analysis while reporting failed checks and verification gaps.

For Plane-backed delivery, [`plane`](pi/agent/skills/plane/SKILL.md) defines safe gateway access, [`shape-ticket`](pi/agent/skills/shape-ticket/SKILL.md) prepares a verifiable contract, and [`work-ticket`](pi/agent/skills/work-ticket/SKILL.md) owns one selected ticket through the authorized delivery boundary. Ticket implementation includes in-scope local commits unless excluded; pushing and PR publication require explicit authorization. PR delivery includes independent review before publication and bounded, session-bound CI monitoring and repair afterward. See `work-ticket` for recovery, allowances, and settlement procedures.

## Orchestration

| Primitive                                            | Use it when                                                                                                    | What it provides                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Subagents](pi/agent/extensions/subagents/README.md) | Parallelism, substantial context isolation, or independent judgment outweighs delegation overhead.             | One-shot child sessions with self-contained prompts, explicit capabilities, and configured `fast`, `balanced`, or `strong` profiles.                                         |
| [Workflows](pi/agent/extensions/workflows/README.md) | Research, review, or audit follows predictable, reusable control flow.                                         | Deterministic JavaScript orchestration with bounded read-mostly subagents, structured output, verification gates, and budgets; no writable filesystem or shell capabilities. |
| [Loops](pi/agent/extensions/loop/README.md)          | A user, loaded skill, or established workflow explicitly requests bounded continuation of the current session. | A repeated message with continuation/time limits and yield/stop/resume controls—not a completion judgment or background watcher.                                             |

The main session owns implementation and execution evidence; workflows own deterministic orchestration, and subagents handle isolated questions. Writable delegation requires an explicit user request and a bounded execution workflow with one writer, a structured handoff, and independent verification; parent and child writes must never overlap in one checkout. The calling user, skill, or extension defines completion policy for loops.

For explicitly requested worktree-based delegation, [`spin-out`](pi/agent/skills/spin-out/SKILL.md) starts a fresh Pi agent in a Herdr-managed worktree with a durable local task brief.

## Integrations

### Herdr

[Herdr](https://herdr.dev/) provides the terminal and worktree control plane used by the [`herdr`](pi/agent/skills/herdr/SKILL.md) and `spin-out` skills. Herdr owns the local Pi lifecycle bridge; this repository's [`ask-user`](pi/agent/extensions/ask-user/README.md) extension exposes `ask_user` and reports interactive questions through that bridge. See [Herdr integration](pi/README.md#herdr-integration) for installation, component ownership, and remote-client setup.

### Companion: agent-tools

[`agent-tools`](https://github.com/averycrespi/agent-tools) provides external utilities that complement this configuration repo. Its **MCP Gateway** governs authenticated external access through Pi's [`mcp-gateway`](pi/agent/extensions/mcp-gateway/README.md) extension and the `mcp_search`, `mcp_describe`, and `mcp_call` tools.

The companion also includes a sandbox manager (`sb`) for isolated agent runs. Gateway permissions govern external service access; this Pi configuration's guidance toward gateway tools is advisory, not shell sandbox enforcement. Use an outer isolation layer when shell restrictions are needed.

## Development

Extensions are directory-based TypeScript modules with colocated tests and user-facing documentation. Non-trivial extensions also include design guidance, while shared helpers live under [`pi/agent/extensions/_shared/`](pi/agent/extensions/_shared/). See [repository authoring guidance](AGENTS.md) for safeguards and required checks.

The repo-local [`create-extension`](.pi/skills/create-extension/SKILL.md) skill covers creating and modifying extensions, including rendering, configuration, state, documentation, and testing conventions. It stays under `.pi/skills/` and is not installed globally by Stow. Pi discovers project-local skills when the project is trusted and skill discovery is enabled; `AGENTS.md` also provides a direct file path for agents to read without changing trust or reloading the session.

```sh
npm run lint         # lint extensions and saved workflows
npm run format:check # check formatting
make typecheck       # run TypeScript checks
make test            # run unit tests
```

GitHub Actions runs these checks for pull requests and pushes to `main`.

## Notes

[`notes/`](notes/) contains public essays and working notes about agent harness design, permissions, subagents, planning workflows, and related topics.

## License

- Repository licensed under [MIT](./LICENSE)
- Individual components may have their own licenses
