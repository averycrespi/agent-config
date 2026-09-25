# Builtins design

`builtins` compacts direct tool rendering and adapts active stock Pi tools to Script without changing execution. It is not an arbitrary extension dispatcher or a second filesystem/shell implementation.

## Architecture

- `index.ts` defers renderer override registration until `session_start` and registers each compact tool override exactly once.
- `read.ts`, `bash.ts`, `ls.ts`, `find.ts`, and `grep.ts` each register a same-name tool with Pi's built-in schema/description and compact renderers.
- `render.ts` owns the five builtins' display-only contextual summaries and bounded expanded text. `render.test.ts` verifies output shape, width behavior, timers, payload preservation and deferred registration.
- `provider.ts` registers validated stock argument schemas, live method admission and structured result translation through the public Script API.
- `provider.test.ts` exercises real filesystem/shell effects through Script IPC, cancellation, lifecycle, images, context isolation and fixture composition.
- Shared formatting comes from `pi/agent/extensions/_shared/render.ts`.

Each tool module follows the same pattern:

1. Cache Pi's built-in tool instance by `cwd`.
2. Reuse the built-in `description` and `parameters` from a default instance.
3. Delegate `execute()` to the built-in tool for `ctx.cwd`.
4. Override only `renderCall()` and `renderResult()`.

## Registration lifecycle

Do not register the overrides during extension factory setup. Pi's startup refresh can include all extension tools, which would force same-name overrides into the active set even when the underlying tool is not enabled. Deferring to `session_start` allows the overrides to exist for tools activated by user configuration or other commands without changing the active tool list during boot.

The `registered` guard in `index.ts` prevents duplicate registration if multiple session-start events fire.

## Script boundary

Registration is session-owned and grants no permissions. Methods have synchronous availability checks that consult the current active/configured tool inventory at discovery and immediately before Script dispatch. Script's optional method-level callback is snapshotted as a function, not as its result; queued work cannot retain a stale authorization boolean. Supported stock factories are fixed, including PowerShell only on Windows. Same-name extension implementations are never executed by the provider.

Script snapshots `{cwd, session?}` at execution entry before asynchronous setup, freezes it, and passes it only to trusted handlers. The agent tool samples session metadata from its caller context; host callers may supply the same plain metadata. Factory instances are made for the caller cwd, not global process cwd. Shell factories disable implicit session injection and use a spawn hook closing over the immutable snapshot. Pi strips inherited session variables before that hook. No mutable current-session object crosses the boundary.

Structured results preserve content and metadata. Only documented absent optional fields are omitted before strict JSON snapshot; unknown lossy values fail closed. Images reject before serialization with a fixed code directing callers to direct read. Stock throws conservatively retain unknown outcomes because filesystem/shell effects may already exist. No raw exception messages enter traces.

All calls share Script's queue and concurrency limits without adapter-level serialization. Pi's native per-file queues remain part of stock execution. The adapter passes abort signals unchanged, creates no scheduler, and does not synthesize tool hooks. Shutdown/disposal abort selected executions; tree navigation disposes and replaces registration so old results cannot re-enter new authority. Script owns deadlines, IPC/output limits, sticky failure and stale-result accounting. Successful writes are not rolled back.

## Direct execution invariant

Execution behavior must remain unchanged. The direct wrappers must not add authorization, path handling, command execution logic, truncation policy, or result transformation. If a tool needs behavioral changes, that belongs in a separate extension or in Pi itself.

Preserve these invariants:

- Use `createReadTool`, `createBashTool`, `createLsTool`, `createFindTool`, and `createGrepTool` for execution.
- Pass through `toolCallId`, `params`, `signal`, and `onUpdate` unchanged.
- Use `ctx.cwd` for execution-time built-in tool instances.
- Keep full tool results available to the agent; compact only the TUI representation.

## Rendering model

The renderers optimize the terminal transcript for scanability:

- Call labels preserve pre-CONFIG-33 builtin identity: `read`/`ls` use cwd-relative paths; `find`/`grep` show pattern and search scope; `bash` shows a bounded single-line command preview. All dynamic fields are sanitized and credential-shaped strings redacted before styling. This is not general secret detection; sensitive commands/output should not be placed in display surfaces.
- Partial results use the original tool-specific verbs and elapsed timers, cleared on every settled path.
- Ordinary `read` success returns an empty result component. `bash` shows up to three trailing nonempty output lines; `ls`/`find` show up to three leading lines with a remainder count; `grep` reports its legacy nonempty output-line count, not a verified match count. The exact stock no-match phrase maps to `no matches` rather than a misleading one-match count.
- Errors retain stock-owned closed status classes instead of arbitrary exception prose, which could contain secrets. Bash exit, timeout and abort remain distinct. Sanitized result previews preserve the visible legacy layout without changing model-facing results or stock execution.
- Width-aware output uses `getTruncatedText(context.lastComponent, lines)`; terminal controls stay out of styled fields.

## Boundaries and non-goals

- No user-facing configuration or slash commands.
- No retained logs.
- No MCP tool compaction.
- No edit/write diff customization.
- No generic renderer framework or preset system.
- No changes to built-in tool schemas or execution semantics.

## Change guidance

When adding another compact renderer, follow the existing same-name wrapper pattern and add renderer tests. Prefer tiny, predictable summaries over clever parsing. If a future change needs configurable presets, reconsider whether this extension should remain the minimal local subset or whether a broader display extension is a better fit.
