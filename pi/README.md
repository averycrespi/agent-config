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

## Extensions

TypeScript modules that customize the Pi agent. Type-check with `make typecheck`.

| Extension           | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `ask-user`          | `ask_user` tool for multiple-choice questions                                                           |
| `compact-tools`     | Compact TUI rendering for built-in shell and file tools                                                 |
| `context-usage`     | `/context-usage` token-blame report for current context-window usage                                    |
| `extra-context`     | User-configured additional context files injected into sessions that load the extension                 |
| `goal`              | Fork-safe goals, bounded auto-run, and optional fail-closed independent completion review               |
| `mcp-broker`        | MCP broker meta-tools plus a bash guard for direct `gh` and remote-git operations                       |
| `scheduled-tasks`   | Markdown-defined recurring tasks with cron support, prechecks, manual runs, logs, and handoff state     |
| `statusline`        | Single-line footer with cwd, quota, context, model, and thinking                                        |
| `startup-header`    | Minimal colored startup header with Pi version, repo, branch, and recent commits                        |
| `structured-output` | Schema-backed final output tool, no-op unless configured                                                |
| `subagents`         | Explicit capability/tier/thinking policy and isolated child dispatch                                    |
| `todo`              | Session-persisted TODO tool with a sticky widget                                                        |
| `web-access`        | Web search, fetch, GitHub, and PDF tools                                                                |
| `workflows`         | Compound discovery, validation, and foreground execution for reusable user-scoped read-mostly workflows |

Underscore-prefixed directories are libraries imported by sibling extensions, not extensions themselves — pi's extension loader skips them because they have no `index.ts`.

| Library   | Purpose                                    |
| --------- | ------------------------------------------ |
| `_shared` | Stateless helpers shared across extensions |

See [AGENTS.md](../AGENTS.md) for repo-specific authoring guidance.

## Saved Workflows

JavaScript orchestration definitions under `agent/workflows/` are installed into Pi's default saved-workflow store. They run through the `workflows` extension with the same sandbox, centrally resolved subagent capabilities/model tiers/thinking, concurrency, budgets, and validation as inline workflows. Their `*.test.ts` files stay beside the definitions and are included in repository lint, typecheck, and test commands.

| Workflow        | Purpose                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| `deep-research` | Research a question across public web sources and return a verified cited report. |

Run it through the `workflow` tool with `action: "run"`, `name: "deep-research"`, and the research question as `args`. See [the workflows README](agent/extensions/workflows/README.md#shipped-saved-workflows) for its evidence policy, limits, output contract, and public-web safety boundary.

## Prompt Templates

Markdown snippets invoked with `/name` in Pi, where `name` is the filename without `.md`.

| Prompt template | Purpose                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `refresh`       | Reconstruct current branch context from git history and an open PR, if any |
| `scan-secrets`  | Scan branch or unpushed commits for secrets and personal information       |

## Skills

Markdown skill packages that load on demand via progressive disclosure — only the `name` and `description` are pre-registered; the body of `SKILL.md` and any bundled `references/` files load only when the skill activates.

| Skill                     | Use when                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `agent-engineering`       | Designing, building, debugging, or reviewing AI coding agent harnesses and multi-phase workflows     |
| `challenge-plan`          | Stress-testing, challenging, reviewing, repairing, or grilling a plan before execution               |
| `clarify`                 | Interviewing through fuzzy requirements, scope, behavior, edge cases, and acceptance criteria        |
| `create-html-artifact`    | Creating standalone HTML reports, explainers, visual plans, dashboards, slide decks, or tools        |
| `create-jira-ticket`      | Drafting and creating a Jira ticket via the `mcp-broker` extension's Atlassian namespace             |
| `create-skill`            | Creating a new skill or updating an existing one                                                     |
| `diagnose`                | Debugging bugs, failures, flaky behavior, regressions, or performance problems                       |
| `frontend-design`         | Building web components, pages, or applications that need distinctive, production-grade frontends    |
| `plan`                    | Creating research-grounded implementation plans from clarified intent for autonomous `/goal` handoff |
| `playwright`              | Driving a browser for testing, form filling, screenshots, or data extraction                         |
| `review`                  | Reviewing a PR, branch, commit range, working tree, plan, document, or unit of work holistically     |
| `test-driven-development` | Implementing a feature or bugfix that involves writing meaningful application logic                  |
| `visualize-plan`          | Turning plans into visual HTML artifacts for easier human review                                     |

Notes:

- Most skills are mirrored from `claude/skills/` with Pi-platform adjustments (tool name swaps, mcp-broker meta-tools for MCP calls, GPT-5.x-friendly prose).
- Collaborative clarification lives in the `clarify` skill; durable implementation planning lives in `plan`; `challenge-plan` stress-tests plans before autonomous execution, and `goal` drives execution/completion evidence.
- Skills adapted from external sources should include bare `ATTRIBUTION` and `LICENSE` files in the skill directory.
- See the [create-skill](agent/skills/create-skill/SKILL.md) skill when adding new skills.
