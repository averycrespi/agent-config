# subagents Design

`subagents` lets the main agent delegate isolated work to fresh child Pi processes. It is optimized for read-mostly exploration, research, and review: subagents are context firewalls and parallel readers, not a replacement for main-thread implementation judgment.

## Architecture

- `index.ts` registers `spawn_agents`, injects delegation guidance into the system prompt, loads agent definitions, validates requests, schedules direct runs, combines results, and applies output spillover.
- `config.ts` parses the global/env-only direct concurrency setting and registers `/subagents-config`.
- `pool.ts` owns the extension-internal resizable FIFO concurrency gate.
- `schema.ts` recursively validates the public tool's deliberately narrow JSON Schema subset.
- `loader.ts` discovers markdown agent definitions and parses their frontmatter into `AgentDefinition` objects.
- `spawn.ts` builds child Pi CLI arguments, resolves extensions, enforces recursion depth, spawns `pi --mode json`, streams JSONL events, extracts the final assistant message, handles aborts, and manages logs/spillover.
- `activity.ts` tracks live per-agent progress from child JSONL events and clears UI activity when complete.
- `render.ts` renders compact call/result/activity summaries.
- `utils.ts` resolves extension short names to concrete paths.
- `api.ts` is the stable programmatic export surface documented by `API.md`.
- `types.ts` owns shared schemas, constants, and interfaces.

## Agent definition model

Agent types are data, not hardcoded TypeScript. `loadAgents()` reads `agents/*.md` under `PI_CODING_AGENT_DIR` or `~/.pi/agent`, parses simple YAML-like frontmatter, and uses the Markdown body as the child system prompt.

Supported definition fields include name, description, tools, extensions, model, thinking level, skill/template disabling, and environment variables. Definitions with unreadable files or empty bodies are skipped. This lenient loading keeps Pi usable when one custom agent file is broken, but it also means tests and README examples should cover expected formats.

The tool schema description is built from loaded agent descriptions at extension startup. Agent definitions are not reloaded during a session.

## System prompt guidance

`index.ts` owns the active delegation guidance injected through `before_agent_start`. Keep that guidance behavior-oriented: it should tell the parent agent when to delegate, when not to delegate, how to batch independent branches, and that subagents start without conversation context. The guidance may reference dynamically loaded agent names and descriptions, but it should not duplicate each agent's full system prompt.

README owns the user-facing version of the same policy. Keep `AGENTS.md` at the principle level so agent names, tool availability, and delegation heuristics do not drift across global instructions.

## Spawn lifecycle

Each `spawn_agents` call validates requested specs before launching. Batches over the fixed 16-item ceiling return immediately without doing per-item filesystem or schema work. In-range preflight collects blank intents, unknown agents, invalid thinking overrides, invalid file attachments, and unsupported schemas into one recoverable error and launches no children. File checks resolve relative paths from `ctx.cwd`, follow symlinks, and require readable regular files; workspace containment, attachment count, size, and content type are deliberately not policy boundaries. The normal filesystem check/use race is accepted because Pi remains authoritative when consuming native `@file` arguments.

Valid specs retain index-aligned `Promise.all` fan-in, but each launch first acquires one extension-owned FIFO gate. The gate defaults to four active direct children, is configured from global settings or `SUBAGENTS_MAX_CONCURRENCY`, and is hard-clamped to 16. Project settings are intentionally ignored because overlapping calls from different cwd values share the same gate. Configuration is reloaded before each direct execution. Reloads carry an invocation-order generation so an older asynchronous read that finishes late cannot overwrite a newer call's limit.

For each agent:

1. Wait in the queued activity state and acquire direct-child capacity.
2. Resolve the already-prevalidated agent definition.
3. Create an activity tracker.
4. Call `spawnSubagent()` with prompt, tool allowlist, extension allowlist, model/thinking, native file arguments, optional structured schema, system prompt, env, cwd, parent session file, and abort signal.
5. Feed child JSONL events into the tracker.
6. Format success or failure into that agent's result section.
7. Finalize activity, clear UI hooks, and release capacity exactly once.

Queue admission is abort-aware. Cancellation removes queued waiters without consuming capacity, marks them terminally aborted, emits their updated activity, and never launches them. Running children continue through `spawnSubagent()`'s existing signal path, while completed results remain unchanged. Gate errors reject normally rather than being recast as cancellation. Result order follows input order regardless of admission or completion order.

Combined output is a Markdown document with one `## <agent> · <intent>` section per input. Large combined output goes through shared spillover.

## Child process contract

`spawnSubagent()` launches the `pi` binary with:

- `--mode json`;
- `-p` prompt mode;
- `--no-session` by default, or `--fork <parentSessionFile>` only for direct API callers that request session inheritance;
- explicit `--tools` or `--no-tools`;
- `--no-extensions` followed by resolved `-e <extension-path>` values;
- optional model, thinking, appended system prompt, and skill/template disabling flags.

The tool interface uses `inheritSession: "none"` so every subagent starts with a fresh context. Session inheritance is reserved for the programmatic API and must have an explicit parent session file.

Child stdout is Pi JSONL. `spawn.ts` ignores session events for activity, forwards other events to callbacks, extracts final text from `message_end` or the last assistant message in `agent_end`, and captures structured output from the generic `structured_output` tool when requested. An unrecovered final assistant message with `stopReason: "error"` makes the outcome fail with its provider error even when the Pi subprocess exits zero or remains alive briefly after `agent_end`; a later successful assistant message clears an earlier transient error. Provider tool-schema rejections use `provider_schema_rejected`, while other provider failures use `provider_error`, allowing workflow retries to skip permanent schema failures without suppressing retries for transient provider errors. stderr is recorded and surfaced as activity events.

