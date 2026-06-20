# compact-tools Design

`compact-tools` is a display-only extension. It replaces verbose TUI renderers for selected built-in tools while delegating execution to Pi's built-in implementations unchanged.

## Architecture

- `index.ts` defers renderer override registration until `session_start` and registers each compact tool override exactly once.
- `read.ts`, `bash.ts`, `ls.ts`, `find.ts`, and `grep.ts` each register a same-name tool with Pi's built-in schema/description and compact renderers.
- `render.test.ts` verifies output shape, width behavior, and deferred registration.
- Shared formatting comes from `pi/agent/extensions/_shared/render.ts`.

Each tool module follows the same pattern:

1. Cache Pi's built-in tool instance by `cwd`.
2. Reuse the built-in `description` and `parameters` from a default instance.
3. Delegate `execute()` to the built-in tool for `ctx.cwd`.
4. Override only `renderCall()` and `renderResult()`.

## Registration lifecycle

Do not register the overrides during extension factory setup. Pi's startup refresh can include all extension tools, which would force same-name overrides into the active set even when the underlying tool is not enabled. Deferring to `session_start` allows the overrides to exist for tools activated by user configuration or other commands without changing the active tool list during boot.

The `registered` guard in `index.ts` prevents duplicate registration if multiple session-start events fire.

## Execution invariant

Execution behavior must remain unchanged. This extension should not add authorization, path handling, command execution logic, truncation policy, or result transformation. If a tool needs behavioral changes, that belongs in a separate extension or in Pi itself.

Preserve these invariants:

- Use `createReadTool`, `createBashTool`, `createLsTool`, `createFindTool`, and `createGrepTool` for execution.
- Pass through `toolCallId`, `params`, `signal`, and `onUpdate` unchanged.
- Use `ctx.cwd` for execution-time built-in tool instances.
- Keep full tool results available to the agent; compact only the TUI representation.

## Rendering model

The renderers optimize the terminal transcript for scanability:

- Calls show one compact label.
- Partial results show a short running message plus elapsed time from shared partial-timer helpers.
- Errors show the first useful line.
- Successful verbose tools show either nothing, a count, or a short head/tail preview.
- Width-aware output should go through `getTruncatedText(context.lastComponent, lines)` to avoid accidental wrapping.

Tool-specific summaries are intentionally simple: `read` hides file contents, `bash` shows a short output tail, `ls` and `find` show a short head with truncation count, and `grep` shows match count.

## Boundaries and non-goals

- No user-facing configuration or slash commands.
- No retained logs.
- No MCP tool compaction.
- No edit/write diff customization.
- No generic renderer framework or preset system.
- No changes to built-in tool schemas or execution semantics.

## Change guidance

When adding another compact renderer, follow the existing same-name wrapper pattern and add renderer tests. Prefer tiny, predictable summaries over clever parsing. If a future change needs configurable presets, reconsider whether this extension should remain the minimal local subset or whether a broader display extension is a better fit.
