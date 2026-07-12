# structured-output Design

`structured-output` provides a reusable schema-backed final-output tool for Pi sessions. It intentionally owns only the generic tool contract; callers own task-specific prompting and schema-file lifecycle.

## Architecture

- `index.ts` is the extension entry point. It loads config, reads the configured schema file, registers `structured_output` when active, and registers `/structured-output-config`.
- `config.ts` owns settings/env merging and validation.
- `api.ts` is the stable public surface for other extensions. Import constants from it instead of from `index.ts`.

## State and lifecycle

The extension is no-op by default. On `session_start` and `before_agent_start`, it loads effective config for the current cwd. If `schemaFile` is unset, it registers nothing. If `schemaFile` is set and contains a JSON object, it registers `structured_output`. Explicit object-root schemas use `Type.Unsafe(schema)` directly. Every other root is nested under a required `value` property in a provider-facing object schema, then unwrapped during execution. This preserves arbitrary JSON root values while satisfying providers that require function parameters to have an object root.

A `registeredKey` prevents re-registering the same schema path and terminate setting repeatedly in one process. If config changes to a different active key, the extension registers the new tool definition under the same stable name.

The extension tracks capture and reminder state for the current user-initiated run. When `agent_settled` fires without a captured value, terminal provider error, pending continuation, or exhausted reminder budget, it sends a focused follow-up through `pi.sendUserMessage()`. The resulting `before_agent_start` is marked as a reminder turn so it does not reset the budget. A later external turn resets capture and reminder state. This keeps repair in the same process and context while guaranteeing bounded termination.

## Tool contract

The public contract is fixed:

- tool name: `structured_output`
- details shape: `{ value }`, where `value` is the caller's schema-backed value rather than any provider envelope
- default termination: `true`

Keep the name and details shape stable. Other extensions consume JSON-mode `tool_execution_end` events for this name and read `result.details.value`.

## Boundaries

The extension does not know why structured output is needed. It does not inject task-specific guidance, choose schemas, or manage temporary schema files. Its generic missing-call reminder only asks the agent to invoke the configured tool without repeating the work. Callers such as `subagents` append their own task-specific system-prompt instructions and pass schema files through environment overrides.

The extension validates only that the schema file root is a JSON object before registering the tool. Pi/tool-provider schema validation owns parameter validation for the tool call; callers may add their own parent-side validation before consuming `details.value`. Keep the provider-facing envelope internal: consumers must not need to know whether a schema root was wrapped.

## Change guidance

Preserve the no-op-by-default behavior so the extension can be globally enabled. If new config fields are added, expose environment overrides and update `/structured-output-config` docs. Put cross-extension constants in `api.ts`, not `index.ts`.
