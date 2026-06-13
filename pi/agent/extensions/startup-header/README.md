# startup-header

Pi extension that renders a compact header at session start with the Pi version, repository name, current branch, and recent commits.

The header is TUI-only; it does nothing when Pi is running without UI. Git metadata loads asynchronously; if loading fails, the header keeps rendering a fallback based on the current working directory.

## Configuration

No user-facing configuration.

## Logging

This extension does not write retained logs or diagnostic files.

## File layout

- `index.ts` — extension entry point, header lifecycle, and async metadata refresh
- `git.ts` — git metadata loading and parsing
- `render.ts` — header rendering and truncation rules
