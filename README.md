# Agent Config

[![CI](https://github.com/averycrespi/agent-config/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/averycrespi/agent-config/actions/workflows/ci.yml)

My personal configuration and extension toolkit for the [Pi](https://pi.dev/) coding agent, for developers who want direct coding help, asynchronous research and review, or explicitly delegated implementation.

The aim is to keep useful work moving without carrying every intermediate result through the main conversation: delegate independent reasoning, retain decisions and evidence, and offload repeatable mechanics to tools. Context continuity and prompt-cache preservation are separate concerns—smaller context is not necessarily a cache hit.

This is not a standalone agent. **Install Pi separately.** [GNU Stow](https://www.gnu.org/software/stow/) links this repository's resources into `~/.pi/agent/`; personal settings, model-provider selections and credentials are **not supplied**.

- [Quick start](#quick-start)
- [Working with the agent](#working-with-the-agent)
- [Delegation and automation](#delegation-and-automation)
- [Optional integrations](#optional-integrations)
- [Developing this repository](#developing-this-repository)

## What's included

Shared agent instructions, on-demand development skills, TypeScript tools and terminal UI extensions, reusable Scripts and reasoning workflows, prompt templates, and themes. The [configuration reference and full catalog](pi/README.md) explains each component and its entry points; detailed contracts live beside the relevant skill or extension.

## Quick start

### Requirements

- [Pi](https://pi.dev/), installed separately with a configured model provider
- [Node.js](https://nodejs.org/) 24+; use the [CI-pinned version](.tool-versions), currently 25.9.0, for Script's required permission support
- [Homebrew](https://brew.sh/) for the macOS setup below; Linux needs equivalent system dependencies, including GNU Stow

### Core setup

Inspect existing files in `~/.pi/agent/` and reconcile conflicts before linking; do not overwrite an existing configuration blindly.

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle      # install system dependencies on macOS
make install-dev # install Node dependencies and Husky Git hooks
make stow-pi     # symlink pi/agent/ into ~/.pi/agent/
```

Personal `pi/agent/settings.json` is gitignored. Configure your own model and extension settings, then start Pi. In an existing session, `/reload` loads changed resources but can stop session-bound automation; see [configuration and reloading](pi/README.md#configuration-and-reloading).

Browser automation, terminal/worktree control and authenticated services have [optional setup](#optional-integrations).

## Working with the agent

### Direct work

Start with the main session for small or tightly dependent tasks. Ask for the outcome, constraints and verification you need; delegation is useful only when its isolation or independent judgment outweighs the handoff.

Use activities as needed, not a mandatory pipeline: [clarify](pi/agent/skills/clarify/SKILL.md) material ambiguity, [challenge](pi/agent/skills/challenge/SKILL.md) an approach, implement authorized work, [diagnose](pi/agent/skills/diagnose/SKILL.md) uncertain failures, and [review](pi/agent/skills/review/SKILL.md) completed changes with checks and independent analysis.

### Manage unattended session context

Keep intent, decisions, unresolved tasks and evidence references in conversation, [TODO](pi/agent/extensions/todo/README.md) and existing task checkpoints. Read retained results before accepting them; a short report is a pointer to evidence, not proof. Compaction summarizes older conversation while retaining recent messages, trading detail for space rather than deleting the original session history.

**Preserve reusable prompt prefixes, not just a small context.** Avoid unnecessary changes to tool definitions and system-prompt prefixes during a task. The gateway exposes three stable discovery/call tools instead of registering every remote tool, but its namespace summary can change the system prompt when discovery changes. This is a stability-oriented design, not an immutable-prefix guarantee.

For unattended open terminal sessions, [idle compaction](pi/agent/extensions/idle-compaction/README.md) is opt-in and disabled by default. Its shipped defaults require 29 minutes of inactivity and context usage above 40%. [Monitor's cycle ceiling](pi/agent/extensions/monitor/README.md#configuration) defaults to 28 minutes: the intent is to request attention before compaction, with both below an **assumed**, not measured, 30-minute cache lifetime. Admitted wake activity resets the idle interval; queued messages block compaction. Actual job deadlines are explicit and may be shorter.

These independent clocks do not guarantee ordering or cached continuation. Provider/model cache lifetimes and local settings vary; a Monitor timeout only requests attention. Compaction itself costs summarization tokens, loses detail and changes the context that could have been reused. Use `/idle-compaction-status` to inspect its policy and `/idle-compaction-enable` or `/idle-compaction-disable` for a session override. Planned smarter compaction is not shipped here or required for this setup; neither cache retention nor cost savings is guaranteed.

### Ticket-driven delivery

For optional Plane-backed delivery, [shape-ticket](pi/agent/skills/shape-ticket/SKILL.md) prepares a verifiable contract and [work-ticket](pi/agent/skills/work-ticket/SKILL.md) owns one selected ticket through its authorized boundary. Implementation includes in-scope local commits unless excluded; push and PR publication require explicit authorization.

For an explicitly ordered series, [work-stack](pi/agent/skills/work-stack/SKILL.md) composes isolated agent launches, Mailbox and ticket delivery, one implementing child at a time. The parent tracks order and result references in TODO/conversation; each child owns verification and CI. Successors start from verified predecessor commits and PRs target predecessor branches. It does not merge, automatically restack, or introduce a stack registry. Green against a stack base is not independent readiness for `main`.

## Delegation and automation

Choose by the work you need to offload:

| Goal                                       | Choose                                              | Boundary                                                                                                           |
| ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| One self-contained reasoning question      | [Subagent](pi/agent/extensions/subagents/README.md) | Bounded asynchronous child with explicit capabilities and a configured profile                                     |
| Coordinated research or independent review | [Workflow](pi/agent/extensions/workflows/README.md) | Deterministic orchestration of read-mostly children and verification; no writable filesystem or shell capabilities |
| Ongoing work in a separate Pi session      | [Spawn-agent](pi/agent/skills/spawn-agent/SKILL.md) | Explicitly authorized, isolated Herdr worktree/workspace; initial assignment through Herdr, then Mailbox           |
| Watch a condition or continue later        | [Monitor](pi/agent/extensions/monitor/README.md)    | Explicitly authorized, finite session-bound observation or continuation; no model turns while waiting              |
| Paginate, join or aggregate tool results   | [Script](pi/agent/extensions/script/README.md)      | Bounded JavaScript with explicitly selected, host-permitted providers; no subagent reasoning                       |

### Delegate reasoning and implementation

Continue independent authorized work while a child runs; keep dependent work sequential. [Background execution](pi/agent/extensions/background/README.md) retains outcomes and automatically notifies the session for Subagents, Workflows and optionally Script. Inspect the result when notified, and yield when nothing independent remains—do not poll for completion.

Persistent agents receive their initial scoped assignment through Herdr, then use [Mailbox](pi/agent/extensions/mailbox/README.md) for durable, automatic bidirectional follow-up instructions, questions and reports within that authority. The saved spawn-agent Script handles launch mechanics, not task submission or acceptance; ordinary Pi sessions need no role binding or assignment registry. The parent evaluates exact evidence before accepting results. An ACK means incorporated, not completed.

Implementation stays in the owning session by default. Writable delegation needs explicit scope and separate checkout ownership; parent and child must never write the same checkout concurrently. Launch does not authorize publication, installation, live reload or cleanup, and completed work does not remove its workspace automatically.

<a id="continue-watch-and-schedule"></a>

### Continue and watch

Use Monitor for bounded polling, typed events or requested continuation, not as an unattended cron service or a substitute for ordinary multi-step work. Keep one observer owner and retain cumulative limits. Shutdown, reload and navigation invalidate observations; restoration does not resume them. A notification or elapsed deadline is not task success, and cancellation does not roll back effects. See [lifecycle and migration guidance](pi/docs/migrations.md#observer-retirement) before replacing historical observers.

### Compose external tool calls

Use direct `mcp_search`, `mcp_describe` and `mcp_call` for straightforward gateway calls. Use Script when deterministic pagination, dependent lookups or aggregation can return a concise result instead of filling the conversation with intermediate responses. [Saved Scripts](pi/agent/extensions/script/README.md#saved-scripts) make these compositions reusable with validated arguments.

Script also supports pure JSON computation and other selected providers; it does not require MCP Gateway. Provider permission never substitutes for user approval, especially for external mutations. Keep task choice and result evaluation with the agent; put repeatable mechanics in code. See the [provider catalog](pi/README.md#extensions) for supported integrations and their effect boundaries.

## Optional integrations

### Browser automation and web rendering

`make install-playwright` installs browser tooling and browser dependencies, including Chromium for the pinned web-access dependency. Static extraction and hosted fallbacks remain available without it. See [web-access](pi/agent/extensions/web-access/README.md) and the [Playwright skill](pi/agent/skills/playwright/SKILL.md).

### Herdr: terminal and worktree control

Install [Herdr](https://herdr.dev/), then run `herdr integration install pi` after Stow. Restart Pi or explicitly reload to load its lifecycle bridge. See [Herdr integration](pi/README.md#herdr-integration) for ownership and remote-client setup, including macOS-to-Lima use.

### MCP Gateway: authenticated external services

The companion [agent-tools](https://github.com/averycrespi/agent-tools) repository provides the gateway. Configure its endpoint separately and supply `MCP_GATEWAY_AGENT_TOKEN` in Pi's process environment, never in settings or committed files. Missing configuration leaves Pi usable but prevents authenticated gateway calls. See [gateway configuration](pi/agent/extensions/mcp-gateway/README.md#configuration).

Gateway permissions govern service access, not shell isolation. Pi tools and extensions run with the Pi process's permissions; use an outer isolation layer when needed. The companion repository also provides a sandbox manager (`sb`).

## Developing this repository

Development is optional; using the configured agent does not require following an authoring pipeline. Edit Stow-managed resources at their source under `pi/`, not through installed symlinks. See [repository guidance](AGENTS.md) and the repo-local [extension authoring skill](.pi/skills/create-extension/SKILL.md) for required checks and conventions.

```sh
npm run lint         # lint extensions, saved workflows and saved Scripts
npm run format:check # check formatting
make typecheck       # check TypeScript
make test            # run repository tests
```

GitHub Actions runs these checks for pull requests and pushes to `main`. Documentation-only changes need formatting and affected path, link, example and claim checks; runtime changes require the full checks above.

## Notes

[Public notes](notes/) discuss agent harness design, permissions, delegation and related trade-offs.

## License

- Repository licensed under [MIT](LICENSE)
- Individual components may have their own licenses
