# compact-tools

Pi extension that compacts verbose built-in tool output in the TUI. Execution behavior is unchanged — only the visual rendering is overridden. The full tool output is still delivered to the agent.

## Compacted tools

### `read`

Replaces the default file-contents display with a one-line file label.

- **Call:** `read <cwd-relative path>`
- **Running:** `Reading <path>...` in warning color
- **Success:** empty result body
- **Error:** first non-empty line of the error, in error color

### `bash`

Replaces the default stdout preview with a compact command label and short output tail.

- **Call:** `bash <command>` — multi-line commands show just the first line followed by `...`
- **Running:** `Running <command>...` in warning color
- **Success:** last up to 3 non-empty output lines, in muted color. Nothing if the command produced no output.
- **Error:** first non-empty line of the error, in error color

### `ls`

Replaces the default directory listing with a compact path label and short preview.

- **Call:** `ls <cwd-relative path>`
- **Running:** `Listing <path>...` in warning color
- **Success:** first up to 3 non-empty listing lines, plus a `... +N more entries` line when truncated; `empty` if there are no entries
- **Error:** first non-empty line of the error, in error color

### `find`

Replaces the default file search output with a compact pattern label and short preview.

- **Call:** `find <pattern> in <path>`
- **Running:** `Finding <pattern>...` in warning color
- **Success:** first up to 3 non-empty result lines, plus a `... +N more results` line when truncated; `no matches` if there are no results
- **Error:** first non-empty line of the error, in error color

### `grep`

Replaces the default search output with a compact pattern label and match count.

- **Call:** `grep /<pattern>/ in <path>` with a glob suffix when provided
- **Running:** `Searching /<pattern>/...` in warning color
- **Success:** match count in muted color, e.g. `8 matches`; `no matches` if there are no matches
- **Error:** first non-empty line of the error, in error color

## Configuration

No presets, config file, or slash commands. Behavior is hardcoded.

## Logging

This extension does not write retained logs or diagnostic files.

## Non-goals

Intentionally out of scope — this is a minimal, hand-rolled subset tailored to this configuration:

- **No MCP tool rendering.** MCP tools vary too widely to compact generically.
- **No edit / write diff customization.** Pi's built-in diff renderer is already reasonable.

## Prior art

- [`pi-tool-display`](https://www.npmjs.com/package/pi-tool-display) — a full-featured extension with compact rendering for all built-in tools, MCP support, adaptive diffs, and configurable presets. `compact-tools` is a deliberately smaller, hand-rolled subset focused on the built-in tools that are most verbose in this setup.
