# Script

Run one bounded JavaScript body or reusable saved definition in a fresh child, with explicitly selected extension-provided capabilities. `script` is independent of MCP Gateway. [Monitor](../monitor/README.md) owns observation and continuation using this runtime. [MCP Gateway](../mcp-gateway/README.md#script-provider) optionally supplies `mcp.call`; the runtime does not require Gateway. [Web-access](../web-access/README.md#script-provider) optionally supplies `web.search` and `web.fetch`, independently of Gateway. [Builtins](../builtins/README.md#script-provider) optionally supplies active stock filesystem/shell methods with structured results; image reads require direct `read`.

## Usage

```js
script({
  action: "run",
  description: "Compute a small summary",
  providers: [],
  source: "return { total: [2, 3, 5].reduce((a, b) => a + b, 0) };",
});
```

Use `action: "describe"` with explicit `providers` to inspect method descriptions and positional argument schemas; `providers: []` lists all currently registered, host-permitted APIs. Discovery never invokes handlers or grants access. Methods with live readiness restrictions include an informational `available` boolean; readiness is rechecked before every dispatch, including queued calls. An unavailable selected provider fails closed; retry discovery with a narrower selection when an unrelated provider is unavailable or the output is too large.

Each selected namespace becomes a frozen guest object. For a fixture provider declaring `fixture.echo` with an integer argument:

```js
script({
  action: "run",
  description: "Aggregate fixture values",
  providers: ["fixture"],
  source: `
    const values = await parallel([() => fixture.echo(2), () => fixture.echo(3)]);
    return values.reduce((a, b) => a + b, 0);
  `,
});
```

For gateway composition, allow `mcp` in global `allowedProviders`, select `providers: ["mcp"]`, and call `mcp.call(name, args)`. Discover names with `mcp_search` and inspect schemas with `mcp_describe` first; inspect the returned envelope's `isError` and actual content shape. See the [gateway example and failure contract](../mcp-gateway/API.md#script-provider).

The fixture example requires a separately registered provider and host allowlist entry; registration alone grants no execution access. See [API.md](API.md) for provider registration and supported host execution.

Supply an async JavaScript **body**, not a module. Explicitly return JSON (`null` for no output), and await every call. Missing, cyclic, non-finite, function, bigint, non-plain-object, accessor, symbol, non-enumerable, sparse-array and extra-array-property results reject. Captured intrinsics and descriptor snapshots avoid guest serialization hooks. Values have a 100-level nesting bound. `parallel(thunks)` bounds independent work and preserves order; arbitrary `Promise.all` calls also obey the host queue. There is no guest logging/progress API.

## Saved Scripts

`list` discovers saved contracts; `validate` checks a named definition and JSON arguments without executing code or calling providers. `run` requires exactly one inline `source` or saved `name`. Named calls accept `args` (an object, default `{}`); inline calls remain async bodies and do not accept tool `args`. Every action still requires a nonsecret `description`.

```js
script({ action: "list", description: "Discover saved Scripts" });
script({
  action: "validate",
  description: "Validate summary input",
  name: "summarize-values",
  args: { values: [2, 3, 5] },
});
script({
  action: "run",
  description: "Summarize values",
  name: "summarize-values",
  args: { values: [2, 3, 5] },
  providers: [],
});
script({
  action: "run",
  execution: "background",
  description: "Summarize values asynchronously",
  name: "summarize-values",
  args: { values: [2, 3, 5] },
  providers: [],
});
```

The shipped [summarize-values.js](../../scripts/summarize-values.js) is an ordinary definition, loaded through the generic runtime. Definitions contain exactly a literal `export const meta` object followed by `export async function run()` with no parameters. Put helper functions inside `run`. Return strict JSON, or `null`. Imports, re-exports, top-level executable statements, computed metadata, spreads, duplicate metadata keys and nonliteral metadata are rejected. Metadata is parsed as data, never evaluated in the host. Compilation checks syntax but never executes the program. The guest entry point receives `args` as a data binding over JSON IPC, not interpolated JavaScript.

```js
export const meta = {
  name: "echo-value",
  description: "Return a validated string without provider calls.",
  args: {
    type: "object",
    properties: { value: { type: "string", maxLength: 200 } },
    required: ["value"],
    additionalProperties: false,
  },
  providers: [],
  limits: { maxCalls: 1, maxConcurrency: 1, timeoutMs: 5000 },
};
export async function run() {
  return { value: args.value };
}
```

All five metadata fields are required. Names are lowercase kebab-case (`^[a-z0-9][a-z0-9-]{0,63}$`); descriptions are nonblank, control-free and at most 240 characters. Argument schemas are plain JSON Schema draft-07 with root `type: "object"`, at most 16 KiB, strictly compiled by Ajv without coercion, defaults, schema downloads or format plugins. Unsupported keywords/formats/dialects, asynchronous schemas and unresolved external references reject. Metadata nesting is at most 32 levels and 20 KiB. Supplied arguments must be strict JSON, at most 64 KiB; invalid schema/args cause no provider calls. Validation proves neither runtime success nor authorization.

`meta.providers` declares requirements, not grants: every required provider must be explicitly selected in the run's `providers` and allowed by host policy. Additional explicitly selected providers still require host permission. `args` is reserved as a provider/helper name. Required finite positive `maxCalls`, `maxConcurrency`, and `timeoutMs` cannot exceed hard ceilings (128, 16, 300000). Effective limits are the minimum of definition and current host policy, never an expansion. Missing providers and invalid limits fail before execution. Provider permissions remain distinct from human approval, including for saved definitions.

There is one user-level store, `userScriptsDir`, default `<agentDir>/scripts`; no project stores or arbitrary file-path runs. Configure an absolute path globally or via `SCRIPT_USER_SCRIPTS_DIR`. The store directory may itself be a Stow symlink; individual `<name>.js` entries must be regular, nonsymlink files with a matching literal `meta.name`. Traversal, invalid names, nonregular/unreadable/oversized files and opened paths outside the resolved store reject. Inventory includes invalid entries and is bounded to 200 candidates, 256 KiB per definition, 2 MiB aggregate source and 24,000 bytes of JSON; `truncated` is explicit. Direct named lookup is independent of inventory truncation. Missing stores list empty. Edits are visible on the next invocation without reload.

Admission snapshots the definition and SHA-256 digest, validated arguments, selected registrations, policy, context and deadline before execution. Later edits do not change admitted work; provider disposal still revokes permission. Foreground results and background inspection identify the admitted name/digest. Background retains that identity even if interrupted before execution. Source and arguments are not added to its sidecar; normal tool history retains submitted arguments. No source copies, new result store, scheduler, nested saved runs, tool-based editing, retries or replay are introduced.

## Background execution

Foreground remains the default. To keep the conversation available, pass `execution: "background"` to `run`. The loaded [Background service](../background/README.md) validates and persists admission before returning a stable ID; missing service or nonpersistent sessions fail closed, never fall back. The same Script executor, provider records, scoped context, policy limits and original deadline apply. No retries or longer deadlines are added.

```js
script({
  action: "run",
  execution: "background",
  description: "Compute a summary",
  providers: [],
  source: "return { total: 10 };",
});
script({ action: "executions", description: "List background executions" });
// Replace EXECUTION_ID with the UUID returned by admission.
script({
  action: "inspect",
  description: "Inspect execution",
  id: "EXECUTION_ID",
});
script({
  action: "cancel",
  description: "Request cancellation",
  id: "EXECUTION_ID",
});
script({
  action: "dismiss",
  description: "Dismiss terminal attention",
  id: "EXECUTION_ID",
});
```

Control actions omit `providers`, `source`, `name`, `args` and `execution`. `executions` omits results; `inspect` returns one bounded result plus original executor accounting. Cancellation requests abort, not rollback. Dismissal rejects active work and clears terminal attention without deleting evidence. Background automatically sends a bounded terminal notification with an inspection reference, including failures and interruptions; the model need not poll. Its below-editor row respects drafts, active turns and sibling widgets. See [notification integrity, retention and limits](../background/README.md) before interpreting handoff or consumption as completion.

The former background `list` action is now `executions`; `list` exclusively discovers saved definitions, matching Workflows. Existing inline run and provider describe calls are unchanged.

## Tool display

The call row shows the action, provider selection or discovery scope, and nonsecret description. Execution uses `providers: web, mcp` or `providers: none`; discovery uses `scope: web, mcp` or `scope: all` for `[]`. Here, **all** means currently registered, host-permitted providers, not unrestricted access. Selection is a request, not proof of permission, availability, or user approval. More than three selected names use a `+N more` suffix; expand for the full selection.

Collapsed results show `completed · no calls` for successful zero-call runs, whether or not providers were selected; otherwise they show successful call counts or discovery provider/method counts. Empty discovery says no permitted providers were discovered; it does not imply that no extensions are installed. Failures show a safe reason rather than an unhelpful zero-call count. Cancellation, timeout, partial execution, and unknown outcomes remain distinct, with effect warnings visible even when collapsed.

Saved list/validate rows show bounded status and names/invalid-entry diagnostics when expanded, never argument schemas, argument values or source. Validation is labeled not executed.

Expand for discovered method names, attempted/succeeded call counts, traces, fixed error codes, and recovery guidance. Raw source, arguments, returned JSON, schemas, intermediate values, and exception text never appear in custom tool rows; explicit JSON and schemas still appear in the framed model-facing result. Labels and detail lines are sanitized and truncated to terminal width.

## Policy and configuration

Only global `extension:script` settings and environment overrides apply, never project settings. Invalid settings, malformed/unreadable global JSON (other than a missing file), invalid provider lists or limits disable execution rather than relaxing policy. Settings are sampled on every execution/discovery; environment values take precedence. `/script-config` displays effective policy and limits.

| Field              | Default              | Environment override       | Description                                                                                               |
| ------------------ | -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `userScriptsDir`   | `<agentDir>/scripts` | `SCRIPT_USER_SCRIPTS_DIR`  | Absolute user-level saved-definition directory; no project override.                                      |
| `allowedProviders` | `[]`                 | `SCRIPT_ALLOWED_PROVIDERS` | Explicit namespace allowlist, at most 32 unique names. Environment value is a JSON array, not CSV or `*`. |
| `maxCalls`         | `32`                 | `SCRIPT_MAX_CALLS`         | 1–128 attempted provider calls per execution.                                                             |
| `maxConcurrency`   | `4`                  | `SCRIPT_MAX_CONCURRENCY`   | 1–16 concurrent host handlers; excess calls queue FIFO.                                                   |
| `timeoutMs`        | `120000`             | `SCRIPT_TIMEOUT_MS`        | 1–300000 ms total execution deadline.                                                                     |

```json
{
  "extension:script": {
    "allowedProviders": ["fixture"],
    "maxCalls": 32,
    "maxConcurrency": 4,
    "timeoutMs": 120000
  }
}
```

Host execution callers may further narrow providers and limits, never expand global policy. Guest code receives neither the policy nor the host API. Permission is **not user approval**: obtain action authorization before mutations. Nested calls do not synthesize Pi `tool_call` hooks; gate the outer `script` tool if local policy requires it. Providers own their credential handling, authorization, argument-sensitive admission, transport deadlines and result redaction. The core does not expose arbitrary Pi tools or import MCP-specific admission/redaction.

## Failures and lifecycle

Only the explicit JSON result and bounded host accounting return. A guest catch cannot erase host-observed failures. A failed run may retain returned JSON; inspect status first. Traces retain call IDs, validated dispatched method names, states, durations and fixed failure codes, not arguments, intermediate values, source or exception text. Unknown/unselected method names never enter traces.

Entering a handler is conservatively considered dispatch, even if that handler subsequently rejects during its own admission. Every dispatch sets `effectsMayPersist`; an unsuccessful run with dispatch sets `partialExecution`. Handler exceptions, invalid provider results, and dispatched work unsettled at termination set `outcomeUnknown`. A provider can explicitly report a known failure or unknown outcome without throwing, or reject with one of its declared public error codes. Declared codes remain in host traces even after a guest catch. Unknown outcomes also force failed status. Cancellation is not rollback or proof of nonexecution. Successful writes may survive later failures. There are **no automatic retries, grants, approval polling, or replay**.

Cancellation/deadline closes admission, aborts handlers, kills the child with SIGKILL and waits for process close. Returning while calls remain queued/running fails. Late handler settlements cannot change the finalized receipt or dispatch queued calls. Providers must cooperate with cancellation; the runtime cannot forcibly stop arbitrary trusted host JavaScript or external effects. Removing a selected registration aborts its active executions. The agent tool cancels on shutdown and tree navigation; host callers own their execution signals and session lifetime.

## Isolation and bounds

Script uses a permissioned Node child and a separate VM, without a runtime dependency on Gateway. The child receives an empty environment, trusted bootstrap/source via stdin, ignored stdout/stderr, and string-only JSON IPC. Node permission mode grants no filesystem, network, subprocess, worker, addon or inspector access. Guest imports and string/Wasm code generation are disabled; host objects, credentials and the event bus are never guest bindings. Required flags must exist or execution fails closed. Node 25.9.0 is fixture-qualified; use the repository's pinned version.

Source is at most 256 KiB; each serialized IPC envelope at most 16 MiB; explicit returned JSON at most 24,000 UTF-8 bytes. Oversized returns fail (`output_limit` or `ipc_limit`), are not spilled or silently truncated, and must not trigger automatic replay. Tool discovery also rejects over-limit output. Accounting contains at most 128 traces. These limits do not prevent all allocations before size checks.

This is **not a hostile multi-tenant OS sandbox**. There are no CPU/memory quotas or memory-exhaustion guarantees. Node/VM vulnerabilities, trusted same-user extensions, synchronous host handlers, and malicious schema/resource exhaustion require an outer isolation boundary. A wall-clock timeout cannot interrupt synchronous host code blocking Pi's event loop.

## Retention and troubleshooting

Foreground writes no retained logs, temporary source files or result spills. Background retains bounded outcomes/accounting in a separate [session sidecar](../background/README.md#persistence-and-limits), not source. Pi session history retains submitted arguments and returned output/accounting. Descriptions are display-only: keep them nonsecret. Renderers sanitize terminal controls and bound labels, but generic secret detection is not possible. Providers must exclude credentials from public schemas, descriptions, and values delivered to the guest. Explicitly returning sensitive data includes it in history; the runtime is not a general secret filter.

- `capability_denied`: check the global allowlist and caller ceiling; policy changes require authorization.
- `invalid_selection`: supply explicit, unique provider names, or `[]` for pure computation.
- `provider_conflict`: inspect duplicate namespace registrations; do not rely on load order.
- `capability_unavailable`: verify registration and provider readiness; no fallback provider is selected.
- `invalid_config`: inspect `/script-config` and global settings.
- `output_limit`: for discovery, select fewer providers; for execution, reduce the explicit returned JSON. Neither path spills oversized output, and execution must not be automatically replayed.
- `discovery_unavailable`: an unclassified discovery failure; inspect provider loading/readiness and `/script-config`. Raw exception details are suppressed.
- `invalid_arguments`: inspect the selected method's positional-array schema.
- `invalid_source`: supply a nonblank async JavaScript body in `source`, at most 256 KiB, not a module.
- `invalid_result`: explicitly return strict JSON or `null`; accessors and non-JSON values reject.
- `script_error`: inspect the body and discovered method schemas; raw guest exceptions are suppressed.
- `call_limit`: reduce attempted calls; queued calls also consume the limit.
- `unfinished_calls`: await every provider call before returning.
- `deadline_exceeded`, `cancelled`: inspect configured/provider deadlines or the cancellation cause; neither proves nonexecution.
- `nested_call_failed`: inspect individual failed-call codes; guest catches do not erase host failures.
- `provider_error`, partial execution or unknown outcome: reconcile provider effects before any further action.
- `isolation_unavailable`: use a Node version with the required permission flags; never remove the flags to bypass this failure.
- `executor_unavailable`: inspect the extension installation and qualified Node version; setup exceptions are suppressed.
- `sandbox_error`, `sandbox_exit`: inspect host process health/resource limits and the runtime installation; child output is intentionally suppressed.
- `ipc_error`, `invalid_ipc`: inspect runtime installation/version compatibility and host process health; broken or malformed IPC is not exposed or automatically replayed.
- `ipc_limit`: reduce provider arguments, intermediate results, or final JSON and inspect provider output limits.

After any dispatched failure, reconcile provider effects before further action. Recovery guidance never authorizes automatic replay.

The executor itself adds no persistence/resume, subscriptions, scheduling or session control. Optional background tool execution uses the separate shared Background lifecycle service; restoration never resumes an executor. Host callers still own scheduling and lifetime separately. See [DESIGN.md](DESIGN.md) for invariants and fixture coverage.
