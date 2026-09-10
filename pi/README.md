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

| Extension                                                         | Purpose                                                              | Main interface                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| [ask-user](agent/extensions/ask-user/README.md)                   | Ask focused multiple-choice questions                                | `ask_user`                               |
| [code-mode](agent/extensions/code-mode/README.md)                 | Compose gateway calls and return compact results                     | `code`                                   |
| [compact-tools](agent/extensions/compact-tools/README.md)         | Keep built-in tool output compact                                    | Automatic tool rendering                 |
| [context-usage](agent/extensions/context-usage/README.md)         | Explain current context-window usage                                 | `/context-usage`                         |
| [loop](agent/extensions/loop/README.md)                           | Continue the current session within explicit limits                  | `loop`, `/loop`                          |
| [mcp-gateway](agent/extensions/mcp-gateway/README.md)             | Access authenticated external services through a gateway             | `mcp_search`, `mcp_describe`, `mcp_call` |
| [monitor](agent/extensions/monitor/README.md)                     | Watch gateway conditions without recurring model turns while waiting | `monitor`, `/monitor`                    |
| [scheduled-tasks](agent/extensions/scheduled-tasks/README.md)     | Run recurring Markdown-defined tasks with retained run artifacts     | `scheduled_tasks`                        |
| [statusline](agent/extensions/statusline/README.md)               | Show session, context, and model information                         | Automatic footer                         |
| [structured-output](agent/extensions/structured-output/README.md) | Validate final output against a configured schema                    | `structured_output` when configured      |
| [subagents](agent/extensions/subagents/README.md)                 | Delegate self-contained questions to isolated child agents           | `spawn_agents`                           |
| [todo](agent/extensions/todo/README.md)                           | Track session tasks in a persistent list and widget                  | `todo`                                   |
| [web-access](agent/extensions/web-access/README.md)               | Search the web and extract pages, repositories, and PDFs             | `web_search`, `web_fetch`                |
| [workflows](agent/extensions/workflows/README.md)                 | Coordinate bounded research and review with JavaScript               | `workflow`                               |

For choosing between these mechanisms and their material authorization and ownership boundaries, see [Delegation and automation](../README.md#delegation-and-automation). Monitor observations are session-bound and do not automatically resume after shutdown, reload, or navigation.

[`_shared/`](agent/extensions/_shared/README.md) contains helpers imported by sibling extensions, not a separately loaded extension. Extension authoring conventions and required checks live in the [repository guidance](../AGENTS.md#authoring-guidance).

### Skills

Skills provide on-demand guidance, not additional tools by themselves. Pi discovers skill descriptions and loads the body when needed; invoke one explicitly with `/skill:name` or let the agent select a matching skill. Explicit-only skills still require a user request. See each linked skill for its full contract and any attribution or license files in its directory.

| Skill                                                        | Use it for                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [agent-engineering](agent/skills/agent-engineering/SKILL.md) | Design and analysis of coding-agent harnesses and workflows                  |
| [challenge](agent/skills/challenge/SKILL.md)                 | Stress-testing a concrete approach before implementation                     |
| [clarify](agent/skills/clarify/SKILL.md)                     | Researching ambiguity and asking focused questions                           |
| [create-skill](agent/skills/create-skill/SKILL.md)           | Creating or updating skills                                                  |
| [diagnose](agent/skills/diagnose/SKILL.md)                   | Investigating failures, regressions, and performance problems                |
| [frontend-design](agent/skills/frontend-design/SKILL.md)     | Building distinctive production-grade web interfaces                         |
| [handoff](agent/skills/handoff/SKILL.md)                     | Explicitly requested session handoffs in `.handoffs/`                        |
| [herdr](agent/skills/herdr/SKILL.md)                         | Terminal, agent, and Git worktree control through Herdr                      |
| [plane](agent/skills/plane/SKILL.md)                         | Safe access to Plane through MCP Gateway                                     |
| [playwright](agent/skills/playwright/SKILL.md)               | Browser automation, testing, and extraction                                  |
| [review](agent/skills/review/SKILL.md)                       | Preparing evidence and invoking independent change review                    |
| [shape-ticket](agent/skills/shape-ticket/SKILL.md)           | Preparing and explicitly approving a verifiable Plane ticket                 |
| [simplify](agent/skills/simplify/SKILL.md)                   | Explicitly requested checks for unnecessary complexity before implementation |
| [spin-out](agent/skills/spin-out/SKILL.md)                   | Explicitly requested delegation to a fresh agent in a Herdr worktree         |
| [wiki](agent/skills/wiki/SKILL.md)                           | Maintaining a persistent Markdown wiki from source documents                 |
| [work-ticket](agent/skills/work-ticket/SKILL.md)             | Owning one selected ticket through its authorized delivery boundary          |

The [review skill](agent/skills/review/SKILL.md) prepares evidence and invokes the saved `review` workflow below; they are guidance and executable orchestration for the same activity, not interchangeable entry points. Ticket publication, CI monitoring, repair, and recovery procedures belong to [work-ticket](agent/skills/work-ticket/SKILL.md), rather than this catalog.

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
