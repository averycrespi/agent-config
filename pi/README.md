# Pi configuration reference

Catalog and configuration reference for the resources installed from `pi/agent/` into `~/.pi/agent/`. For the repository's purpose, installation commands, and guidance on choosing an approach, start with the [root README](../README.md).

- [Directory layout](#directory-layout)
- [Configuration and reloading](#configuration-and-reloading)
- [Component catalog](#component-catalog)
- [Integrations](#integrations)
- [Migration notes](#migration-notes)

## Directory layout

```text
pi/
├── agent/              # Stow-managed Pi resources
│   ├── AGENTS.md       # Shared agent instructions
│   ├── settings.json   # Local, gitignored; not supplied by a fresh clone
│   ├── extensions/     # TypeScript tools, commands, and UI
│   ├── skills/         # On-demand activity guidance
│   ├── workflows/      # Reusable JavaScript orchestration
│   ├── prompts/        # Slash-invoked prompt templates
│   └── themes/         # Terminal appearance
└── docs/               # Integration and migration guides; not installed
```

## Configuration and reloading

Run `make stow-pi` from the repository root only after reconciling existing configuration, as described in [Quick start](../README.md#quick-start). Stow links `pi/agent/` into `~/.pi/agent/`; edit managed files at their source in this checkout. Editing an already-linked file does not require re-stowing, but exposing a file change is not the same as reloading it into Pi.

- **Local settings:** `pi/agent/settings.json` is gitignored. Configure your own provider/model selections and extension settings; credentials are not supplied by this repository. Follow each extension's configuration documentation for supported scopes and environment variables.
- **Loaded resources:** restart Pi or use `/reload` to reload extensions, skills, prompts, themes, and context files. Reloading can stop session-bound automation; consult the relevant extension's lifecycle guidance before doing so.
- **Resource-specific behavior:** active theme edits hot-reload. Saved workflow definitions are read on each list, validate, or run call. Settings reload behavior varies by component; do not assume every setting is hot-reloaded.

## Component catalog

Instructions establish shared rules; skills guide an activity; extensions add tools, commands, or UI; saved workflows coordinate agent calls with JavaScript; prompts expand reusable text; themes change appearance. The sections below list shipped resources, not personal settings or generated installer artifacts.

### Agent instructions

[`agent/AGENTS.md`](agent/AGENTS.md) defines shared execution, verification, external-access, Git, and communication rules. It is installed as global agent context. The [root `AGENTS.md`](../AGENTS.md) instead governs authoring in this repository.

### Extensions

Each name links to its configuration, usage, and lifecycle documentation. The interface column lists primary entry points, not every command or action.

| Extension                                                         | Purpose                                                                | Main interface                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [ask-user](agent/extensions/ask-user/README.md)                   | Ask focused multiple-choice questions                                  | `ask_user`                                                                                                                   |
| [background](agent/extensions/background/README.md)               | Bound polling, typed session events, and settlement-based continuation | `background`, [provider API](agent/extensions/background/API.md)                                                             |
| [code-mode](agent/extensions/code-mode/README.md)                 | Compose gateway calls and return compact results                       | `code`                                                                                                                       |
| [builtins](agent/extensions/builtins/README.md)                   | Compact builtin rendering and active stock tool composition            | Automatic rendering; optional [Script provider](agent/extensions/builtins/README.md#script-provider)                         |
| [context-usage](agent/extensions/context-usage/README.md)         | Explain current context-window usage                                   | `/context-usage`                                                                                                             |
| [idle-compaction](agent/extensions/idle-compaction/README.md)     | Opt-in native compaction of unattended open terminal sessions          | `/idle-compaction`, `/idle-compaction-config`                                                                                |
| [mcp-gateway](agent/extensions/mcp-gateway/README.md)             | Access authenticated external services through a gateway               | `mcp_search`, `mcp_describe`, `mcp_call`, optional [Script provider](agent/extensions/mcp-gateway/README.md#script-provider) |
| [scheduled-tasks](agent/extensions/scheduled-tasks/README.md)     | Run recurring Markdown-defined tasks with retained run artifacts       | `scheduled_tasks`                                                                                                            |
| [script](agent/extensions/script/README.md)                       | Run bounded JavaScript with explicitly selected extension capabilities | `script`, `/script-config`, [host/provider API](agent/extensions/script/API.md)                                              |
| [statusline](agent/extensions/statusline/README.md)               | Show session, context, and model information                           | Automatic footer                                                                                                             |
| [structured-output](agent/extensions/structured-output/README.md) | Validate final output against a configured schema                      | `structured_output` when configured                                                                                          |
| [subagents](agent/extensions/subagents/README.md)                 | Delegate self-contained questions to isolated child agents             | `spawn_agents`                                                                                                               |
| [todo](agent/extensions/todo/README.md)                           | Track session tasks in a persistent list and widget                    | `todo`                                                                                                                       |
| [web-access](agent/extensions/web-access/README.md)               | Search the web and extract pages, repositories, and PDFs               | `web_search`, `web_fetch`                                                                                                    |
| [workflows](agent/extensions/workflows/README.md)                 | Coordinate bounded research and review with JavaScript                 | `workflow`                                                                                                                   |

[Builtins](agent/extensions/builtins/README.md#script-provider) supplies active stock filesystem/shell methods, with structured results and direct-read image fallback. It replaces `compact-tools`; see its migration guidance before installing or reloading. Access requires global allowlisting and explicit selection, never implies user approval, and does not synthesize ordinary tool hooks.

Gateway supplies Script's optional `mcp.call` capability through the supported provider API. It requires trusted global allowlisting and per-execution selection; direct Gateway tools do not require Script, and provider-free Script does not require Gateway. Web-access independently supplies [`web.search` and `web.fetch`](agent/extensions/web-access/README.md#script-provider) with the same allowlisting/selection requirements; web-only scripts need no Gateway, and direct web tools need no Script tool. Host clones/spills do not expose guest filesystem access. Background supervises fresh Script evaluations and typed host subscriptions, including its `sessions` provider. It requires explicit provider selection/allowlisting and monitoring or continuation authority. Code mode remains available for foreground gateway composition. Background replaces the retired observers; follow the [migration inventory and transition guide](docs/migrations.md#observer-retirement). Each provider's README has a **Script provider** entry point covering availability, methods/results, examples, permissions/effects, and failure/lifecycle semantics. Use Script discovery for current argument schemas and the [Script guide](agent/extensions/script/README.md) for shared execution rules.

For choosing between these mechanisms and their material authorization and ownership boundaries, see [Delegation and automation](../README.md#delegation-and-automation). Background observations are session-bound and do not resume after shutdown, reload or navigation. Its [global/environment configuration](agent/extensions/background/README.md#configuration) controls cycle and lifetime ceilings; `/background-config` inspects the loaded policy. Cross-session observation requires both sessions to load Background and permitted `sessions` provider access; `sessions.list()` discovers incarnations without launching sessions or reading transcripts.

[`_shared/`](agent/extensions/_shared/README.md) contains helpers imported by sibling extensions, not a separately loaded extension. Extension authoring conventions and required checks live in the [repository guidance](../AGENTS.md#authoring-guidance).

### Skills

Skills provide on-demand guidance, not additional tools by themselves. Pi discovers skill descriptions and loads the body when needed; invoke one explicitly with `/skill:name` or let the agent select a matching skill. Explicit-only skills still require a user request. See each linked skill for its full contract and any attribution or license files in its directory.

| Skill                                                        | Use it for                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [agent-engineering](agent/skills/agent-engineering/SKILL.md) | Design and analysis of coding-agent harnesses and workflows                       |
| [challenge](agent/skills/challenge/SKILL.md)                 | Stress-testing a concrete approach before implementation                          |
| [clarify](agent/skills/clarify/SKILL.md)                     | Researching ambiguity and asking focused questions                                |
| [create-skill](agent/skills/create-skill/SKILL.md)           | Creating or updating skills                                                       |
| [diagnose](agent/skills/diagnose/SKILL.md)                   | Investigating failures, regressions, and performance problems                     |
| [frontend-design](agent/skills/frontend-design/SKILL.md)     | Building distinctive production-grade web interfaces                              |
| [handoff](agent/skills/handoff/SKILL.md)                     | Explicitly requested session handoffs in `.handoffs/`                             |
| [herdr](agent/skills/herdr/SKILL.md)                         | Terminal, agent, and Git worktree control through Herdr                           |
| [plane](agent/skills/plane/SKILL.md)                         | Safe access to Plane through MCP Gateway                                          |
| [playwright](agent/skills/playwright/SKILL.md)               | Browser automation, testing, and extraction                                       |
| [review](agent/skills/review/SKILL.md)                       | Preparing evidence and invoking independent change review                         |
| [shape-ticket](agent/skills/shape-ticket/SKILL.md)           | Preparing and explicitly approving a verifiable Plane ticket                      |
| [simplify](agent/skills/simplify/SKILL.md)                   | Explicitly requested checks for unnecessary complexity before implementation      |
| [spin-out](agent/skills/spin-out/SKILL.md)                   | Explicitly requested delegation to a fresh agent in a Herdr worktree              |
| [wiki](agent/skills/wiki/SKILL.md)                           | Maintaining a persistent Markdown wiki from source documents                      |
| [work-stack](agent/skills/work-stack/SKILL.md)               | Coordinating an explicitly ordered stack with one isolated ticket child at a time |
| [work-ticket](agent/skills/work-ticket/SKILL.md)             | Owning one selected ticket through its authorized delivery boundary               |

The [review skill](agent/skills/review/SKILL.md) prepares evidence and invokes the saved `review` workflow below; they are guidance and executable orchestration for the same activity, not interchangeable entry points. Ticket publication, CI monitoring, repair, and recovery procedures belong to [work-ticket](agent/skills/work-ticket/SKILL.md), rather than this catalog.

[Work-stack](agent/skills/work-stack/SKILL.md) composes spin-out, work-ticket, Herdr and Background for one repository and a local-only or review-ready PR boundary. The parent retains a Git-excluded stack record referencing child-owned checkpoints, verifies predecessor commits before advancing, and ends turns while observation is pending. Both sessions must already load Background with permitted session-provider access; installing the skill does not launch children or reload extensions. Stacked PR CI qualifies the recorded stack base, not independent readiness for main.

The scheduled-tasks extension also bundles [manage-scheduled-tasks](agent/extensions/scheduled-tasks/skills/manage-scheduled-tasks/SKILL.md) for authoring, validating, running, and debugging task definitions. The repo-local [create-extension skill](../.pi/skills/create-extension/SKILL.md) is an authoring aid, not part of the Stow-installed skill inventory.

### Saved workflows

Saved definitions run through the `workflow` tool with `action: "run"`, a saved `name`, and workflow-specific `args`. This is read-mostly orchestration: workflow subagents cannot receive writable filesystem or shell capabilities. See the [workflow execution contract](agent/extensions/workflows/README.md#saved-workflows).

| Workflow                                                            | Purpose and input                                                                                   | Definition                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [deep-research](agent/extensions/workflows/README.md#deep-research) | Explicitly requested or approved public-web research; accepts a question string                     | [deep-research.js](agent/workflows/deep-research.js) |
| [review](agent/extensions/workflows/README.md#review)               | Independent review; requires prepared target, patch/context paths, and deterministic-check evidence | [review.js](agent/workflows/review.js)               |

### Prompt templates

Prompt templates expand reusable Markdown text through `/name`, where `name` is the filename without `.md`.

| Template                                      | Purpose                                                                                        | Invocation      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------- |
| [scan-secrets](agent/prompts/scan-secrets.md) | Read-only scan of branch changes and working-tree content for secrets and personal information | `/scan-secrets` |

### Themes

| Theme            | Purpose                     | File                                                        |
| ---------------- | --------------------------- | ----------------------------------------------------------- |
| Catppuccin Mocha | Dark terminal color palette | [catppuccin-mocha.json](agent/themes/catppuccin-mocha.json) |

Select a theme through Pi's `/settings`; the file's presence does not imply it is your active theme.

## Integrations

### Herdr integration

Herdr owns the generated Pi lifecycle bridge; the `herdr` and `spin-out` skills define local control procedures, and `ask-user` reports interactive questions through the bridge. See the [Herdr integration guide](docs/herdr.md) for installation, ownership, and remote-client setup.

#### macOS client with a Lima guest

Use a macOS-local Herdr remote client to bridge host images into the guest. The [Lima walkthrough](docs/herdr.md#macos-client-with-a-lima-guest) covers SSH setup, image transfer, and verification.

### External services and browser tooling

- **MCP Gateway:** see [gateway configuration](agent/extensions/mcp-gateway/README.md#configuration) for endpoint and environment-token setup. Gateway permissions do not replace user authorization for mutations.
- **Browser tooling:** see [optional integration setup](../README.md#browser-automation-and-web-rendering), [web-access](agent/extensions/web-access/README.md), and the [Playwright skill](agent/skills/playwright/SKILL.md).

## Migration notes

### Legacy workflow retirement

The `.design` workflow and Goal extension are retired. See [migration notes](docs/migrations.md) for configuration cleanup and preservation of historical artifacts, plus links to current ticket recovery procedures.
