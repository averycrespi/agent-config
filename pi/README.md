# Pi Agent Configuration

This directory manages [Pi](https://pi.dev/) coding agent configuration files.

## Directory Structure

```
pi/agent/
├── AGENTS.md       # Agent instructions (task approach, git rules, style)
├── settings.json   # Provider, model, and thinking settings
├── extensions/     # TypeScript extensions, including centrally governed subagents
├── workflows/      # Reusable foreground orchestration scripts
├── prompts/        # Custom prompt templates
└── skills/         # Custom skills
```

## How It Works

Running `make stow-pi` creates symlinks from `pi/agent/` into `~/.pi/agent/`. Edits here take effect immediately — no need to re-stow after changing files.

## Herdr Integration

The Herdr integration has three distinct ownership boundaries:

- Repository-owned skills (`herdr` and `spin-out`) teach agents how to inspect and control Herdr sessions and manage Herdr-backed worktrees.
- The repository-owned `ask-user` extension emits balanced `herdr:blocked` events while an interactive question is open.
- Herdr owns the generated `herdr-agent-state.ts` lifecycle bridge. It reports Pi session identity and `working`, `blocked`, and `idle` state to the current Herdr pane.

Install or update the bridge after `make stow-pi` so Herdr writes it through the managed `~/.pi/agent/extensions` symlink:

```sh
herdr integration install pi
herdr integration status
```

The generated bridge is a local installer artifact: do not edit or commit it. Re-running the install command may overwrite it. Restart Pi or run `/reload` after installing or updating the bridge. The repository's provisioning script performs the installation automatically.

## Extensions

TypeScript modules that customize the Pi agent. Type-check with `make typecheck`.

| Extension           | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `ask-user`          | `ask_user` tool for multiple-choice questions                                                           |
| `compact-tools`     | Compact TUI rendering for built-in shell and file tools                                                 |
| `context-usage`     | `/context-usage` token-blame report for current context-window usage                                    |
| `goal`              | Fork-safe goals, bounded auto-run, and conservative evidence-backed completion                          |
| `mcp-broker`        | MCP broker meta-tools plus a bash guard for direct `gh` and remote-git operations                       |
| `scheduled-tasks`   | Markdown-defined recurring tasks with cron support, prechecks, manual runs, logs, and handoff state     |
| `statusline`        | Single-line footer with cwd, quota, context, model, and thinking                                        |
| `structured-output` | Schema-backed final output tool, no-op unless configured                                                |
| `subagents`         | Profile-routed isolated child dispatch with explicit read, write, shell, broker, and web capabilities   |
| `todo`              | Session-persisted TODO tool with a sticky widget                                                        |
| `web-access`        | Web search, fetch, GitHub, and PDF tools                                                                |
| `workflows`         | Compound discovery, validation, and foreground execution for reusable user-scoped read-mostly workflows |

Underscore-prefixed directories are libraries imported by sibling extensions, not extensions themselves — pi's extension loader skips them because they have no `index.ts`.

| Library   | Purpose                                    |
| --------- | ------------------------------------------ |
| `_shared` | Stateless helpers shared across extensions |

See [AGENTS.md](../AGENTS.md) for repo-specific authoring guidance.

## Saved Workflows

JavaScript orchestration definitions under `agent/workflows/` are installed into Pi's default saved-workflow store. They run through the `workflows` extension with the same sandbox, centrally resolved subagent capabilities/profiles, concurrency, budgets, and validation as inline workflows. Saved workflows reject mutable filesystem and shell capabilities. Plan execution keeps workspace mutation in the `advance-plan` main session; separate writable delegation requires an explicit bounded mechanism such as direct `spawn_agents` use or `spin-out`. Their `*.test.ts` files stay beside the definitions and are included in repository lint, typecheck, and test commands.

| Workflow        | Purpose                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `deep-research` | Research a question across public web sources and return a verified cited report.               |
| `review`        | Review caller-prepared change evidence through bounded independent lenses and one adjudication. |

Run definitions through the `workflow` tool with `action: "run"`, a saved `name`, and workflow-specific `args`. `deep-research` accepts a question string; `review` requires prepared target, patch/context-path, and deterministic-check evidence. The companion [`review` skill](agent/skills/review/SKILL.md) prepares that package for normal interactive use. See [the workflows README](agent/extensions/workflows/README.md#saved-workflows) for exact contracts and safety boundaries.

## Prompt Templates

Markdown snippets invoked with `/name` in Pi, where `name` is the filename without `.md`.

| Prompt template | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `scan-secrets`  | Scan branch or unpushed commits for secrets and personal information |

## Skills

Markdown skill packages that load on demand via progressive disclosure — only the `name` and `description` are pre-registered; the body of `SKILL.md` and any bundled `references/` files load only when the skill activates.

| Skill                     | Use when                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `agent-engineering`       | Designing, building, debugging, or reviewing AI coding agent harnesses and multi-phase workflows       |
| `architect`               | Designing a system or cross-cutting feature and decomposing it into bounded specifications             |
| `challenge`               | Stress-testing plans, proposals, designs, architecture decisions, and approaches before implementation |
| `clarify`                 | Resolving ambiguity and routing work to the appropriate design workflow without writing an artifact    |
| `create-html-artifact`    | Creating standalone HTML reports, explainers, visual plans, dashboards, slide decks, or tools          |
| `create-jira-ticket`      | Drafting and creating a Jira ticket via the `mcp-broker` extension's Atlassian namespace               |
| `create-skill`            | Creating a new skill or updating an existing one                                                       |
| `diagnose`                | Debugging bugs, failures, flaky behavior, regressions, or performance problems                         |
| `advance-plan`            | Advancing one Ready plan by one resumable task or milestone gate with durable state and verification   |
| `frontend-design`         | Building web components, pages, or applications that need distinctive, production-grade frontends      |
| `handoff`                 | Compacting a Pi session into a local `.handoffs/` document; explicit invocation only                   |
| `spin-out`                | Spinning out or delegating work to a new Pi agent in a Herdr worktree; activates only on explicit ask  |
| `herdr`                   | Controlling Herdr panes, agents, and workspaces, including Herdr-managed Git worktrees                 |
| `plan`                    | Turning one Ready specification into one milestone-structured autonomous implementation plan           |
| `playwright`              | Driving a browser for testing, form filling, screenshots, or data extraction                           |
| `review`                  | Preparing code-change evidence, invoking the saved review workflow, and presenting its findings        |
| `simplify`                | Explicitly testing pre-implementation artifacts for unnecessary complexity while preserving outcomes   |
| `specify`                 | Defining one bounded feature or change as a behavioral contract with observable acceptance criteria    |
| `test-driven-development` | Implementing a feature or bugfix that involves writing meaningful application logic                    |
| `wiki`                    | Maintaining a persistent markdown wiki from immutable source documents                                 |

Notes:

- Most skills are mirrored from the companion Claude Code configuration with Pi-platform adjustments (tool name swaps, mcp-broker meta-tools for MCP calls, GPT-5.x-friendly prose).
- `clarify` resolves ambiguity and routes work without writing a design artifact. `architect` writes high-level designs under `.design/architectures/` and decomposes them into specifications. `specify` writes one bounded behavioral contract under `.design/specs/`, and `plan` turns one Ready specification into a milestone-structured `.design/plans/` handoff and emits a minimal optional `/goal` invocation. `advance-plan` makes exactly one resumable task-or-gate step while the main session owns implementation, authoritative run state, verification, decisions, evidence, and commits. A goal can call that goal-agnostic primitive once per turn and map its reported outcome to continuation, yield, or completion. `challenge` stress-tests material failure risks, the explicit-only `simplify` skill tests for unnecessary complexity, and `review` evaluates completed changes.
- Hidden `.design/` files are local workflow artifacts. Promote canonical architecture decisions and user-facing contracts into the repository's tracked documentation during implementation.
- Skills adapted from external sources should include bare `ATTRIBUTION` and `LICENSE` files in the skill directory.
- See the [create-skill](agent/skills/create-skill/SKILL.md) skill when adding new skills.
