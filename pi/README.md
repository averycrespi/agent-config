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
│   ├── scripts/        # Reusable validated tool compositions
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

| Extension                                                         | Purpose                                                                     | Main interface                                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [background](agent/extensions/background/README.md)               | Shared asynchronous execution lifetime, retained outcomes and notifications | [Host API](agent/extensions/background/API.md); Script background actions; `/background-config`; no separate tool            |
| [monitor](agent/extensions/monitor/README.md)                     | Bound polling, typed provider events, and settlement-based continuation     | `monitor`, [provider API](agent/extensions/monitor/API.md)                                                                   |
| [builtins](agent/extensions/builtins/README.md)                   | Compact builtin rendering and active stock tool composition                 | Automatic rendering; optional [Script provider](agent/extensions/builtins/README.md#script-provider)                         |
| [coordinate](agent/extensions/coordinate/README.md)               | Opt-in persistent coordinator/child roles and isolated launches             | `/coordinate-enable`, `/coordinate-disable`, `coordinate` status/spawn/complete                                              |
| [context-usage](agent/extensions/context-usage/README.md)         | Explain current context-window usage                                        | `/context-usage`                                                                                                             |
| [idle-compaction](agent/extensions/idle-compaction/README.md)     | Opt-in native compaction of unattended open terminal sessions               | `/idle-compaction-enable`, `/idle-compaction-disable`, `/idle-compaction-status`, `/idle-compaction-config`                  |
| [mailbox](agent/extensions/mailbox/README.md)                     | Durable local bounded coordination reports                                  | `mailbox`, optional [Script provider](agent/extensions/mailbox/README.md#script-provider), typed `mailbox.changed`           |
| [mcp-gateway](agent/extensions/mcp-gateway/README.md)             | Access authenticated external services through a gateway                    | `mcp_search`, `mcp_describe`, `mcp_call`, optional [Script provider](agent/extensions/mcp-gateway/README.md#script-provider) |
| [script](agent/extensions/script/README.md)                       | Run bounded JavaScript with explicitly selected extension capabilities      | `script`, `/script-config`, [host/provider API](agent/extensions/script/API.md)                                              |
| [statusline](agent/extensions/statusline/README.md)               | Show session, context, and model information                                | Automatic footer                                                                                                             |
| [structured-output](agent/extensions/structured-output/README.md) | Validate final output against a configured schema                           | `structured_output` when configured                                                                                          |
| [subagents](agent/extensions/subagents/README.md)                 | Delegate self-contained questions to isolated child agents                  | `subagent` (one background child and historical lifecycle controls)                                                          |
| [todo](agent/extensions/todo/README.md)                           | Track session tasks in a persistent list and widget                         | `todo`                                                                                                                       |
| [web-access](agent/extensions/web-access/README.md)               | Search the web and extract pages, repositories, and PDFs                    | `web_search`, `web_fetch`                                                                                                    |
| [workflows](agent/extensions/workflows/README.md)                 | Coordinate bounded research and review with JavaScript                      | `workflow`                                                                                                                   |

[Builtins](agent/extensions/builtins/README.md#script-provider) supplies active stock filesystem/shell methods, with structured results and direct-read image fallback. It replaces `compact-tools`; see its migration guidance before installing or reloading. Access requires global allowlisting and explicit selection, never implies user approval, and does not synthesize ordinary tool hooks.

Gateway supplies Script's optional `mcp.call` capability through the supported provider API. It requires trusted global allowlisting and per-execution selection; direct Gateway tools do not require Script, and provider-free Script does not require Gateway. Web-access independently supplies [`web.search` and `web.fetch`](agent/extensions/web-access/README.md#script-provider) with the same allowlisting/selection requirements; web-only scripts need no Gateway, and direct web tools need no Script tool. Host clones/spills do not expose guest filesystem access. Monitor supervises fresh Script evaluations and typed host subscriptions, including mailbox address-only hints backed by durable messages. It requires explicit provider selection/allowlisting and monitoring or continuation authority. Monitor replaces the retired observers; follow the [migration inventory and transition guide](docs/migrations.md#observer-retirement). Each provider's README has a **Script provider** entry point covering availability, methods/results, examples, permissions/effects, and failure/lifecycle semantics. Use Script discovery for current argument schemas and the [Script guide](agent/extensions/script/README.md) for shared execution rules.

For choosing between these mechanisms and their material authorization and ownership boundaries, see [Delegation and automation](../README.md#delegation-and-automation). Monitor observations are session-bound and do not resume after shutdown, reload or navigation. Its [global/environment configuration](agent/extensions/monitor/README.md#configuration) controls cycle and lifetime ceilings; `/monitor-config` inspects the loaded policy. Managed cross-process reporting requires loaded mailbox support and permitted, explicitly selected `mailbox` access for coordinator evaluators. Initial durable observation plus polling catches registration gaps and lost hints. The [recurring mailbox recipe](agent/extensions/mailbox/README.md#events-and-batching) batches new reports and delays reminders for missed ACKs without re-registering after normal handling; Monitor retains sole scheduling and finite lifetime/wake ownership. Worker identity is explicit in handoffs and verified through Herdr; no session provider or registry remains.

[Background](agent/extensions/background/README.md) must be loaded for Subagent/Workflow runs and optional Script `execution: "background"`. It owns persisted admission, below-editor rows and automatic terminal attention, not execution engines or observation scheduling. Terminal widget rows auto-hide after a configurable 15 seconds by default, without dismissing outcomes or changing notification/retention state; see [Background configuration](agent/extensions/background/README.md#configuration). Bounded results/accounting and larger adapter-owned result references remain inspectable; cancellation is not rollback and restoration never replays work. Historical observer receipts remain Monitor-owned.

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
| [spin-out](agent/skills/spin-out/SKILL.md)                   | Explicit worktree delegation; preserves active managed mode, otherwise standalone |
| [typesafe](agent/skills/typesafe/SKILL.md)                   | Building and evaluating TypeSafe AI integrations                                  |
| [wiki](agent/skills/wiki/SKILL.md)                           | Maintaining a persistent Markdown wiki from source documents                      |
| [work-stack](agent/skills/work-stack/SKILL.md)               | Coordinating an explicitly ordered stack with one isolated ticket child at a time |
| [work-ticket](agent/skills/work-ticket/SKILL.md)             | Owning one selected ticket through its authorized delivery boundary               |

The [review skill](agent/skills/review/SKILL.md) prepares evidence and invokes the saved `review` workflow below; they are guidance and executable orchestration for the same activity, not interchangeable entry points. Ticket publication, CI monitoring, repair, and recovery procedures belong to [work-ticket](agent/skills/work-ticket/SKILL.md), rather than this catalog.

[Coordinate](agent/extensions/coordinate/README.md) replaces the active coordinate-repo skill with human-enabled persistent role bindings and a thin status/spawn/complete tool. It keeps coordinator assignment/acceptance facts under Git's common directory and execution/evidence in child checkpoints. One request-local role reminder is refreshed before each model call. Mailbox reporting, existing recurring Monitor supervision and Herdr control remain separate; no automatic ACK, acceptance, scheduler or reload recovery effects are added. Installing/loading is not enabling or authority. Standalone spin-out remains standalone; [legacy recovery](agent/skills/coordinate-repo/RECOVERY.md) retains existing runs without automatic cutover.

[Work-stack](agent/skills/work-stack/SKILL.md) composes spin-out, work-ticket, Herdr and Monitor for one repository and a local-only or review-ready PR boundary. Its thin entry point applies serial policy directly to shared coordination/index, mailbox, questions, supervision and recovery mechanics, with no intermediate manager. The parent verifies predecessor commits and release evidence before advancing. Required primitives must already be loaded; installing the skill does not launch children or reload extensions. Stacked PR CI qualifies the recorded stack base, not independent readiness for main.

The repo-local [create-extension skill](../.pi/skills/create-extension/SKILL.md) is an authoring aid, not part of the Stow-installed skill inventory.

### Saved Scripts

[Saved Scripts](agent/extensions/script/README.md#saved-scripts) compose selected tool providers or pure computation without subagent reasoning. Use `script list`, `validate`, and `run` with a saved `name`, structured `args`, and explicit `providers`; foreground is default and background reuses the shared service. Definitions live in one configurable user store, default `<agentDir>/scripts`, and edits are visible on the next call. Stow installs definitions, but does not load new extension code into running sessions. Metadata never grants capabilities or approval and limits only narrow host policy.

| Definition                                               | Purpose                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [summarize-values.js](agent/scripts/summarize-values.js) | Generic bounded numeric summary, with no providers; accepts `{values: number[]}`. |

### Saved workflows

Saved definitions run asynchronously through the `workflow` tool with `action: "run"`, a saved `name`, and workflow-specific `args`. Background is mandatory for runs; the same workflow owns all its agents; use `executions`/`inspect`/`cancel`/`dismiss` for retained runs. Continue independent authorized work while awaiting automatic notification; yield when no useful independent work remains. This is read-mostly orchestration: workflow subagents cannot receive writable filesystem or shell capabilities. See the [workflow execution contract](agent/extensions/workflows/README.md#saved-workflows).

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

Herdr owns the generated Pi lifecycle bridge; the `herdr` and `spin-out` skills define local control procedures. Human questions use ordinary conversation, without extension-generated blocked signals. See the [Herdr integration guide](docs/herdr.md) for installation, ownership, and remote-client setup.

#### macOS client with a Lima guest

Use a macOS-local Herdr remote client to bridge host images into the guest. The [Lima walkthrough](docs/herdr.md#macos-client-with-a-lima-guest) covers SSH setup, image transfer, and verification.

### External services and browser tooling

- **MCP Gateway:** see [gateway configuration](agent/extensions/mcp-gateway/README.md#configuration) for endpoint and environment-token setup. Gateway permissions do not replace user authorization for mutations.
- **Browser tooling:** see [optional integration setup](../README.md#browser-automation-and-web-rendering), [web-access](agent/extensions/web-access/README.md), and the [Playwright skill](agent/skills/playwright/SKILL.md).

## Migration notes

### Legacy workflow retirement

The `.design` workflow and Goal extension are retired. See [migration notes](docs/migrations.md) for configuration cleanup and preservation of historical artifacts, plus links to current ticket recovery procedures.
