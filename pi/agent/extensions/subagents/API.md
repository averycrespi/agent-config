# subagents API

Curated cross-extension surface for centrally governed subagent execution. Import only from `api.ts`; anything else is internal.

```ts
import {
  runSubagent,
  formatSpawnFailure,
  createSubagentActivityTracker,
  validateOutputSchema,
} from "../subagents/api.ts";
import type {
  Capability,
  LiveModelRegistry,
  ModelTier,
  RunSubagentRequest,
  SpawnOutcome,
  StructuredOutputSpec,
  SubagentRunState,
  ThinkingLevel,
} from "../subagents/api.ts";
```

## `runSubagent(request)`

```ts
interface RunSubagentRequest {
  intent: string;
  prompt: string;
  capabilities: Capability[];
  modelTier: "small" | "medium" | "large";
  thinking: ThinkingLevel;
  files?: string[];
  output?: StructuredOutputSpec;
  cwd: string;
  signal?: AbortSignal;
  logId?: string;
  onEvent?: (event: unknown) => void;
  modelRegistry: LiveModelRegistry;
}
```

Every invocation loads central `extension:subagents` policy, resolves the requested tier to a full model selector, looks it up in the trusted live registry, verifies thinking against Pi's runtime-supported levels, expands fixed capabilities, and only then starts a child. Invalid requests return a failed `SpawnOutcome` without launching.

Authority fields are deliberately absent: callers cannot provide raw tools, extensions, exact models, environment, system prompts, session/recursion controls, skills/templates, context-file behavior, roles, or presets. `capabilities: []` is valid. Structured output automatically composes its own tool/extension contract.

The trusted registry dependency is narrow:

```ts
interface LiveModelRegistry {
  find(provider: string, modelId: string): unknown;
}
```

Callers should pass `ctx.modelRegistry` from the current Pi extension execution context. Do not synthesize model objects or infer support from tier names.

### Capabilities

```ts
type Capability = "read-filesystem" | "exec-shell" | "read-broker" | "read-web";
```

The effective grants and global ceilings are documented in [README.md](./README.md). `exec-shell` is mutable authority. Child processes inherit the parent environment.

### `SpawnOutcome`

The outcome contains `ok`, `aborted`, stdout/stderr, exit/signal metadata, optional provider/structured error code, optional finalized `logFile`, bounded diagnostic warnings, and optional structured result. Provider-terminal errors remain failures even when the process exits zero. A later successful assistant message may clear an earlier transient provider error.

Failed or aborted children may retain a complete owner-only `.log.gz`; successful children delete staging. Callers must treat retained logs as sensitive and never preview or send them automatically.

## Structured output

```ts
interface StructuredOutputSpec {
  schema: Record<string, unknown>;
}
```

When `output` is present, execution adds the generic structured-output extension/tool, requires a final tool call, captures the value, and validates it parent-side. `SpawnOutcome.ok` becomes false for missing, incomplete, malformed, tool-error, or schema-invalid output.

### `validateOutputSchema(schema, path?)`

Returns every error for the supported subset or `[]` when valid. Model-facing callers should validate before any parallel launch so malformed schemas fail atomically. `runSubagent()` assumes trusted callers have validated schemas; the direct tool and workflow boundary do so.

## `formatSpawnFailure(outcome)`

Canonical failure formatter including primary process/provider/structured diagnostics, finalized log path, and bounded secondary warnings when present.

## Activity tracking

### `createSubagentActivityTracker(options)`

Creates the shared event-driven tracker. Feed child events through `handleEvent()` and always call `finish()` so UI state settles. `SubagentRunState` uses intent as identity and can carry capabilities, model tier, thinking, status, timings, tool/token counts, terminal errors, and log paths.

Tool arguments are not a display contract and should not be copied into renderable state. Consumers must preserve control-safe, bounded, width-aware rendering.

## Intentionally internal

The raw process spawner, raw invocation type, extension resolver, capability translation internals, config injection seams, recursion/session controls, and CLI builder are not exported. Colocated engine tests may import internal modules; other extensions must use `runSubagent()`.
