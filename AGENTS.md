# AGENTS.md

## Repository and Scope

This public repository manages Pi configuration through GNU Stow: `pi/agent/` is linked into `~/.pi/agent/`.

- Edit Stow-managed configuration at its source under `pi/`, not through `~/.pi/` symlinks. For example, edit `pi/agent/extensions/<name>/index.ts`. Repo-local authoring skills live under `.pi/skills/` and are not installed globally.
- Installations and changes to running sessions require explicit user authorization. Run `make stow-pi` only when explicitly requested.
- Keep authenticated external access and its documentation aligned with `pi/agent/extensions/mcp-gateway/` and the `mcp_search`, `mcp_describe`, and `mcp_call` tools.
- Exclude private/internal identifiers, URLs, credentials, and proprietary information from committed content. Public dependencies and prior art may be named. Use generic examples such as `ABC-123` and `example.com`; sanitize design artifacts before committing.

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
npm run lint            # lint extension and saved-workflow TypeScript
npm run format:check    # check TS/JS/JSON/Markdown/YAML formatting
make typecheck          # type-check TypeScript
make test               # run extension, saved-workflow, and skill tests
```

- For extension or saved-workflow code and runtime-affecting configuration changes, run both `make typecheck` and `make test`, plus lint and formatting checks, before reporting completion. Preserve applicable review and CI gates.
- For documentation-only changes, check formatting and affected paths, links, and examples. For skill/prompt changes, also check instruction compatibility and relevant discovery or structural validation; do not claim structural checks prove model behavior.
- Tests use Node's `node:test` runner through `tsx`. Preserve `.ts` source imports and `allowImportingTsExtensions` in `tsconfig.json`.
- Keep saved-workflow tests beside their `*.js` definitions in `pi/agent/workflows/`; load the actual definition through the generic runtime in `pi/agent/extensions/workflows/`. Keep lint, typecheck, test, and lint-staged globs covering this directory.
- Run focused tests during development with `npx tsx --test pi/agent/extensions/<name>/*.test.ts` or `npx tsx --test pi/agent/workflows/<name>.test.ts`; these do not replace required full checks for code changes.

## Skills and Notes

- Name workflow skills with verb-object names when natural or concise task names; name reference skills with nouns. Use `create-skill` when authoring skills.
- Write `notes/` as concise, opinionated, evidence-backed essays: one H1, no frontmatter, a clear opening thesis, short H2 sections, and concrete examples. Include a steelman or caveats when relevant; end with `## References` containing links and short descriptions, using relative links for other notes.
