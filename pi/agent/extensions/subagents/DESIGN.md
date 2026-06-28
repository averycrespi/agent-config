# subagents Design

`subagents` lets the main agent delegate isolated work to fresh child Pi processes. It is optimized for read-mostly exploration, research, and review: subagents are context firewalls and parallel readers, not a replacement for main-thread implementation judgment.

## Architecture

- `index.ts` registers `spawn_agents`, injects delegation guidance into the system prompt, loads agent definitions, validates requests, orchestrates parallel runs, combines results, and applies output spillover.
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

## Spawn lifecycle

Each `spawn_agents` call validates all requested specs before launching. Validation failures return one recoverable tool error and launch no children. Valid specs run concurrently with `Promise.all`, and result order follows input order.

For each agent:

1. Resolve agent definition.
2. Create an activity tracker.
3. Call `spawnSubagent()` with prompt, tool allowlist, extension allowlist, model/thinking, system prompt, env, cwd, parent session file, and abort signal.
4. Feed child JSONL events into the tracker.
5. Format success or failure into that agent's result section.
6. Finalize activity and clear UI hooks.

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

Child stdout is Pi JSONL. `spawn.ts` ignores session events for activity, forwards other events to callbacks, extracts final text from `message_end` or the last assistant message in `agent_end`, and captures structured output from the generic `structured_output` tool when requested. stderr is recorded and surfaced as activity events.

## Structured output

Structured output is a programmatic API feature, not part of the public `spawn_agents` tool schema. When `SpawnInvocation.output` is set, `spawn.ts` writes a temporary schema file, loads the generic `structured-output` extension in the child Pi invocation, appends system-prompt instructions requiring `structured_output` as the final action, and passes the schema file through `PI_STRUCTURED_OUTPUT_SCHEMA_FILE`.

The parent captures the tool's `tool_execution_end` event from JSON mode and stores `result.details.value`. A successful child process is converted to a failed `SpawnOutcome` if the output tool was not called, returned an error, omitted `details.value`, or failed parent-side validation. This keeps structured output as a hard phase boundary for workflow fan-in while preserving `stdout` as diagnostic fallback text.

Temporary schema files are created under the system temp directory with owner-only permissions and removed after the child process exits. Retained failure logs may still include raw structured values because logs contain child JSON events.

## Recursion and cancellation

Recursion is controlled with `PI_SUBAGENT_DEPTH`. Each child gets the parent environment plus agent env and an incremented depth. The public tool path does not pass `maxDepth`, so it defaults to 1: a subagent cannot spawn another subagent. `MAX_SUBAGENT_DEPTH` is only an absolute ceiling for direct programmatic callers that deliberately allow deeper nesting.

Abort handling sends SIGTERM and then SIGKILL after a short grace period. If `agent_end` is observed before the process exits, a post-agent-end grace timer allows Pi to flush output before the spawner finishes or kills the child.

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

- No subagent session inheritance through the `spawn_agents` tool.
- No automatic merging of subagent decisions into workspace changes.
- No parallel write coordination; built-in agents are read-only by convention.
- No dynamic agent reload mid-session.
- No persistent run database or dashboard.
- No unbounded recursive delegation.

## Change guidance

Preserve subagents as isolated, bounded child processes. Use subagents for read-only exploration, retrieval, review, and verification unless a custom agent explicitly broadens tools. When changing spawn arguments, update `API.md` if the programmatic surface changes. Add tests for loader parsing, CLI argument construction, depth/abort behavior, activity updates, and render output when relevant.
