# Script

Run one bounded JavaScript body in a fresh child, with explicitly selected extension-provided capabilities. `script` is independent of MCP Gateway and coexists with legacy [Code mode](../code-mode/README.md); it does not migrate Code mode, Monitor, Loop, or Session Watch. [MCP Gateway](../mcp-gateway/API.md#script-provider) optionally supplies `mcp.call`; the runtime does not require Gateway. [Web-access](../web-access/README.md#script-composition) optionally supplies `web.search` and `web.fetch`, independently of Gateway.

## Usage

```js
script({
  action: "run",
  description: "Compute a small summary",
  providers: [],
  source: "return { total: [2, 3, 5].reduce((a, b) => a + b, 0) };",
});
```

Use `action: "describe"` with explicit `providers` to inspect method descriptions and positional argument schemas; `providers: []` lists all currently registered, host-permitted APIs. Discovery never invokes handlers or grants access. An unavailable selected provider fails closed; retry discovery with a narrower selection when an unrelated provider is unavailable or the output is too large.

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

## Policy and configuration

Only global `extension:script` settings and environment overrides apply, never project settings. Invalid settings, malformed/unreadable global JSON (other than a missing file), invalid provider lists or limits disable execution rather than relaxing policy. Settings are sampled on every execution/discovery; environment values take precedence. `/script-config` displays effective policy and limits.

| Field              | Default  | Environment override       | Description                                                                                               |
| ------------------ | -------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `allowedProviders` | `[]`     | `SCRIPT_ALLOWED_PROVIDERS` | Explicit namespace allowlist, at most 32 unique names. Environment value is a JSON array, not CSV or `*`. |
| `maxCalls`         | `32`     | `SCRIPT_MAX_CALLS`         | 1–128 attempted provider calls per execution.                                                             |
| `maxConcurrency`   | `4`      | `SCRIPT_MAX_CONCURRENCY`   | 1–16 concurrent host handlers; excess calls queue FIFO.                                                   |
| `timeoutMs`        | `120000` | `SCRIPT_TIMEOUT_MS`        | 1–300000 ms total execution deadline.                                                                     |

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

The legacy executor's permissioned Node child and separate VM pattern are retained here without a runtime dependency on Code mode or Gateway. The child receives an empty environment, trusted bootstrap/source via stdin, ignored stdout/stderr, and string-only JSON IPC. Node permission mode grants no filesystem, network, subprocess, worker, addon or inspector access. Guest imports and string/Wasm code generation are disabled; host objects, credentials and the event bus are never guest bindings. Required flags must exist or execution fails closed. Node 25.9.0 is fixture-qualified; use the repository's pinned version.

Source is at most 256 KiB; each serialized IPC envelope at most 16 MiB; explicit returned JSON at most 24,000 UTF-8 bytes. Oversized returns fail (`output_limit` or `ipc_limit`), are not spilled or silently truncated, and must not trigger automatic replay. Tool discovery also rejects over-limit output. Accounting contains at most 128 traces. These limits do not prevent all allocations before size checks.

This is **not a hostile multi-tenant OS sandbox**. There are no CPU/memory quotas or memory-exhaustion guarantees. Node/VM vulnerabilities, trusted same-user extensions, synchronous host handlers, and malicious schema/resource exhaustion require an outer isolation boundary. A wall-clock timeout cannot interrupt synchronous host code blocking Pi's event loop.

## Retention and troubleshooting

No retained logs, temporary source files or result spills are written. Pi session history retains submitted arguments and returned output/accounting. Descriptions are display-only: keep them nonsecret. Renderers sanitize terminal controls and bound labels, but generic secret detection is not possible. Providers must exclude credentials from public schemas, descriptions, and values delivered to the guest. Explicitly returning sensitive data includes it in history; the runtime is not a general secret filter.

- `capability_denied`: check the global allowlist and caller ceiling.
- `capability_unavailable`: verify registration and provider readiness; no fallback provider is selected.
- `invalid_config`: inspect `/script-config` and global settings.
- `invalid_arguments`: inspect the selected method's positional-array schema.
- `provider_error`, partial execution or unknown outcome: reconcile provider effects before any further action.
- `isolation_unavailable`: use a Node version with the required permission flags; never remove the flags to bypass this failure.

No persistence/resume, subscriptions, background jobs, model continuation or session control is added. Future supervisors may call the host API but must own scheduling and lifetime separately. See [DESIGN.md](DESIGN.md) for invariants and fixture coverage.