## Structured output

Structured output remains default-off, but the public tool can opt in per item through `output_schema`. `schema.ts` protects the engine boundary by recursively rejecting unsupported types, keywords, misplaced structural constraints, malformed definitions, non-scalar enum/const values, and non-JSON data before any child launches. The accepted subset intentionally excludes type arrays, references, composition and conditionals, bounds, and tuple items. The programmatic `SpawnInvocation.output` API remains unchanged and is not restricted by this public preflight layer.

When `SpawnInvocation.output` is set, `spawn.ts` writes a temporary schema file, loads the generic `structured-output` extension in the child Pi invocation, appends system-prompt instructions requiring `structured_output` as the final action, and passes the schema file through `PI_STRUCTURED_OUTPUT_SCHEMA_FILE`. The child extension presents non-object roots through an internal provider-compatible object envelope and removes that envelope from `details.value`, so the parent still validates the original array, scalar, `null`, object, or untyped value.

The parent captures the tool's `tool_execution_end` event from JSON mode and stores `result.details.value`. A successful child process is converted to a failed `SpawnOutcome` if the output tool was not called, returned an error, omitted `details.value`, or failed parent-side validation. `index.ts` trusts that engine outcome rather than revalidating values: internal item results carry explicit `details.ok`, structured successes render as fenced JSON, and aggregate failure counts use `details.ok` instead of exit-code heuristics.

If any direct item requested a schema, fan-in adds an input-aligned `details.structured` discriminated envelope. Unrequested items use `{ requested: false }`; successes include `{ requested: true, ok: true, value }`, preserving JSON `null`; contract, process, and cancellation failures include `{ requested: true, ok: false, error }`. Prose-only batches omit the field and preserve their visible section bodies. This keeps structured output as a hard phase boundary for direct and workflow fan-in while preserving child `stdout` as diagnostic fallback text.

Temporary schema files are created under the system temp directory with owner-only permissions and removed after the child process exits. Retained failure logs may still include raw structured values because logs contain child JSON events.

## Recursion and cancellation

Recursion is controlled with `PI_SUBAGENT_DEPTH`. Each child gets the parent environment plus agent env and an incremented depth. The public tool path does not pass `maxDepth`, so it defaults to 1: a subagent cannot spawn another subagent. `MAX_SUBAGENT_DEPTH` is only an absolute ceiling for direct programmatic callers that deliberately allow deeper nesting.

Abort handling sends SIGTERM and then SIGKILL after a short grace period. If `agent_end` is observed before the process exits, a post-agent-end grace timer allows Pi to flush output before starting the same termination sequence. The spawner resolves only after `close`, so forced cleanup cannot orphan a child or release caller concurrency while the process is still alive; a forced post-`agent_end` close preserves the already-observed logical outcome unless cancellation or a provider error occurred.

## Activity tracking

Activity tracking is derived from child events, not from polling child state. The tracker records phase, active/current command, recent tool/stderr events, tool-use count, token totals, last output, error message, and log file. Recent events and output snippets are aggressively truncated for UI stability.

The tracker emits updates for tool progress and on a periodic tick while running. `finish()` must always be called so UI status/widget entries are removed for success, error, and abort paths.

## Extension resolution

Agent definitions name extensions by short name. `resolveExtensionAllowlist()` searches:

1. `<cwd>/.pi/extensions`;
2. `<agentDir>/extensions`;
3. extension roots listed in `<agentDir>/settings.json`.

It accepts directory-based extensions and single-file extension modules with known JavaScript/TypeScript extensions. If an agent requested extensions but none resolve, spawning fails before launching Pi.

## Logs and spillover

Each child process writes raw stdout/stderr to a managed temp log. Successful logs are deleted after completion. Failed or aborted logs are retained and surfaced in failure text/details.

Both individual `stdout`/`stderr` fields and combined tool output can spill to temporary files via the shared spillover helper. Spillover artifacts and retained logs may contain raw tool/model output; they are not sanitized.

## Boundaries and non-goals

- Workflows reuse the child-process engine and activity tracker through `api.ts`, but retain their worker-side scheduler and policy; the direct gate does not control workflow concurrency.
- No per-agent concurrency policy; the gate is shared across direct calls.
- No raw model override in the public tool; agent definitions retain model ownership.
- No extension-side file inlining or workspace-only attachment policy; Pi owns native attachment formatting and context limits.
- No subagent session inheritance through the `spawn_agents` tool.
- No automatic merging of subagent decisions into workspace changes.
- No parallel write coordination; built-in agents are read-mostly by tool boundary and read-only by prompt convention.
- No dynamic agent reload mid-session.
- No persistent run database or dashboard.
- No unbounded recursive delegation.

## Change guidance

Preserve subagents as isolated, bounded child processes. Use subagents for read-mostly exploration, retrieval, review, and verification unless a custom agent explicitly broadens tools. When built-in agents include `bash`, keep their prompts read-only and explicitly forbid filesystem mutations because `bash` is not mechanically read-only. When changing spawn arguments, update `API.md` if the programmatic surface changes. Add tests for loader parsing, CLI argument construction, depth/abort behavior, activity updates, and render output when relevant.
