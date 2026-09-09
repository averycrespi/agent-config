---
name: create-extension
description: Use when creating or modifying Pi extensions in this repository, including existing extension code, tests, documentation, tools, rendering, configuration, shared helpers, and lifecycle behavior. Do not use for unrelated skills, prompts, notes, or saved-workflow definitions.
---

# Create Extension

Apply this repository's extension conventions to new and existing extensions. Keep the work within the authorized scope; use only the sections relevant to the change rather than expanding a small edit into a full extension overhaul. Resolve the repository root as `../../..` from this skill directory; paths beginning `pi/` below are repository-relative, while Markdown links are skill-relative.

## Establish the Contract

1. Read [repository instructions](../../../AGENTS.md) and the affected extension's README, DESIGN, API, code, and tests as applicable. Identify observable acceptance criteria and preserve existing behavior outside the requested change.
2. Read the installed Pi package's `docs/extensions.md` and relevant `examples/extensions/` before changing extension APIs. For rendering or custom UI, also read `docs/tui.md`; follow related documentation for the APIs being changed. Resolve these under the installed `@earendil-works/pi-coding-agent` package, not this skill directory. Verify examples against the repository's installed dependency types before copying version-sensitive APIs.
3. When using or changing shared rendering, configuration, logging, retained-output, or untrusted-content handling, read the [shared helper reference](../../../pi/agent/extensions/_shared/README.md) and the relevant module and tests. Keep helper-specific behavior documented there rather than duplicating its API in extension docs.

## Structure and Documentation

