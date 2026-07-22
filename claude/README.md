# Claude Code Configuration

This directory manages Claude Code configuration files. Claude Code runs inside an isolated Linux sandbox (see the root `README.md`); this configuration targets that environment directly.

## Directory Structure

```
claude/
├── CLAUDE.md           # Global instructions for all projects
├── settings.json       # Permissions, hooks, and status line
├── agents/             # Custom agent definitions
├── commands/           # Reserved for slash command definitions
├── hooks/              # PreToolUse / PostToolUse hooks
├── scripts/            # Status line and other scripts
└── skills/             # Custom skill definitions
```

## How It Works

Running `make stow-claude` creates symlinks from `claude/` into `~/.claude/`. For example:

- `claude/settings.json` → `~/.claude/settings.json`
- `claude/skills/clarify/SKILL.md` → `~/.claude/skills/clarify/SKILL.md`

This means every Claude Code session on your machine picks up these settings, skills, and agents automatically.

## Structured Development Workflow

A workflow for reliably turning ideas into pull requests. It mirrors the lifecycle used by the companion Pi setup, adapted to Claude Code's native tools:

```
/clarify → /plan → /challenge-plan → /goal → /review → /completing-work
```

- **`/goal` is a native Claude Code command**, not a skill — it holds a completion condition across turns, auto-continues, and uses an independent evaluator to decide when the condition is met. `/plan` hands off to it with an acceptance-criteria-based condition.

**Use the structured workflow** when:

- Building a significant feature that spans multiple files
- You want independent, multi-dimension review of the result
- The implementation would benefit from upfront requirements exploration

**Use Claude Code's built-in planning mode** when:

- Making smaller, well-defined changes
- The scope is clear and doesn't need exploration

## Skills

### Structured Development Workflow

| Skill             | Purpose                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `clarify`         | Stateless requirements interview that resolves ambiguity before planning (no artifact)          |
| `plan`            | Turn clarified intent into a research-grounded, execution-ready plan with AC→verification       |
| `challenge-plan`  | Stress-test a plan against a rubric before an autonomous `/goal` run                            |
| `review`          | Non-destructive, target-parameterized review across parallel dimensions vs. acceptance criteria |
| `completing-work` | Clean up plan files, reflect on learnings, create or update PR                                  |

### Other Workflows

| Skill                     | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `assisting-research`      | Structured multi-session research with experiments and HTML reports    |
| `creating-html-artifacts` | Create standalone HTML reports, explainers, visual plans, decks, tools |
| `creating-jira-tickets`   | Draft and create well-structured Jira tickets                          |
| `visualize-plan`          | Turn a plan into a visual HTML document for easier human review        |
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

All hooks run in every session (Claude Code always runs sandboxed).

| Hook                         | Event       | Matcher     | Description                                                                                  |
| ---------------------------- | ----------- | ----------- | -------------------------------------------------------------------------------------------- |
| `scan-secrets-before-commit` | PreToolUse  | Bash        | Runs gitleaks on staged changes before `git commit`; blocks the commit if secrets are found  |
| `hint-gh-cli`                | PreToolUse  | Bash        | Allows `gh` CLI commands but injects a hint to prefer MCP tools (gh is unauthenticated here) |
| `hint-git-remote`            | PreToolUse  | Bash        | Allows `git push/pull/fetch/remote` but injects a hint to prefer MCP tools                   |
| `format-on-write`            | PostToolUse | Edit, Write | Auto-formats files after edits using Prettier, gofmt, rustfmt, or shfmt based on extension   |

## Status Line

A custom powerline-style status line (`scripts/statusline.sh`) configured via `settings.json`, with a purple "sandbox" badge prefix. Displays:

| Segment    | Description                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Model      | Current model name; green background when git is clean, yellow when dirty                      |
| Directory  | Working directory name                                                                         |
| Git branch | Branch name with compact status (ahead/behind, staged, modified counts)                        |
| Context    | Context window usage percentage; color shifts white → yellow → orange → red as usage increases |
| Session    | 5-hour rolling rate limit usage; same color scale as context                                   |
| Weekly     | 7-day rolling rate limit usage; same color scale as context                                    |

## Pi Parity Gaps

This configuration is derived from a companion Pi setup. A few Pi capabilities have no Claude Code equivalent, by design:

- **Structured final-output tool** — Pi's `structured-output` has no interactive analog. Use headless `--output-format json` or the `Workflow` tool's schema-backed subagents when structured output is needed.
- **Custom startup header** — the status line already shows repo, branch, and model.
- **Private context injection** — Pi's `extra-context` loads a private, uncommitted file every session. If needed, use an `@import` of a gitignored file from `CLAUDE.md`.
- **Scheduled tasks** — use the native `/schedule` command (cloud routines) instead of Pi's local cron runner.
- **Completion gate** — native `/goal`'s evaluator is lighter than Pi's fail-closed code-reviewer gate (it reads the conversation rather than running commands). Run the `review` skill for a full independent review.

## Attribution

- Structured-workflow skills originally adapted from [superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT), since substantially reworked to mirror the Pi lifecycle
- `skill-creator` adapted from [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skill-creator) (Apache 2.0)
- `frontend-design` adapted from [Anthropic's frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) (Apache 2.0)
- `playwright-cli` derived from [playwright-cli](https://github.com/microsoft/playwright-cli) by Microsoft (Apache 2.0)
- Status line script adapted from [claude-code-tools](https://github.com/pchalasani/claude-code-tools) by Prasad Chalasani (MIT)
