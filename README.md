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
| Saved Scripts      | Reusable validated tool compositions with structured arguments                                                          | [`scripts/`](pi/agent/scripts/)       |
| Saved workflows    | Reusable JavaScript orchestration for independent review and deep research                                              | [`workflows/`](pi/agent/workflows/)   |
| Prompt templates   | Slash-invoked prompts, including secret scanning                                                                        | [`prompts/`](pi/agent/prompts/)       |
| Themes             | Terminal appearance, including Catppuccin Mocha                                                                         | [`themes/`](pi/agent/themes/)         |

See [`pi/README.md`](pi/README.md) for the full catalog. These components are installed from `pi/agent/`; repository-local authoring guidance and development tooling stay in this checkout.

## Quick start

### Requirements

- [Pi agent](https://pi.dev/), installed separately, with a configured model provider
- [Node.js](https://nodejs.org/) 24+; [`.tool-versions`](.tool-versions) pins the version used by CI (currently 25.9.0). Use the pinned version for Script's required permission support.
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

### Manage unattended session context

[Idle compaction](pi/agent/extensions/idle-compaction/README.md) optionally summarizes large, inactive open terminal sessions without starting an agent turn. It is disabled by default, costs summarization tokens, and loses some detail; native navigation races and incomplete dialog visibility remain documented limitations. Use `/idle-compaction-enable` or `/idle-compaction-disable` for a persistent session override, and `/idle-compaction-status` to inspect status.

### Ticket-driven delivery

For Plane-backed work, [`shape-ticket`](pi/agent/skills/shape-ticket/SKILL.md) prepares a verifiable ticket contract, and [`work-ticket`](pi/agent/skills/work-ticket/SKILL.md) owns one selected ticket through the authorized delivery boundary. The [`plane`](pi/agent/skills/plane/SKILL.md) skill supplies safe gateway access.

For an explicitly ordered series, [work-stack](pi/agent/skills/work-stack/SKILL.md) coordinates one isolated ticket child at a time, stacking each successor on the predecessor's verified commit. Choose local-only branches or explicitly authorized review-ready PRs; the parent reconciles evidence before advancing and pauses on blockers or changed predecessor heads. It does not merge or automatically restack.

Ticket implementation includes in-scope local commits unless excluded; pushing and PR publication require explicit authorization. PR delivery includes independent review before publication and bounded, session-bound CI monitoring and repair afterward. See `work-ticket` for the full delivery and recovery procedures.

## Delegation and automation

### Delegate reasoning and implementation

| Mechanism                                            | Use it for                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Subagents](pi/agent/extensions/subagents/README.md) | One independent, asynchronous question with a self-contained prompt, explicit capabilities and a configured profile.                                                                                                                                       |
| [Workflows](pi/agent/extensions/workflows/README.md) | Repeatable research or review coordinated by deterministic JavaScript, with bounded subagents and verification gates. Saved definitions include `review` and `deep-research`; workflow subagents cannot receive writable filesystem or shell capabilities. |
| [Spin-out](pi/agent/skills/spin-out/SKILL.md)        | Explicitly requested delegation to a fresh Pi agent in a Herdr-managed worktree, with a durable local task brief.                                                                                                                                          |

For ongoing implementation work, the opt-in [Coordinate extension](pi/agent/extensions/coordinate/README.md) remembers coordinator/child roles and simplifies isolated launches, status and explicit evidence acceptance. The human enables it; enabling grants no execution or publication authority. Agents keep judgment and child-owned verification, with [automatic bidirectional Mailbox messaging](pi/agent/extensions/mailbox/README.md) and Herdr launch/process control. Each persistent session listens on its full session ID with fixed-window batching, idle gating and bounded redelivery; no mailbox Monitor or Script setup is needed. Messages survive closed sessions; ACK is incorporation, not completion. Reload restores facts, never launches workers. Existing runs are not automatically adopted; standalone spin-outs remain standalone.

The main session owns implementation and execution evidence by default. Writable delegation requires an explicit user request and the [bounded execution safeguards](pi/agent/extensions/subagents/README.md#delegation-guidance); parent and child writes must never overlap in one checkout.

<a id="continue-watch-and-schedule"></a>

### Continue and watch

[Background execution](pi/agent/extensions/background/README.md) lets Script, Subagents and Workflows finish bounded work while the conversation stays available. Subagent and Workflow runs require background execution; Script remains foreground by default. It retains outcomes, shows below-editor status and sends automatic terminal notifications; it adds no model-facing tool or executor. Cancellation is not rollback, notification consumption is not acceptance, and session changes never replay work.

| Mechanism                                        | Use it for                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Monitor](pi/agent/extensions/monitor/README.md) | Bounded polling, typed provider event observation, or settlement-based continuation under explicit authority, with no model turns while waiting. |

Monitor is the supported route for session-bound observation and explicitly requested bounded continuation; ordinary multi-step work needs no scheduler. It uses fresh Script evaluations and typed events; it is not an unattended cron scheduler. Shutdown, reload and navigation invalidate observations without automatic resumption. Deadlines and notifications request attention—not task success, model-consumption acknowledgment, prompt-cache retention, or permission to answer for the user. The caller owns completion and cumulative allowances. See [migration guidance](pi/docs/migrations.md#observer-retirement) before replacing historical observers; never give two schedulers the same job.

### Compose external tool calls

[Script](pi/agent/extensions/script/README.md) runs bounded JavaScript with explicitly selected, host-permitted extension capabilities, or pure JSON computation with no providers. Its supported provider and host APIs are independent of MCP Gateway, which optionally supplies a capability for composing authenticated external calls. [Web-access](pi/agent/extensions/web-access/README.md#script-composition) independently supplies search and fetch capabilities for the same composition, retaining host-side clone/spill effects without guest filesystem access. [Builtins](pi/agent/extensions/builtins/README.md#script-provider) adds composition of active stock filesystem and shell tools while preserving compact direct rendering. Nested calls do not run ordinary tool hooks; provider permission never substitutes for user authorization. Runs are single-use and foreground by default; optional background execution preserves the same permissions and finite deadlines. [Saved Scripts](pi/agent/extensions/script/README.md#saved-scripts) make compositions reusable by name with validated arguments; their metadata cannot grant providers or approval.

Use direct `mcp_search`, `mcp_describe`, and `mcp_call` tools for straightforward discovery and calls. Use Script to paginate, join, or aggregate results when intermediate data would otherwise inflate context. Gateway composition requires the globally allowed and explicitly selected `mcp` provider; see its [provider contract](pi/agent/extensions/mcp-gateway/API.md#script-provider). Gateway permissions do not replace user authorization for external mutations.

## Optional integrations

### Browser automation and web rendering

Run `make install-playwright` to install browser tooling and Chromium for the pinned web-access dependency. Without it, web-access still supports static extraction and hosted fallbacks. See [web-access](pi/agent/extensions/web-access/README.md) and the [Playwright skill](pi/agent/skills/playwright/SKILL.md).

### Herdr: terminal and worktree control

Install [Herdr](https://herdr.dev/), then run `herdr integration install pi` after Stow. Restart Pi or run `/reload` to load its lifecycle bridge.

The [`herdr`](pi/agent/skills/herdr/SKILL.md) and `spin-out` skills use Herdr for terminal and worktree control. Herdr owns the local Pi lifecycle bridge. Human questions use ordinary conversation rather than a blocking choice tool. See [Herdr integration](pi/README.md#herdr-integration) for component ownership and remote-client setup, including macOS-to-Lima use.

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
