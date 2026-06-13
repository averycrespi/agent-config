# Claude Code Configuration

This directory manages Claude Code configuration files.

## Directory Structure

```
claude/
├── CLAUDE.md           # Global instructions for all projects
├── settings.json       # Permissions and hooks
├── agents/             # Custom agent definitions
├── commands/           # Reserved for slash command definitions
├── hooks/              # PreToolUse hooks (e.g., gitleaks)
├── sandbox/            # Sandbox overrides (settings, CLAUDE.md, scripts)
├── scripts/            # Status line and other scripts
└── skills/             # Custom skill definitions
```

## How It Works

Running `make stow-claude` creates symlinks from `claude/` into `~/.claude/`. Use `make stow-claude-sandbox` instead to install the sandbox overrides too. For example:

- `claude/settings.json` → `~/.claude/settings.json`
- `claude/skills/brainstorming/SKILL.md` → `~/.claude/skills/brainstorming/SKILL.md`

This means every Claude Code session on your machine picks up these settings, skills, and agents automatically.

## Structured Development Workflow

A workflow for reliably turning ideas into pull requests, adapted from [superpowers](https://github.com/obra/superpowers).

```
/brainstorming → /writing-plans → /executing-plans → /verifying-work → /completing-work
```

**Use the structured workflow** when:

- Building a significant feature that spans multiple files
- You want independent code reviews after each task
- The implementation would benefit from upfront design discussion

**Use Claude Code's built-in planning mode** when:

- Making smaller, well-defined changes
- The scope is clear and doesn't need exploration

## Skills

### Structured Development Workflow

| Skill                     | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `brainstorming`           | Turn ideas into designs through collaborative dialogue                      |
| `writing-plans`           | Create detailed implementation plans with TDD steps                         |
| `executing-plans`         | Execute plans with subagent implementation + reviews                        |
| `executing-plans-quickly` | Execute plans inline without subagents for simple tasks                     |
| `verifying-work`          | Holistic review with parallel reviewers, auto-fix loop, and user escalation |
| `completing-work`         | Clean up plans, reflect on learnings, create or update PR                   |

### Other Workflows

| Skill                     | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `assisting-research`      | Structured multi-session research with experiments and HTML reports    |
| `creating-html-artifacts` | Create standalone HTML reports, explainers, visual plans, decks, tools |
| `creating-jira-tickets`   | Draft and create well-structured Jira tickets                          |
| `reviewing-prs`           | Holistic PR review across 6 parallel dimensions                        |
| `troubleshooting`         | Battle buddy for incident response and system troubleshooting          |
| `using-hindsight`         | Retain and query Hindsight memories through MCP broker tools           |

### Reference Skills

| Skill                     | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `frontend-design`         | Distinctive, production-grade frontend design and building |
| `playwright-cli`          | Browser automation for testing and data extraction         |
| `skill-creator`           | Guide for creating new skills                              |
| `test-driven-development` | TDD discipline: red-green-refactor cycle                   |

## Hooks

| Hook                         | Event        | Matcher     | Description                                                                                 |
| ---------------------------- | ------------ | ----------- | ------------------------------------------------------------------------------------------- |
| `scan-secrets-before-commit` | PreToolUse   | Bash        | Runs gitleaks on staged changes before `git commit`; blocks the commit if secrets are found |
| `format-on-write`            | PostToolUse  | Edit, Write | Auto-formats files after edits using Prettier, gofmt, rustfmt, or shfmt based on extension  |
| Notification sound           | Notification | all         | Sends a macOS notification and plays a sound when Claude needs attention                    |
| Stop sound                   | Stop         | all         | Sends a macOS notification and plays a sound when Claude finishes                           |

## Status Line

A custom powerline-style status line (`scripts/statusline.sh`) configured via `settings.json`. Displays:

| Segment    | Description                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Model      | Current model name; green background when git is clean, yellow when dirty                      |
| Directory  | Working directory name                                                                         |
| Git branch | Branch name with compact status (ahead/behind, staged, modified counts)                        |
| Context    | Context window usage percentage; color shifts white → yellow → orange → red as usage increases |
| Session    | 5-hour rolling rate limit usage; same color scale as context                                   |
| Weekly     | 7-day rolling rate limit usage; same color scale as context                                    |

The sandbox variant (`scripts/statusline-sandbox.sh`) adds a purple "sandbox" badge prefix.

## Sandbox

The `sandbox/` directory provides overrides for Claude Code's [sandbox mode](https://docs.anthropic.com/en/docs/claude-code/security#sandbox-mode) (remote/headless environments). When running in a sandbox, these files replace the default configuration.

### Overrides

| File                            | Purpose                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `sandbox/settings.json`         | Sandbox-specific settings; skips dangerous-mode prompt, removes allow/deny lists |
| `sandbox/CLAUDE.md`             | Simplified instructions for the sandbox environment                              |
| `scripts/statusline-sandbox.sh` | Status line variant with a "sandbox" prefix badge                                |

### Additional Hooks

These hooks are only active in the sandbox (configured in `sandbox/settings.json`):

| Hook                         | Event      | Matcher | Description                                                                |
| ---------------------------- | ---------- | ------- | -------------------------------------------------------------------------- |
| `hint-gh-cli-in-sandbox`     | PreToolUse | Bash    | Allows `gh` CLI commands but injects a hint to prefer MCP tools instead    |
| `hint-git-remote-in-sandbox` | PreToolUse | Bash    | Allows `git push/pull/fetch/remote` but injects a hint to prefer MCP tools |

The sandbox also inherits `scan-secrets-before-commit` and `format-on-write` from the main hooks.

## Attribution

- Workflow skills adapted from [superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT)
- `skill-creator` adapted from [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skill-creator) (Apache 2.0)
- `frontend-design` adapted from [Anthropic's frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) (Apache 2.0)
- `playwright-cli` derived from [playwright-cli](https://github.com/microsoft/playwright-cli) by Microsoft (Apache 2.0)
- Status line script adapted from [claude-code-tools](https://github.com/pchalasani/claude-code-tools) by Prasad Chalasani (MIT)
