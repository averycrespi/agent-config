# statusline

Pi extension that renders a single-line footer with the current workflow mode, working directory, git branch, provider quota, context usage, model, and thinking level.

## Footer format

```
~/Workspace/agent-config [main] · Codex 45% (20%) 2h · ctx 42%/200k · gpt-5-codex · medium
plan mode · /repo [feature/statusline-git] · Codex limit 2h · ctx 92%/200k · gpt-5-codex · high
verify mode · /repo [detached: abc1234] · Codex $4.20 1h · ctx 18%/200k · gpt-5-codex · low (base: high)
```

Normal mode omits the workflow badge. When a workflow mode is active, the footer prefixes a colored `plan mode`, `execute mode`, or `verify mode` segment. When the working directory is in a git repository, the current branch is appended to the working directory in brackets. Detached HEAD states render as `detached: <short-hash>`. If the current thinking level differs from the session's original pre-workflow thinking level, the footer appends `(base: …)` after the current thinking level.

Left-to-right priority is preserved when the terminal is narrow: workflow mode, cwd, provider quota, context, model, then thinking. Quota percentages and context percentage are highlighted in warning/error colors above the configured thresholds.

The footer updates on session start, workflow-mode changes, model changes, thinking-level changes, and after each turn. Successful provider usage fetching is debounced to one API call per provider/model every 60 seconds.

## Configuration

No extension-specific configuration. Path shortening uses the `HOME` environment variable when available.

## Logging

This extension does not write retained logs or diagnostic files.

## Current providers

- `openai-codex` — polls the ChatGPT/Codex usage endpoint

## Adding a new provider

1. Create a new adapter file, e.g. `anthropic.ts`
2. Export a `ProviderAdapter` (see `utils.ts` for the interface)
3. Import it in `index.ts` and add it to the `ADAPTERS` array

Each adapter handles provider detection (`handles`) and API-specific fetching (`fetchUsage`), returning a normalized `UsageStats` object.

## File layout

- `index.ts` — extension entry point, event wiring, and footer updates
- `footer.ts` — single-line footer rendering and truncation rules
- `codex.ts` — Codex provider adapter
- `utils.ts` — `ProviderAdapter` interface, `UsageStats` type, and formatting helpers

## Prior art

- [Claude Code status line docs](https://docs.claude.com/en/docs/claude-code/statusline) — configurable bottom status line that receives session JSON and displays context, costs, git status, or custom fields.
- [marckrenn/pi-sub/sub-bar](https://github.com/marckrenn/pi-sub/tree/main/packages/sub-bar) — multi-provider usage widget with theming, widget/status placement options, and a settings system
- [ifiokjr/oh-pi/usage-tracker](https://github.com/ifiokjr/oh-pi/blob/main/packages/extensions/extensions/usage-tracker.ts) — per-session cost tracking, pacing analysis, dashboard overlay, and inter-extension event broadcasting
