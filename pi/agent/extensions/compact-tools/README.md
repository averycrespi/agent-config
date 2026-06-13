# compact-tools

Pi extension that compacts verbose built-in tool output in the TUI. Execution behavior is unchanged — only the visual rendering is overridden. The full tool output is still delivered to the agent.

Renderer overrides are registered after `session_start`, not during extension factory setup. This avoids force-enabling inactive tools during Pi startup while still making compact rendering available for tools that another extension or command activates later.

## Compacted tools

### `read`

Replaces the default file-contents display with a one-line file label.

- **Call:** `read <cwd-relative path>`
- **Running:** `Reading <path>...` in warning color
- **Success:** empty result body
- **Error:** first non-empty line of the error, in error color

Execution is delegated to Pi's built-in `read` tool via `createReadTool(ctx.cwd)`, so normal read semantics (offset, limit, image handling, truncation) continue to work.

### `bash`

Replaces the default stdout preview with a compact command label and short output tail.

- **Call:** `bash <command>` — multi-line commands show just the first line followed by `...`
- **Running:** `Running <command>...` in warning color
- **Success:** last up to 3 non-empty output lines, in muted color. Nothing if the command produced no output.
- **Error:** first non-empty line of the error, in error color

Execution is delegated to Pi's built-in `bash` tool via `createBashTool(ctx.cwd)`, so normal bash semantics (timeouts, truncation-to-tempfile, abort handling) continue to work.

### `ls`

Replaces the default directory listing with a compact path label and short preview.

- **Call:** `ls <cwd-relative path>`
- **Running:** `Listing <path>...` in warning color
- **Success:** first up to 3 non-empty listing lines, plus a `... +N more entries` line when truncated; `empty` if there are no entries
- **Error:** first non-empty line of the error, in error color

Execution is delegated to Pi's built-in `ls` tool via `createLsTool(ctx.cwd)`.

### `find`

Replaces the default file search output with a compact pattern label and short preview.

- **Call:** `find <pattern> in <path>`
- **Running:** `Finding <pattern>...` in warning color
- **Success:** first up to 3 non-empty result lines, plus a `... +N more results` line when truncated; `no matches` if there are no results
- **Error:** first non-empty line of the error, in error color

Execution is delegated to Pi's built-in `find` tool via `createFindTool(ctx.cwd)`.

### `grep`

Replaces the default search output with a compact pattern label and match count.

- **Call:** `grep /<pattern>/ in <path>` with a glob suffix when provided
- **Running:** `Searching /<pattern>/...` in warning color
- **Success:** match count in muted color, e.g. `8 matches`; `no matches` if there are no matches
- **Error:** first non-empty line of the error, in error color

Execution is delegated to Pi's built-in `grep` tool via `createGrepTool(ctx.cwd)`.

## Configuration

No presets, config file, or slash commands. Behavior is hardcoded.

## Logging

This extension does not write retained logs or diagnostic files.

## Testing

`render.test.ts` covers the compact renderer output shape and width behavior for all compacted tools. It also verifies that the extension registers every renderer override after `session_start` without mutating the active tool list.

## Non-goals

Intentionally out of scope — this is a minimal, hand-rolled subset tailored to this configuration:

- **No MCP tool rendering.** MCP tools vary too widely to compact generically.
- **No edit / write diff customization.** Pi's built-in diff renderer is already reasonable.

## Prior art

- [`pi-tool-display`](https://www.npmjs.com/package/pi-tool-display) — a full-featured extension with compact rendering for all built-in tools, MCP support, adaptive diffs, and configurable presets. `compact-tools` is a deliberately smaller, hand-rolled subset focused on the built-in tools that are most verbose in this setup.
