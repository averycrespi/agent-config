# CLAUDE.md (Sandbox)

## Sandbox Environment

Isolated Linux VM (Ubuntu 24.04). Full permissions — install packages, run any commands, use Docker freely. No permission prompts. Sandbox hooks still run for secret scanning, formatting, and MCP tool guidance.

## MCP Usage

**Delegate to a subagent** any MCP call that returns verbose output: searches, document reads, multi-step lookups (2+ calls). Subagent returns a concise summary, not raw output. **OK to call directly:** single-resource lookups needing one or two fields.

## Sorting

When sorting items alphabetically or numerically, always use `sort` (or equivalent shell command) — never sort by hand or from memory.

## Conventional Commits

Use conventional commits: `<type>(<optional scope>): <description>`. Types: feat, fix, chore, docs, refactor, test. Imperative mood, under 50 chars, no trailing period.
