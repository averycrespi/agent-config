# statusline Design

`statusline` renders a compact footer with local workspace context, git state, provider quota, context usage, model, and thinking level. It is a best-effort UI diagnostic surface, not an execution control plane.

## Architecture

- `index.ts` owns extension lifecycle, mutable footer state, event wiring, render requests, provider adapter selection, quota-fetch debounce, and one-shot failure logging.
- `footer.ts` owns pure footer layout, segment priority, width handling, path shortening, git summary formatting, and warning/error color thresholds.
- `git.ts` owns local git summary collection through short-timeout `git` subprocesses and parsing of branch/tracking/status/stash output.
- `codex.ts` is the current provider usage adapter for `openai-codex`.
- `utils.ts` defines the provider adapter interface, normalized usage types, and formatting helpers.
- Tests cover provider parsing, footer layout, git parsing, event behavior, and utility formatting.

There is no slash command, agent tool, persistent state, or user-facing configuration.

## Footer state model

`FooterState` is a mutable in-memory snapshot containing:

- cwd and home directory;
- optional git summary;
- optional provider usage;
- current context usage;
- model ID;
- thinking level.

`syncState()` refreshes Pi-derived fields from the current context. Git and provider quota are refreshed separately because they require asynchronous I/O.

## Rendering model

The footer has two logical sides:

- left: cwd with optional compact git summary;
- right: provider quota, context usage, model ID, thinking level.

When everything fits, the left segment stays left and status segments are right-aligned. If it does not fit, the full repository segment moves to its own line and the status segment renders below. This deliberately avoids truncating long worktree or branch names in the primary repository context.

Within the status segment, priority is left-to-right: provider quota, context usage, model, thinking. Narrow terminals keep the highest-priority segments that fit. Percentages above thresholds are colored warning/error.

Keep `footer.ts` pure. Rendering tests should be able to exercise layout without Pi APIs, subprocesses, network, or timers.

## Git summary lifecycle

Git state is best-effort and local-only. `refreshGitSummary()` starts an async lookup and uses a generation counter plus cwd check to discard stale results. Slow or failing git commands should never block footer rendering.

`git.ts` uses short `execFile("git", ...)` calls, not shell strings. It summarizes:

- current branch or detached short hash;
- ahead/behind counts;
- conflicted, staged, changed, and untracked file counts;
- stash count.

Failures return `undefined`, leaving the footer without git metadata or with the previous state until a successful refresh.

## Provider usage lifecycle

Provider quota comes from adapter objects implementing `ProviderAdapter`. `index.ts` selects the first adapter whose `handles(provider)` returns true, retrieves provider auth through Pi's model registry, and calls `fetchUsage()`.

Quota fetches are debounced by provider/model key for 60 seconds. Failed quota fetches clear the usage segment and write one retained diagnostic log per session. Do not log API keys or auth headers.

The current adapter is `codexAdapter`, which polls ChatGPT/Codex usage with a hard fetch timeout and normalizes the response into `UsageStats`.

## Event lifecycle

The footer updates on:

- `session_start`: sync state, install footer if UI exists, then refresh git and usage;
- `turn_end`: refresh context, git, and usage;
- `model_select`: refresh model-dependent state and usage;
- `thinking_level_select`: update thinking and rerender;
- `session_shutdown`: clear render callback.

The extension should remain TUI-oriented. In non-UI contexts, installing a footer is skipped.

## Boundaries and non-goals

- No agent-facing tool or prompt injection.
- No workspace mutation.
- No remote git operations.
- No quota enforcement or automatic model switching.
- No history of quota/context values.
- No extension-specific config in v1.

## Change guidance

When adding a provider, create a new adapter and add it to `ADAPTERS`; keep provider-specific API parsing out of `index.ts` and `footer.ts`. When changing layout, update footer tests for narrow and wide widths. Any new logs, configuration, or user-visible footer fields must be documented in the README.
