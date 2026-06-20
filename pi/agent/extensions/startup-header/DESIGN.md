# startup-header Design

`startup-header` renders a compact TUI header with Pi version and lightweight git context. It is informational only and should never affect agent behavior or session state.

## Architecture

- `index.ts` owns the session lifecycle, header registration, asynchronous git metadata refresh, and stale-result guard.
- `git.ts` owns git command execution, timeout handling, and parsing of recent commits.
- `render.ts` owns pure width-aware header rendering.
- Tests cover git parsing/loading, lifecycle behavior, and render truncation.

There is no command surface, agent tool, configuration, persistent state, or retained logging.

## Lifecycle

On `session_start`, the extension does nothing unless `ctx.hasUI` is true. In UI sessions it:

1. increments a generation counter;
2. resets metadata to an empty fallback state;
3. installs a header renderer immediately;
4. starts asynchronous git metadata loading;
5. updates metadata and requests a render when loading finishes.

The generation counter prevents stale async results from a prior session from updating the current header. `session_shutdown` increments the generation, clears the render callback, and resets metadata.

## Metadata model

Git metadata is best-effort and optional:

- repo name comes from `git rev-parse --show-toplevel` and `basename()`;
- branch comes from `git branch --show-current`;
- commits come from `git log -n 3 --pretty=format:%h %s`.

Each git command uses `pi.exec()` with a short timeout. Failures, non-zero exits, killed commands, and missing git repositories all degrade to fallback rendering rather than surfacing errors.

## Rendering contract

`renderHeader()` is pure and width-aware. It renders:

- a `π›` wordmark;
- `pi v<version>`;
- repo name or cwd basename fallback;
- branch when known;
- up to three recent commits.

Every line is truncated to the available width. Keep rendering plain and bounded; the header should remain compact even in narrow terminals and large repositories.

## Boundaries and non-goals

- TUI-only; no headless output.
- No retained logs or diagnostics.
- No config surface.
- No remote git calls or network access.
- No mutation of repository state.
- No blocking session startup on git metadata.

## Change guidance

When changing the header, keep git loading asynchronous and failure-tolerant. Add tests for any new parsed metadata or render layout. If adding user-facing configuration, use the shared config helper and update the README with config/logging details.
