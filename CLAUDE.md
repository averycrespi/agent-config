# CLAUDE.md

Project-specific instructions for this repository.

## Overview

This repo manages configuration for two AI coding agents via [GNU Stow](https://www.gnu.org/software/stow/):

- `claude/` → symlinked to `~/.claude/` (Claude Code settings, skills, hooks, agents)
- `pi/agent/` → symlinked to `~/.pi/agent/` (Pi agent extensions, agents, skills)

## Broker Surface Distinction

Claude Code and Pi connect to the MCP broker differently:

- **Claude Code** gets broker-hosted tools directly from the MCP server, using names like `mcp__mcp-broker__github_pull_request_read` and `mcp__mcp-broker__git_push`. Claude skills must not refer to Pi-only meta-tools such as `mcp_search`, `mcp_describe`, or `mcp_call`.
- **Pi** uses the `pi/agent/extensions/mcp-broker/` extension, which exposes the broker through the agent tools `mcp_search`, `mcp_describe`, and `mcp_call`.

Keep docs under `claude/` written for Claude's direct MCP tool surface; keep docs under `pi/` written for Pi's broker extension surface.

## Public Repository Guidelines

This is a public repository. When creating or modifying content:

- **No internal details** - Don't reference specific companies, projects, team names, or internal URLs
- **No private data** - Don't include API keys, tokens, credentials, or sensitive configuration
- **Generic examples** - Use placeholders like `ABC-123` for tickets, `example.com` for domains
- **Sanitize plans** - Review `.plans/` and `.designs/` files before committing to ensure they contain no proprietary information

## Commands

```bash
make install-dev        # install Node dependencies and Husky git hooks
make install-playwright # install Playwright for browser automation
make stow-claude         # symlink claude/ into ~/.claude/
make stow-claude-sandbox # stow-claude + patch sandbox overrides
make stow-pi             # symlink pi/agent/ into ~/.pi/agent/
npm run lint            # lint Pi extension TypeScript files
npm run format:check    # check formatting for TS/JS/JSON/Markdown/YAML files
make typecheck          # type-check Pi extension TypeScript files
make test               # run all Pi extension unit tests
```

## Testing

Pure-logic tests run via Node's built-in `node:test` runner, loaded through `tsx` for TypeScript execution:

```bash
make test                                                    # run everything
npx tsx --test pi/agent/extensions/<ext>/*.test.ts           # run one extension
```

Test files import source with `.ts` extensions (e.g. `from "./state.ts"`). This requires `"allowImportingTsExtensions": true` in `tsconfig.json` — don't remove it or `make typecheck` will break.

**Before reporting any Pi extension change complete, run both `make typecheck` AND `make test`.** Typecheck alone catches type errors but not behavioral regressions — the tests cover pure logic that types can't verify.

## Skill Naming Convention

- **Workflow skills** (invoked to perform a task): use verb-object names when natural, or concise task nouns for broad workflows (e.g., `challenge-plan`, `review`)
- **Reference skills** (provide information/context): use nouns (e.g., `playwright`, `tdd`)

## Notes Format

Markdown notes in `notes/` use a consistent essay format:

- Start with a single H1 title; do not use frontmatter or metadata.
- Lead with a clear thesis or framing section, then develop the argument under short H2 headings.
- Keep the tone concise, opinionated, and evidence-backed; prefer concrete examples over generic explanation.
- Include counterarguments as `## The steelman`, `## Caveats`, or a similarly direct H2 when relevant.
- End with `## References` containing links and short descriptions; use relative links to other notes when relevant.

## Pi Extension Conventions

Use directory-based Pi extensions under `pi/agent/extensions/<name>/`.

Preferred structure:

- `index.ts` — extension entry point
- `README.md` — user-facing behavior, configuration, and usage
- `API.md` — optional programmatic integration docs for other extensions
- `api.ts` — optional curated public export surface referenced by `API.md`
- `*.test.ts` — colocated tests for meaningful logic
- additional `*.ts` files named by concern (`tools.ts`, `render.ts`, `state.ts`, etc.)

Repo-specific structure rules:

- Do not add top-level single-file Pi extensions under `pi/agent/extensions/*.ts` in this repo. Keep each extension in its own directory so colocated `*.test.ts` files are never mistaken for extension entrypoints.
- Put general cross-extension helpers in `pi/agent/extensions/_shared/`. Keep that directory loader-inert: do not add an `index.ts`.
- If shared code grows into a real library with its own conceptual surface, promote it to a top-level underscore-prefixed directory with an `api.ts` public surface instead of stretching `_shared/` into an ad hoc package.

Documentation split:

- Keep `README.md` focused on what the extension does for users and agents.
- Include a `## Prior art` section when an extension has meaningful public inspirations, adjacent projects, or conceptual antecedents. Link to resources or similar work, describe the specific influence in one sentence, and omit the section when there is no applicable public prior art. Verify newly discovered links with the user before adding them.
- If an extension exposes reusable code to other extensions, document imports, exports, types, and usage contracts in `API.md` instead of the README.
- Treat `api.ts` as the stable public surface. Anything not exported there should usually be treated as internal.

Implementation conventions:

- **`setWidget` cast pattern.** The typed signature lives at `pi.ui.setWidget` (on `ExtensionUIContext`), but the in-repo convention — used by `todo/index.ts` — is to call `(pi as any).setWidget(...)` at the top level, gated on `piAny.hasUI && typeof piAny.setWidget === "function"`. Match this pattern when adding sticky widgets in new extensions.
- **Shared render helpers.** For compact tool-call/result renderers, prefer helpers from `pi/agent/extensions/_shared/render.ts` instead of reimplementing common formatting, truncation, and partial-timer logic per extension.
- **Width-aware tool rendering.** Tool `renderCall` and `renderResult` implementations that display user/tool-provided strings should use `getTruncatedText(context.lastComponent, lines)` from `pi/agent/extensions/_shared/render.ts` instead of returning raw multi-line `Text`. This preserves compact logical lines, truncates at render width, handles tabs and ANSI resets safely, and avoids TUI wrapping. Use raw `Text` only when wrapping is intentional.
- **Shared config helpers.** For user-facing extension settings, prefer helpers from `pi/agent/extensions/_shared/config.ts` instead of hand-reading Pi settings files. Validate merged values at the extension boundary and fall back to defaults for invalid values.
- **Logging.** Prefer `pi/agent/extensions/_shared/logging.ts` for retained diagnostic logs. Avoid `console.*` in interactive TUI paths because it can corrupt the display; use `ctx.ui.notify` for user-visible issues, and reserve stderr/stdout writes for headless-only or last-resort diagnostics.
- **README config/logging docs.** Every extension README should document configuration and logging behavior. If an extension has no user-facing configuration or retained logs, say so explicitly. Every extension config field should have a corresponding environment variable override unless there is a strong reason not to expose one. When an extension has configurable settings, document them in one unified table with `Field`, `Default`, `Environment override`, and `Description` columns; settings fields use camelCase, environment variables use uppercase snake case, and environment variables override settings when set. Boolean environment overrides should accept both `1`/`true` and `0`/`false`. Include a short JSON settings example after the table. Document environment variables separately only when they do not map directly to settings fields. If it writes logs or temp output, document location, retention/deletion behavior, and whether raw tool/process output may be included.
- **Config inspection commands.** Every extension with user-facing configuration should register `/EXTENSION-NAME-config` via `pi/agent/extensions/_shared/config.ts` so users can inspect effective parsed config. Declare all sensitive fields explicitly so the shared helper masks secrets in command output.
- **Agent tool schema naming.** Typebox schemas exposed to the agent use snake_case (e.g. `failure_reason`); internal task/state fields stay camelCase (`failureReason`). Map between them in the tool's `execute` body.
- **Atomic agent-tool mutations.** When an agent tool mutates shared state (e.g. `task_list_set`'s `reconcile`), collect ALL validation errors before rejecting, apply changes atomically with a single `notify()` on success, and return errors as tool result text (not `throw`) so the agent can read and recover from them.
- **Stub Node built-ins via wrapper export.** `mock.method` from `node:test` can't replace ESM module exports — they're non-configurable bindings. To stub something like `child_process.spawn`, wrap the call in an exported holder (`export const _spawn = { fn: _nodeSpawn }`) and call through `_spawn.fn(...)`. Tests then `mock.method(_spawn, "fn", stub)`. See `subagents/spawn.ts:19-22` for the reference pattern.

## Modifying This Repository

- Edit Claude Code files in `claude/` directory
- Edit Pi agent files in `pi/` directory
- Only run `make stow-claude` or `make stow-pi` when the user explicitly asks you to

**IMPORTANT:** Never edit files directly in `~/.claude/` or `~/.pi/`. Those are symlinks managed by stow. Always edit the source files in this repository. For example:

- Edit `./claude/skills/foo.md`, NOT `~/.claude/skills/foo.md`
- Edit `./pi/agent/extensions/foo.ts`, NOT `~/.pi/agent/extensions/foo.ts`