- Use `pi/agent/extensions/<name>/index.ts` as the entry point, with concern-named modules and colocated `*.test.ts` files. Keep general helpers in `_shared/`; promote a cohesive reusable library to an underscore-prefixed directory with an `api.ts` surface only when justified. Keep library directories loader-inert.
- Write `README.md` for users: behavior, tools/commands, configuration, logging, examples, limitations, and troubleshooting. Keep implementation details out unless they affect operation or safety.
- Maintain `DESIGN.md` for every nontrivial extension: module responsibilities, state/lifecycle, invariants, safety boundaries, and change guidance. Omit it only for tiny wrappers whose architecture is obvious. Explain design implications rather than repeating README contracts; avoid empty template sections.
- Expose reusable cross-extension contracts through `api.ts` and document imports, exports, types, and usage in `API.md`. Treat other modules as internal unless explicitly documented otherwise.
- Add new extensions to the table in [pi/README.md](../../../pi/README.md#extensions); update the [root README](../../../README.md) when top-level capabilities change.
- Include README prior art only when meaningful public inspirations exist. Verify source links and explain the specific influence briefly; ask only if attribution or inclusion is materially uncertain.

## Tools and State

- Use snake_case for agent-facing TypeBox schema fields and camelCase internally; translate at the tool boundary.
- For shared-state mutations, collect all applicable validation errors before rejecting. Return recoverable validation failures as clear tool-result text with a semantic error indicator for rendering; apply no partial changes. On success, apply the validated mutation atomically and notify observers once.
- Distinguish semantic validation failures from framework execution errors. A returned error field does not set Pi's framework `isError` flag; render both paths honestly, and throw for execution failures that should carry that flag.
- Keep tool contracts in schemas, descriptions, and active tool guidelines rather than duplicating them in global prompts. Bound model-facing output and disclose truncation or retained-output paths when applicable.
- For lifecycle changes, identify state ownership, restoration, cancellation, and shutdown behavior. Start long-lived resources when needed by the session, not unconditionally in the extension factory; clean them up idempotently. Preserve the affected extension's branching and recovery invariants.

## Rendering and UI

- Use the supported `ctx.ui.setWidget(...)` API, guarded by `ctx.hasUI`; do not copy top-level `(pi as any).setWidget` compatibility shims into new code. Check the installed API's mode support before using TUI-only component factories.
- Prefer [shared render helpers](../../../pi/agent/extensions/_shared/render.ts). Use `getTruncatedText(context.lastComponent, lines)` for compact tool rows; reserve raw wrapping `Text` for intentional prose wrapping. Reuse the prior component across updates and clear partial timers on every settled path.
- Strip terminal control sequences, collapse embedded line breaks in dynamic labels, and bound user/tool/model strings before applying theme styling. Width truncation is not control-sequence sanitization.
- Render a stable call line: bold `toolTitle` name followed by a muted action/target summary. Never echo raw scripts, secrets, or bulky arguments. Style partial state as warning, successful settlement as success, and failures as error.
- Keep collapsed results compact; put inventories, logs, paths, per-item progress, and diagnostics in expanded results. Preserve a contextual action/run header on errors and honor both `context.isError` and semantic error results.
- Test observable renderer behavior for applicable collapsed, expanded, partial, success, semantic-error, framework-error, hostile-control-character, and narrow-width cases.

### Below-editor status widgets

- Render one width-bounded line per entity using `<extension> <state> · <identity or reason> · <telemetry>`. Omit absent fields; do not add headers, overflow rows, blank lines, horizontal rules, or wrapped continuation text.
- Follow statusline typography and TODO semantic colors: lowercase `muted` extension prefix, `accent` activity (including scheduled waiting), `warning` yielded/needs-attention state, `muted` ordinary stops, and `error` failure stops. Do not imply success with green activity labels.
- Use `text` for names and numeric values, `muted` for metadata labels and supplementary reasons, and `dim` for inline `·` separators. Highlight nonzero failure-budget fields with `warning`. Use normal weight without icons, backgrounds, or animation; use theme tokens rather than hardcoded colors.
- Sanitize dynamic content before styling. Shorten identity/reason text before sacrificing essential status or timing; drop secondary telemetry from the end when space is insufficient. Place failure indicators ahead of ordinary timing. Prefer `_shared/widget.ts` for fitting and countdowns; keep caller-specific sanitization at the extension boundary.
- Round positive countdowns up to whole seconds, clamp expired countdowns to zero, and use `12s`, `1m`, or `1m 12s`. Refresh countdowns no faster than once per second; preserve lifecycle visibility and cleanup semantics. Keep instructions, source, evidence, and verbose details in inspection surfaces, not widgets.
- Mount each TUI widget once while visible and repaint its existing component through the factory-provided `tui.requestRender()`. Do not call `setWidget` on every timer/state update: Pi deletes/reinserts keys, changing sibling order. Prefer `createPersistentWidget` in `_shared/widget.ts`; release repaint handles on disposal/removal and use string-array updates in RPC mode.
- Keep long scheduler delays outside awaited lifecycle/command handlers so Pi can process subsequent user submissions. Own cancellation and explicitly handle detached-task rejection.
- Document extension-specific fields and visibility in its README and layout/timer invariants in its DESIGN. This convention applies to below-editor status widgets, not tool rows, above-editor TODO lists, or the footer itself.

## Configuration and Logging

- Prefer [shared config helpers](../../../pi/agent/extensions/_shared/config.ts) for settings loading/merging, boolean parsing, and inspection commands. Validate merged values at the extension boundary. Use safe defaults for invalid ordinary settings; reject or disable affected operations when fallback could relax a security restriction.
- Provide environment overrides for user-facing settings unless a documented constraint prevents it. Use camelCase fields and UPPERCASE_SNAKE_CASE environment variables; environment values take precedence when set. Accept `1`/`true` and `0`/`false` for boolean overrides.
- Register `/EXTENSION-NAME-config` through `registerConfigCommand` for configurable extensions. Declare sensitive fields explicitly for masking, and keep secrets out of warnings as well as displayed values.
- Document configurable fields in one README table with `Field`, `Default`, `Environment override`, and `Description`, followed by a short JSON settings example. Document environment variables separately only when they do not map to settings fields. State explicitly when no user-facing configuration exists.
- Prefer [shared logging helpers](../../../pi/agent/extensions/_shared/logging.ts) for retained diagnostics. Avoid `console.*` in interactive paths; use `ctx.ui.notify` for user-visible issues and reserve direct stdout/stderr for headless or last-resort diagnostics.
- Document log/temp-output locations, retention/deletion, and possible raw process/tool content in the README. State explicitly when no retained logs exist; keep secrets out of retained output.

## Verification and Handoff

- Add meaningful regression coverage for changed behavior at the existing test seam. Keep tests beside the extension and import TypeScript source with `.ts` extensions.
- When stubbing Node ESM built-ins, use an exported mutable holder instead of attempting to replace immutable module bindings. Follow the `_spawn.fn` pattern in [subagents/spawn.ts](../../../pi/agent/extensions/subagents/spawn.ts); use `mock.method(holder, "fn", stub)` and avoid launching real processes unnecessarily.
- Run the [repository-required checks](../../../AGENTS.md#commands-and-verification) appropriate to code, configuration, or documentation changes. Reuse valid passing evidence rather than adding repeated review/test rounds without a concrete unresolved risk.
- Report changed behavior, verification results, and any gaps in runtime/UI testing. Do not install, Stow, or reload the running session as an implicit final step; preserve the repository's explicit authorization requirements.
