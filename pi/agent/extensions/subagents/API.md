# subagents API

Programmatic integration surface for the `subagents` extension.

Import from `api.ts`:

```ts
import {
  loadAgents,
  spawnSubagent,
  formatSpawnFailure,
  createSubagentActivityTracker,
} from "../subagents/api.ts";
import type {
  AgentDefinition,
  BuiltinTool,
  SpawnInvocation,
  SpawnOutcome,
  SubagentActivityOptions,
  SubagentActivityTracker,
  SubagentEvent,
  SubagentPhase,
  SubagentRunState,
} from "../subagents/api.ts";
```

Anything not exported from `api.ts` should be treated as internal.

## Agent definitions

### `loadAgents(): AgentDefinition[]`

Loads Markdown-defined subagent definitions from the configured Pi agent directory. This is the narrow public loader for extensions that need to resolve an agent type before calling `spawnSubagent(...)` directly.

`AgentDefinition` includes the resolved public fields used to build a safe spawn invocation: `name`, `description`, `tools`, `extensions`, optional `model` / `thinking`, optional `env`, `systemPrompt`, `disableSkills`, and `disablePromptTemplates`.

`BuiltinTool` is the union of built-in tool names allowed in subagent definitions.

## Process spawning

### `spawnSubagent(options: SpawnInvocation): Promise<SpawnOutcome>`

Low-level child-process spawn used by `spawn_agents` under the hood. Use this when another extension needs to run a Pi subagent directly instead of going through the LLM tool interface.

Notable `SpawnInvocation` fields:

- `prompt` — task sent to the child agent
- `toolAllowlist` — built-in Pi tools to allow in the child process
- `extensionAllowlist` — extension short names to resolve and load in the child process
- `cwd` — working directory for the child process
- `signal` — optional cancellation signal
- `onEvent` — optional callback for streamed child-process events
- `model`, `thinking`, `systemPrompt` — optional runtime overrides
- `inheritSession` — `"none"` or `"fork"`
- `disableSkills`, `disablePromptTemplates` — optional startup restrictions
- `env` — extra environment variables merged into the child process; `PI_SUBAGENT_DEPTH` is always set by the spawner and overrides any caller-provided value

`SpawnOutcome` reports whether the spawn succeeded and includes the final `stdout`, `stderr`, exit metadata, and optional `errorMessage` / `logFile`.

### `formatSpawnFailure(outcome: SpawnOutcome): string`

Canonical formatter for a failed `SpawnOutcome`. Produces the same error text rendered when one agent within `spawn_agents` fails.

## Activity tracking

### `createSubagentActivityTracker(options: SubagentActivityOptions): SubagentActivityTracker`

Creates the live activity tracker used by `spawn_agents` to summarize subagent progress, recent tool activity, token counts, and final status.

Use this when another extension wants the same progress-tracking behavior around direct `spawnSubagent(...)` calls.

`SubagentActivityTracker` exposes:

- `state` — current `SubagentRunState`
- `handleEvent(event)` — feed streamed child events into the tracker
- `finish(outcome)` — finalize state and clear UI hooks

## Shared types

### `SubagentEvent`

Recent activity item recorded by the tracker:

```ts
interface SubagentEvent {
  kind: "tool" | "stderr";
  text: string;
}
```

### `SubagentRunState`

Current tracker state for one running subagent, including phase, recent events, tool counts, optional last output, and optional error/log metadata.

### `SubagentPhase`

String phase label used by the tracker (`"starting"`, `"thinking"`, tool names, `"done"`, `"error"`, `"aborted"`, etc.).
