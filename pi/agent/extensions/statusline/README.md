# statusline

Pi extension that renders a footer with the current working directory, git branch, provider quota, context usage, model, and thinking level.

## Footer format

```
~/Workspace/agent-config [main ✔]                  Codex 45% (20%) 2h · ctx 42%/200k · gpt-5-codex · medium
/repo [feature/statusline-git ↓2↑3 ●1 ✚2 …1]       Codex limit 2h · ctx 92%/200k · gpt-5-codex · high
/repo [detached: abc1234 ⚑2]                        Codex $4.20 1h · ctx 18%/200k · gpt-5-codex · low
```

When the working directory is in a git repository, a compact git summary is appended to the working directory in brackets. Detached HEAD states render as `detached: <short-hash>`. Git summary lookup runs asynchronously with short timeouts, so footer rendering is not blocked by a slow repository; the footer keeps the last known summary while a refresh is pending or fails.

Git summary symbols follow the compact style popularized by bash-git-prompt:

| Symbol | Meaning                                      |
| ------ | -------------------------------------------- |
| `✔`    | clean working tree with no other git signals |
| `↑n`   | branch is ahead of upstream by `n` commits   |
| `↓n`   | branch is behind upstream by `n` commits     |
| `✖n`   | `n` conflicted files                         |
| `●n`   | `n` staged files                             |
| `✚n`   | `n` unstaged changed files                   |
| `…n`   | `n` untracked files                          |
| `⚑n`   | `n` stash entries                            |

The repository segment stays on the left and the remaining status segments are right-aligned when they fit on one line. If the full repository segment plus the status segments do not fit, the repository segment moves to its own line and is not truncated:

```text
~/Workspace/a-very-long-worktree-name [feature/a-very-long-branch-name ↓2↑3 ●1 ✚2 …1]
Codex 45% (20%) 2h · ctx 42%/200k · gpt-5-codex · medium
```

Left-to-right priority is preserved within the status segment when the terminal is narrow: provider quota, context, model, then thinking. Quota percentages and context percentage are highlighted in warning/error colors above the configured thresholds.

The footer updates on session start, model changes, thinking-level changes, and after each turn. Successful provider usage fetching is debounced to one API call per provider/model every 60 seconds.

## Configuration

No extension-specific configuration. Path shortening uses the `HOME` environment variable when available.

## Logging

Quota-fetch failures are logged once per session under `${tmpdir()}/pi-extension-logs/statusline/` and may include provider/model identifiers and failure context. Logs are written with owner-only permissions and old files are cleaned up lazily by the shared logging helper.

## Current providers

- `openai-codex` — polls the ChatGPT/Codex usage endpoint

## Prior art

- [magicmonty/bash-git-prompt](https://github.com/magicmonty/bash-git-prompt) — compact git prompt symbols for branch tracking, clean/dirty state, conflicts, untracked files, and stashes.
- [Claude Code status line docs](https://docs.claude.com/en/docs/claude-code/statusline) — configurable bottom status line that receives session JSON and displays context, costs, git status, or custom fields.
- [marckrenn/pi-sub/sub-bar](https://github.com/marckrenn/pi-sub/tree/main/packages/sub-bar) — multi-provider usage widget with theming, widget/status placement options, and a settings system
- [ifiokjr/oh-pi/usage-tracker](https://github.com/ifiokjr/oh-pi/blob/main/packages/extensions/extensions/usage-tracker.ts) — per-session cost tracking, pacing analysis, dashboard overlay, and inter-extension event broadcasting
