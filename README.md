# Agent Config

[![CI](https://github.com/averycrespi/agent-config/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/averycrespi/agent-config/actions/workflows/ci.yml)

My personal configuration and extension toolkit for the [Pi](https://pi.dev/) coding agent.

It combines reusable development skills with custom tools for delegation, automation, external services, and terminal UI improvements. Use it for direct coding work, research and independent review, or optional Plane-backed ticket delivery.

This is a configuration repository, not a standalone agent. Pi is installed separately; [GNU Stow](https://www.gnu.org/software/stow/) links the configuration into `~/.pi/agent/`. Model settings and integration credentials remain local.

## What's included

| Component          | Purpose                                                                                                                 | Location                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Agent instructions | Shared rules for task execution, verification, Git, and communication                                                   | [`AGENTS.md`](pi/agent/AGENTS.md)     |
| Skills             | On-demand guidance for clarification, debugging, review, ticket delivery, and other activities                          | [`skills/`](pi/agent/skills/)         |
| Extensions         | TypeScript tools and UI enhancements for delegation, automation, external access, context visibility, and work tracking | [`extensions/`](pi/agent/extensions/) |
| Saved workflows    | Reusable JavaScript orchestration for independent review and deep research                                              | [`workflows/`](pi/agent/workflows/)   |
| Prompt templates   | Slash-invoked prompts, including secret scanning                                                                        | [`prompts/`](pi/agent/prompts/)       |
| Themes             | Terminal appearance, including Catppuccin Mocha                                                                         | [`themes/`](pi/agent/themes/)         |

See [`pi/README.md`](pi/README.md) for the full catalog. These components are installed from `pi/agent/`; repository-local authoring guidance and development tooling stay in this checkout.

## Quick start

### Requirements

- [Pi agent](https://pi.dev/), installed separately, with a configured model provider
- [Node.js](https://nodejs.org/) 24+; [`.tool-versions`](.tool-versions) pins the version used by CI (currently 25.9.0). Use the pinned version for Code mode's required permission support.
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

Browser automation, Herdr, and authenticated external services need additional setup; see [Optional integrations](#optional-integrations).

## Working with the agent

### Direct work

Use the activities that fit the request rather than treating every skill as a mandatory phase:

- **Clarify** material ambiguity with [`clarify`](pi/agent/skills/clarify/SKILL.md): research first, ask focused questions, and return a concise brief. Skip the interview when the request is already clear.
- **Stress-test** concrete approaches with [`challenge`](pi/agent/skills/challenge/SKILL.md) for material risks or explicit-only [`simplify`](pi/agent/skills/simplify/SKILL.md) for unnecessary complexity.
- **Implement and verify** authorized work in the main session. Use [`diagnose`](pi/agent/skills/diagnose/SKILL.md) when a failure's cause is uncertain, and keep checks proportionate to the change.
- **Review** changes with [`review`](pi/agent/skills/review/SKILL.md), combining repository context, deterministic checks, and independent analysis. Report failed checks and verification gaps rather than implying success.

### Ticket-driven delivery

For Plane-backed work, [`shape-ticket`](pi/agent/skills/shape-ticket/SKILL.md) prepares a verifiable ticket contract, and [`work-ticket`](pi/agent/skills/work-ticket/SKILL.md) owns one selected ticket through the authorized delivery boundary. The [`plane`](pi/agent/skills/plane/SKILL.md) skill supplies safe gateway access.

Ticket implementation includes in-scope local commits unless excluded; pushing and PR publication require explicit authorization. PR delivery includes independent review before publication and bounded, session-bound CI monitoring and repair afterward. See `work-ticket` for the full delivery and recovery procedures.

## Delegation and automation

### Delegate and coordinate reasoning

| Mechanism                                            | Use it for                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Subagents](pi/agent/extensions/subagents/README.md) | Isolated questions where parallelism, context isolation, or independent judgment outweighs delegation overhead. Each child receives a self-contained prompt, explicit capabilities, and a configured profile.                                              |
| [Workflows](pi/agent/extensions/workflows/README.md) | Repeatable research or review coordinated by deterministic JavaScript, with bounded subagents and verification gates. Saved definitions include `review` and `deep-research`; workflow subagents cannot receive writable filesystem or shell capabilities. |
| [Spin-out](pi/agent/skills/spin-out/SKILL.md)        | Explicitly requested delegation to a fresh Pi agent in a Herdr-managed worktree, with a durable local task brief.                                                                                                                                          |

The main session owns implementation and execution evidence by default. Writable delegation requires an explicit user request and the [bounded execution safeguards](pi/agent/extensions/subagents/README.md#delegation-guidance); parent and child writes must never overlap in one checkout.

### Continue, watch, and schedule

| Mechanism                                                        | Use it for                                                                                                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Loop](pi/agent/extensions/loop/README.md)                       | Continuing the current agent session within turn and time limits when explicitly requested by the user, a loaded skill, or an established workflow. Ordinary multi-step work does not need a loop. |
| [Monitor](pi/agent/extensions/monitor/README.md)                 | Explicitly requested checks of gateway conditions without recurring model turns while waiting, followed by a notification when attention is needed.                                                |
| [Scheduled tasks](pi/agent/extensions/scheduled-tasks/README.md) | Recurring Markdown-defined tasks run through cron, or on demand, in fresh child Pi processes with retained run artifacts and optional cross-run handoffs.                                          |

Loop continues reasoning; Monitor checks conditions; scheduled tasks start separate runs. Monitor is session-bound, not a durable background service: shutdown, reload, or session/branch navigation stops observations without automatic resumption. Neither Loop nor Monitor decides whether the overall task succeeded; the calling user, skill, or workflow defines completion.

### Compose external tool calls

[Code mode](pi/agent/extensions/code-mode/README.md) runs one bounded JavaScript program to paginate, join, or aggregate MCP Gateway results before returning compact data to the model. It coordinates tool calls, not agents, and does not provide persistent polling.

Use direct `mcp_search`, `mcp_describe`, and `mcp_call` tools for straightforward discovery and calls. Use Code mode when intermediate results would otherwise inflate context. Gateway permissions do not replace user authorization for external mutations.

## Optional integrations

### Browser automation and web rendering

Run `make install-playwright` to install browser tooling and Chromium for the pinned web-access dependency. Without it, web-access still supports static extraction and hosted fallbacks. See [web-access](pi/agent/extensions/web-access/README.md) and the [Playwright skill](pi/agent/skills/playwright/SKILL.md).

### Herdr: terminal and worktree control

Install [Herdr](https://herdr.dev/), then run `herdr integration install pi` after Stow. Restart Pi or run `/reload` to load its lifecycle bridge.

The [`herdr`](pi/agent/skills/herdr/SKILL.md) and `spin-out` skills use Herdr for terminal and worktree control. Herdr owns the local Pi lifecycle bridge; this repository's [`ask-user`](pi/agent/extensions/ask-user/README.md) extension reports interactive questions through it. See [Herdr integration](pi/README.md#herdr-integration) for component ownership and remote-client setup, including macOS-to-Lima use.

### MCP Gateway: authenticated external services

The companion [`agent-tools`](https://github.com/averycrespi/agent-tools) repository provides the MCP Gateway used by this configuration's [`mcp-gateway`](pi/agent/extensions/mcp-gateway/README.md) extension.

Configure a separate gateway endpoint and supply `MCP_GATEWAY_AGENT_TOKEN` in Pi's process environment. Keep tokens out of settings and the repository. Missing gateway configuration leaves Pi usable, but MCP calls require it. See [gateway configuration](pi/agent/extensions/mcp-gateway/README.md#configuration).

The companion also includes a sandbox manager (`sb`) for isolated agent runs. Gateway permissions govern external service access; this configuration's guidance toward gateway tools is advisory, not shell sandbox enforcement. Use an outer isolation layer when shell restrictions are needed.

## Developing this repository

Extensions are directory-based TypeScript modules with colocated tests and user-facing documentation. Non-trivial extensions also include design guidance; shared helpers live under [`pi/agent/extensions/_shared/`](pi/agent/extensions/_shared/).

See [repository authoring guidance](AGENTS.md) for safeguards and required checks, and the repo-local [`create-extension`](.pi/skills/create-extension/SKILL.md) skill for extension conventions. That skill stays under `.pi/skills/` and is not installed globally by Stow.

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
