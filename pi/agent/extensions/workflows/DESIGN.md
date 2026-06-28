# workflows extension design

The `workflows` extension owns deterministic foreground orchestration above the lower-level `subagents` process API. It should remain a narrow, safe primitive until background execution, persistence, saved scripts, and writable coordination are designed separately.

## Architecture

- `index.ts` registers the extension and before-agent-start guidance.
- `workflow-tool.ts` defines the `workflow` tool schema, validates scripts, connects runtime progress to partial updates, applies final-output spillover, and loads public subagent definitions.
- `parser.ts` performs AST-level validation and extracts literal metadata.
- `runtime.ts` starts the killable worker, mediates worker-to-parent RPC, tracks snapshots, and implements the narrow subagent policy wrapper.
- `worker-source.ts` builds the worker module that exposes only workflow globals to user scripts.
- `display.ts` provides compact width-aware call/result rendering.
- `types.ts` contains shared runtime and snapshot types.

## Runtime boundary

Workflow script logic runs in a separate Node worker created from generated module source. The parent can terminate this worker on cancellation or timeout, which prevents runaway script loops from blocking the main Pi process. Runtime-owned timeout and cancellation also abort the signal passed to in-flight subagent requests so child processes are not left running after the workflow boundary closes. The worker is not the only safety layer: scripts are also parsed before execution and dangerous globals are shadowed in the generated module.

Do not replace the worker with same-process `vm` execution. If the runtime changes, it must keep an explicitly killable boundary or an interpreter with equivalent cancellation guarantees.

## Script validation invariants

`parser.ts` must continue to enforce these Phase 1 rules before worker execution:

- first statement is literal `export const meta = { name, description }`
- no imports, re-exports, dynamic imports, or `require`
- no direct filesystem/network/process/global/buffer/worker/timer APIs
- no `Date.now`, `new Date`, or `Math.random`
- at least one syntactic `agent()` call

Validation is a guardrail, not a complete JavaScript sandbox. Keep the worker context minimal and avoid adding new globals unless their deterministic and security implications are tested.

## State and progress

Workflow state is in-memory for one foreground tool call. Snapshots include metadata, current phase, phase history, recent logs, agent states, per-subagent activity snapshots, failure count, timings, and result preview. Result previews use `safe-stringify.ts` so cyclic or otherwise unusual but structured-cloneable return values cannot turn a completed worker run into a formatting failure. `workflow-tool.ts` merges runtime snapshots with subagent state updates before sending partial tool updates.

There is no persisted run database in Phase 1.

## Subagents integration

The extension imports only from `../subagents/api.ts`. Phase 0 intentionally promotes `loadAgents`, `AgentDefinition`, and `BuiltinTool` so workflows does not import subagents internals.

The wrapper in `createWorkflowAgentSpawner` owns policy:

- default agent type is `explore`
- allowed agent types are `explore`, `research`, `deep-research`, and `review`
- `inheritSession` is always `"none"`
- arbitrary `env` is not forwarded
- cancellation signal is propagated
- model and thinking defaults come from the parent only when the selected agent does not specify them
- optional structured output is forwarded only as `{ output: { schema } }`
- bounded retry counts are clamped before dispatch and are applied only by runtime-owned retry logic

Do not expose raw `SpawnInvocation` fields to workflow scripts.

When a workflow calls `agent(prompt, { output: { schema } })`, the worker sends the schema through the parent RPC, `createWorkflowAgentSpawner` passes it to `spawnSubagent()`, and `subagents` loads the generic `structured-output` child extension. A successful structured outcome resolves the worker-side `agent()` promise to the parsed value. Text output remains the default for calls without `output`. Structured failures are ordinary agent failures with stable error codes and diagnostics; `parallel()` logs them and uses `null` for that branch, while `parallelSettled()` returns explicit failure records.

## Concurrency and failures

`parallel()` accepts thunks rather than already-started promises so the runtime controls concurrency. It preserves input order. A branch failure is logged and its result becomes `null`, allowing fan-in code to continue. `parallelSettled()` shares the same bounded scheduler but returns `{ ok: true, value }` or `{ ok: false, error }` records without incrementing workflow log failure count, so scripts can make explicit recovery decisions. `pipeline()` applies sequential stages per item while using `parallel()` across items.

If a top-level script error escapes `run()`, the whole workflow tool call fails. Parent-side subagent dispatch must always answer worker RPC with either a success response or an agent failure response; unexpected `spawnAgent` rejections are converted into worker-visible agent failures instead of leaving `agent()` promises pending. Agent failure responses should carry stable `WorkflowErrorCode` values and context details. Runtime retry is deliberately bounded and skips non-retryable classes such as policy rejection and aborts.

## Rendering and output

Renderers use shared width-aware helpers. Workflows and direct `spawn_agents` calls both reuse `subagents/render.ts`'s compact per-agent progress formatter so every subagent fits on one row. Final output goes through shared spillover, so large raw workflow results are stored in a managed temp file instead of flooding the context.

Subagent logs and spillover output may contain raw tool/model output. Keep documentation explicit about this behavior.

## Non-goals

Phase 1 does not include background execution, a `/workflows` TUI, saved scripts, journaled resume, model tiers, worktree isolation, or writable workflow coordination. It includes only small bounded per-agent retries, not a generalized retry policy framework. Structured output is intentionally limited to per-subagent workflow fan-in and does not define whole-workflow result schemas.

## Change guidance

- Add tests before broadening script globals or subagent options.
- Keep public API imports limited to `subagents/api.ts`.
- Prefer deterministic helper semantics over LLM-router behavior.
- Treat writable workflows as a new design, not a small option toggle.
