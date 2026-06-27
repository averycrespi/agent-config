# Pi Agent Configuration

This directory manages [Pi](https://pi.dev/) coding agent configuration files.

## Directory Structure

```
pi/agent/
├── AGENTS.md       # Agent instructions (task approach, git rules, style)
├── settings.json   # Provider, model, and thinking settings
├── agents/         # Subagent definitions (explore, research, deep-research, review)
├── extensions/     # TypeScript extensions
├── prompts/        # Custom prompt templates
└── skills/         # Custom skills
```

## How It Works

Running `make stow-pi` creates symlinks from `pi/agent/` into `~/.pi/agent/`. Edits here take effect immediately — no need to re-stow after changing files.

## Extensions

TypeScript modules that customize the Pi agent. Type-check with `make typecheck`.

| Extension         | Purpose                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `ask-user`        | `ask_user` tool for multiple-choice questions                                                       |
| `compact-tools`   | Compact TUI rendering for built-in shell and file tools                                             |
| `context`         | `/context` token-blame report for current context-window usage                                      |
| `goal`            | Branch-scoped persistent goal steering with commands, tools, widget, and compaction context         |
| `mcp-broker`      | MCP broker meta-tools plus a bash guard for direct `gh` and remote-git operations                   |
| `scheduled-tasks` | Markdown-defined recurring tasks with cron support, prechecks, manual runs, logs, and handoff state |
| `statusline`      | Single-line footer with cwd, quota, context, model, and thinking                                    |
| `startup-header`  | Minimal colored startup header with Pi version, repo, branch, and recent commits                    |
| `subagents`       | Dynamic subagent loading and dispatch                                                               |
| `todo`            | Session-persisted TODO tool with a sticky widget                                                    |
| `web-access`      | Web search, fetch, GitHub, and PDF tools                                                            |
| `workflows`       | Foreground JavaScript workflows that orchestrate read-mostly subagents                              |

Underscore-prefixed directories are libraries imported by sibling extensions, not extensions themselves — pi's extension loader skips them because they have no `index.ts`.

| Library   | Purpose                                    |
| --------- | ------------------------------------------ |
| `_shared` | Stateless helpers shared across extensions |

See [AGENTS.md](../AGENTS.md) for repo-specific authoring guidance.

## Prompt Templates

Markdown snippets invoked with `/name` in Pi, where `name` is the filename without `.md`.

| Prompt template | Purpose                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `refresh`       | Reconstruct current branch context from git history and an open PR, if any |
| `scan-secrets`  | Scan branch or unpushed commits for secrets and personal information       |

## Skills

Markdown skill packages that load on demand via progressive disclosure — only the `name` and `description` are pre-registered; the body of `SKILL.md` and any bundled `references/` files load only when the skill activates.

| Skill                     | Use when                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `agent-engineering`       | Designing, building, debugging, or reviewing AI coding agent harnesses and multi-phase workflows      |
| `challenge-plan`          | Stress-testing, challenging, reviewing, repairing, or grilling a plan before execution                |
| `complete-work`           | Finishing verified implementation work, cleaning plan artifacts, and choosing branch or PR steps      |
| `create-html-artifact`    | Creating standalone HTML reports, explainers, visual plans, dashboards, slide decks, or tools         |
| `create-jira-ticket`      | Drafting and creating a Jira ticket via the `mcp-broker` extension's Atlassian namespace              |
| `create-skill`            | Creating a new skill or updating an existing one                                                      |
| `diagnose`                | Debugging bugs, failures, flaky behavior, regressions, or performance problems                        |
| `frontend-design`         | Building web components, pages, or applications that need distinctive, production-grade frontends     |
| `hindsight`               | Retaining and querying Hindsight memories via the mcp-broker `hindsight` namespace                    |
| `plan`                    | Creating research-grounded, question-driven implementation plans ready for autonomous `/goal` handoff |
| `playwright`              | Driving a browser for testing, form filling, screenshots, or data extraction                          |
| `review`                  | Reviewing a PR, branch, commit range, working tree, plan, document, or unit of work holistically      |
| `test-driven-development` | Implementing a feature or bugfix that involves writing meaningful application logic                   |
| `visualize-plan`          | Turning plans into visual HTML artifacts for easier human review                                      |

Notes:

- Most skills are mirrored from `claude/skills/` with Pi-platform adjustments (tool name swaps, mcp-broker meta-tools for MCP calls, GPT-5.x-friendly prose).
- Collaborative planning lives in the `plan` skill; `challenge-plan` stress-tests plans before autonomous execution, and `goal` drives execution/completion evidence.
- Skills adapted from external sources should include bare `ATTRIBUTION` and `LICENSE` files in the skill directory.
- See the [create-skill](agent/skills/create-skill/SKILL.md) skill when adding new skills.
