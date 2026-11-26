# AGENTS.md

## Repository and Scope

This public repository manages Pi and Claude Code configuration through GNU Stow: `pi/agent/` is linked into `~/.pi/agent/`, and `claude/` is linked into `~/.claude/`.

- Edit Stow-managed configuration at its source under `pi/`, not through `~/.pi/` symlinks. For example, edit `pi/agent/extensions/<name>/index.ts`. Repo-local authoring skills live under `.pi/skills/` and are not installed globally.
- Edit Claude Code configuration at its source under `claude/`. The Herdr hook in `claude/hooks/` is vendored from `herdr integration install claude`; do not run that command against the real `~/.claude/`, and refresh the hook as described in `claude/README.md`.
- Installing/linking Pi or Claude Code configuration, global/system installations, and changes to running sessions require explicit user authorization. Run `make stow-pi` or `make stow-claude` only when explicitly requested. Required checkout-local development dependency setup is part of authorized implementation and verification; follow the setup guidance below.
- Prefer native `git` for clone, fetch, pull, push and remote queries. In Pi sessions, keep GitHub API operations and other authenticated services on MCP Gateway (`mcp_search`, `mcp_describe`, `mcp_call`), not direct `gh`; keep that guidance aligned with `pi/agent/AGENTS.md` and `pi/agent/extensions/mcp-gateway/`. Claude Code sessions have no MCP Gateway and use the `gh` CLI for GitHub API operations such as pull requests and CI status.
- In the configured runtime, HTTP(S) and Git traffic is routed through the agent gateway, which applies access policy and injects credentials for configured destinations. Use ordinary URLs; do not locate, extract or manually supply credentials, bypass the gateway or change authentication to work around access failures. Diagnose failures; authentication does not authorize publication or destructive operations.
- Exclude private/internal identifiers, URLs, credentials, and proprietary information from committed content. Public dependencies and prior art may be named. Use generic examples such as `ABC-123` and `example.com`; sanitize design artifacts before committing.

## README Purpose

- Keep the root `README.md` a short, high-level orientation across both agents: what the repository is, what each agent directory provides, shared installation steps, development checks, and where to learn more. Make clear that each agent is installed separately and personal settings and credentials are not supplied by the repository.
- Keep agent-specific detail out of the root README. Pi setup, usage guidance, delegation and automation choices, and integration setup belong in `pi/README.md`; Claude Code detail belongs in `claude/README.md`. Link to those sources instead.
- Describe components by purpose before introducing tool names, and present development activities as optional rather than a mandatory pipeline.
- Keep `pi/README.md` a current, linked setup guide, component catalog and configuration reference. Group delegation and automation by the reader's goal (delegate reasoning, continue/watch work, or compose external tool calls), preserving material authorization, ownership and lifecycle boundaries without reproducing detailed execution policies. Keep detailed execution contracts in skill/extension docs and integration walkthroughs and migration procedures in `pi/docs/`. Preserve useful incoming section links when reorganizing.
- Keep the linked main-branch CI badge directly beneath the title, and keep installation commands and verification guidance aligned with repository tooling.

## Authoring Guidance

- For creating or modifying Pi extension code, tests, documentation, tools, rendering, configuration, or lifecycle behavior, read [.pi/skills/create-extension/SKILL.md](.pi/skills/create-extension/SKILL.md). Load it by path if it is absent from the skill catalog; do not change project trust or reload the session to discover it.
- Read the affected extension's README, DESIGN, and API documentation as applicable. Keep its user-facing contracts and architectural invariants aligned with changes.
- Use directory-based extensions under `pi/agent/extensions/<name>/` with an `index.ts` entry point and colocated tests. Never add top-level `pi/agent/extensions/*.ts` files; tests there can be mistaken for extensions.
- Keep shared helpers in `pi/agent/extensions/_shared/` loader-inert: no `index.ts` or `package.json` entry point. Prefer existing render, config, and logging helpers.
- Sanitize and bound external display strings before terminal styling; never expose secrets in tool rows, config inspection, or diagnostics. Invalid configuration must not silently relax security restrictions.
- Validate shared-state mutations before applying them atomically; validation failure must leave state unchanged.

## Commands and Verification

```bash
make install-dev        # install Node dependencies and Husky hooks
make install-playwright # install browser tooling and dependencies
make stow-pi            # link configuration; explicit request required
npm run lint            # lint extension, saved-workflow and saved-Script TypeScript
npm run format:check    # check TS/JS/JSON/Markdown/YAML formatting
make typecheck          # type-check TypeScript
make test               # run extension, saved-workflow, saved-Script and skill tests
```

- Check dependency availability before running tools in a fresh checkout/worktree. Inspect package scripts and setup effects, then install the declared locked development dependencies when needed (`npm ci` for this repository). Preserve the lockfile and unrelated work; do not silently upgrade dependencies, run audit fixes, or expand setup into global/system installation, Pi configuration linking, or live-session changes. Account for lifecycle scripts such as Husky setup and ask only when their effects exceed the authorized scope. After setup, continue the already-authorized implementation and verification; missing dependencies alone are not a reason to hand work back.
- For extension, saved-workflow or saved-Script code and runtime-affecting configuration changes, run both `make typecheck` and `make test`, plus lint and formatting checks, before reporting completion. Preserve applicable review and CI gates.
- For documentation-only changes, check formatting and affected paths, links, and examples. For skill/prompt changes, also check instruction compatibility and relevant discovery or structural validation; do not claim structural checks prove model behavior.
- Tests use Node's `node:test` runner through `tsx`. Preserve `.ts` source imports and `allowImportingTsExtensions` in `tsconfig.json`.
- Keep saved-workflow tests beside their `*.js` definitions in `pi/agent/workflows/`; load the actual definition through the generic runtime in `pi/agent/extensions/workflows/`. Apply the same convention to saved Scripts in `pi/agent/scripts/` using the generic Script runtime. Keep lint, typecheck, test, and lint-staged globs covering both directories.
- Run focused tests during development with `npx tsx --test pi/agent/extensions/<name>/*.test.ts` or `npx tsx --test pi/agent/workflows/<name>.test.ts`; these do not replace required full checks for code changes.

## Skills

- Name workflow skills with verb-object names when natural or concise task names; name reference skills with nouns. Use `create-skill` when authoring skills.
