# Code mode

Optional `code({description, source})` composes MCP Gateway calls in one fresh permissioned Node child, filtering intermediate responses before returning a compact JSON value. It requires the active [MCP Gateway extension](../mcp-gateway/README.md); ordinary `mcp_search`, `mcp_describe`, `mcp_call`, and read-mostly `workflow` remain unchanged.

Trusted sibling extensions can use the [supported host executor API](API.md). [Monitor](../monitor/README.md) schedules fresh observations through that API without pending model turns; ordinary `code` remains one execution, and Loop remains message-based continuation.

Prefer direct `mcp_call` for straightforward calls whose results are useful as-is. Use `code` when bounded pagination, dependent lookups, or filtering/aggregation materially reduces intermediate context or model round trips. Do not use it for subagent reasoning or persistent polling.

## Usage

Search with `mcp_search` when the exact tool name is unknown, and inspect its schema with `mcp_describe` before invocation. Reuse already inspected names and schemas in the current context unless errors or evidence indicate they changed; host-side admission checks still apply. Supply a required nonblank `description` (at most 200 characters) naming the invocation's concrete action and target, plus an async JavaScript **body**, not a module, as `source`:

```js
code({
  description: "Sum values from the first page of items",
  source: `
const first = await mcp.call("example.list", { page: 1 });
const ids = first.structuredContent?.ids;
if (first.isError || !Array.isArray(ids) || !ids.every((id) => typeof id === "string"))
  throw new Error("Expected a successful list of string IDs");
const values = await parallel(
  ids.map((id) => async () => {
    const result = await mcp.call("example.get", { id });
    const value = result.structuredContent?.value;
    if (result.isError || typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Expected a successful finite numeric value");
    return value;
  }),
);
return values.reduce((sum, value) => sum + value, 0);
`,
});
```

The description labels the tool row; it does not affect execution or authorization and is not passed to the child. Avoid secrets and raw payloads: Pi retains submitted arguments in session history. Display text is sanitized, gateway-credential-redacted, and width-truncated. Older history or incomplete arguments without a usable description display “MCP composition”.

These are illustrative names: use the actual discovered schemas. `mcp.call(name, args)` resolves the complete redacted MCP result, including `content`, `structuredContent`, `isError`, and any supplied metadata. It never parses text as JSON or invents pagination/completeness fields. Check `isError` and inspect the actual content shape before consuming the application payload. Provider `isError` results remain available to the program and count as host-observed failures. Gateway exceptions reject with `code`, optional validated `reason`/`invocationId`, and `outcomeUnknown`; raw exception messages and guidance are deliberately excluded to prevent intermediate-data leakage.

`parallel(thunks)` runs independent functions with bounded concurrency and preserves input order. A branch rejection rejects the helper; no branch is retried. The host also queues arbitrary concurrent `mcp.call` requests, including `Promise.all`, under the same limit. Await all calls before returning: returning with unfinished calls fails and cancels outstanding work.

Explicitly return a JSON value, or `null` for no output. Missing, cyclic, non-finite, function, bigint, and non-plain-object returns fail, as do accessors, symbol/non-enumerable properties, and sparse or extra-property arrays. Return validation uses captured intrinsics and serializes a plain snapshot without guest `toJSON` hooks. Source is limited to 256 KiB; values are limited to 100 nesting levels. Only the returned value and bounded host status/failure metadata enter model context. There is no guest log/progress API. Script exception text, stdout/stderr, arguments, and intermediate responses are not returned or retained by this extension.

## Authorization and failures

Gateway grants authorize each nested operation independently. **Gateway permission is not user approval**: obtain applicable action authorization before running mutations. The bridge is not a new intent-approval mechanism. Nested calls do not synthesize ordinary Pi `tool_call` hooks or SDK sessions; local hooks that only inspect `mcp_call` are not nested-call approval gates. Gate the outer `code` tool when a local policy needs that boundary.

The active gateway client's endpoint, credentials, read-only setting, per-call deadlines, response limits, and credential-rotation cancellation remain authoritative. Each nested call refreshes the current filtered catalog and validates its arguments locally with strict Ajv before dispatch, pinning credential identity through invocation. Supported schemas are JSON Schema draft-07 and explicit draft-2020-12, with standard `ajv-formats` formats and the string-valued `x-mcp-header` provider annotation (header routing remains gateway-owned). Other unsupported keywords/formats/dialects, async schemas, and unresolved external references reject before transport. There is no coercion, default insertion, schema download, or composition-specific tool/action allowlist. Existing annotation-based read-only filtering is not argument-sensitive proof of a multiplexed operation's behavior.

The tool row keeps a stable `code <description>` header with an unindented status line: `running...`, `completed · N calls`, or `failed · N calls`, followed by an error code when present. Running uses warning styling, completion success styling, and failure error styling. Unknown-outcome and partial-execution warnings remain visible when collapsed.

The result identifies status, call/success counts, failures, partial execution, and unknown outcomes. Catches cannot erase host-observed failures: a returned value can accompany a failed status. Expand the tool row for bounded call IDs, dispatched tool names, timings (queue/admission included), states, codes, validated reasons, and invocation IDs. Calls rejected before dispatch show `(not dispatched)` rather than echoing unvalidated guest input. No argument or response previews are retained. Renderers sanitize terminal controls and redact gateway bearer shapes before styling.

Execution is **not transactional**. Successful writes can survive a later failure; concurrent calls can have different outcomes. `effectsMayPersist` conservatively applies to every dispatched call, including reads, because annotations do not prove absence of effects. `partialExecution` means calls were dispatched and the program did not succeed. `outcomeUnknown` marks uncertain gateway outcomes or calls still dispatched when execution stopped. Cancellation is not rollback or proof of nonexecution.

No automatic grants, approval polling, invocation retries, or program replay occurs. Any subsequent call, including an explicit grant-request tool, needs an ordinary caller decision and applicable authorization. Inspect uncertainty before deciding what to do next.

## Isolation and lifecycle

A fresh child receives an empty environment and only stdin source plus parent-mediated JSON IPC. It starts with Node permission mode, no filesystem/network/subprocess/worker/addon/inspector grants, and string code generation disabled. A separate VM context removes Node globals, denies imports (including data URLs), and disables string/Wasm generation; VM/source filtering alone is not the isolation boundary. Required Node flags, including network-permission support, must be available or execution fails closed. The repository's pinned Node 25.9.0 is fixture-qualified; older Node versions may not provide network restrictions.

The host validates IPC shape, IDs, call count, names, and schemas before invocation. Guests cannot change endpoint, tokens, restrictions, or accounting. Cancellation/deadline closes admission, aborts active gateway work, kills the child with SIGKILL, and waits for process exit. Late transport settlements cannot modify the finalized snapshot or cause more dispatch. Session shutdown cancels active children. There is no persistent interpreter, background job, resume, replay, or rollback.

This is not a hostile multi-tenant OS sandbox. Node/VM implementation vulnerabilities and same-user host extensions are outside this boundary. There is **no CPU or memory quota and no memory-exhaustion protection**. Response/IPC bounds and deadlines do not bound all allocations or protect the parent from every malicious schema/resource-exhaustion attack. Use an outer OS isolation layer for that threat model.

## Configuration

Only global settings under `extension:code-mode` and environment overrides are honored, not project settings. The limits are deliberately finite and reversible; invalid values, non-object/null sections, unreadable settings (except an absent file), or malformed global JSON disable execution rather than silently increasing a requested restriction. `/code-mode-config` shows effective limits and validity. Settings are sampled for each outer call; environment overrides win when present.

| Field            | Default  | Environment override        | Description                                                               |
| ---------------- | -------- | --------------------------- | ------------------------------------------------------------------------- |
| `maxCalls`       | `32`     | `CODE_MODE_MAX_CALLS`       | 1–128 attempted nested calls; over-cap requests terminate the program.    |
| `maxConcurrency` | `4`      | `CODE_MODE_MAX_CONCURRENCY` | 1–16 simultaneous nested calls, including discovery/admission.            |
| `timeoutMs`      | `120000` | `CODE_MODE_TIMEOUT_MS`      | 1–300000 ms total runtime deadline, retaining gateway per-call deadlines. |

```json
{
  "extension:code-mode": {
    "maxCalls": 32,
    "maxConcurrency": 4,
    "timeoutMs": 120000
  }
}
```

## Output and retention

Final framed text above 25,000 characters uses the [shared spill convention](../_shared/README.md#spillover-behavior): `${tmpdir()}/pi-extension-spillover/`, owner-only directory/files, unique names, lazy seven-day deletion, and a bounded 2,000-byte preview. Spilled output is explicitly identified. If persistence fails, output is omitted with `overflow_not_retained` and a semantic tool error, never an unbounded inline fallback or silently truncated success. IPC envelopes above the gateway's 16 MiB response bound terminate with `ipc_limit`; no aggregate byte-budget setting is introduced.

No separate retained logs or source copies are written. Pi's ordinary session history retains the submitted source, returned value/spill reference, and metadata-only traces until that history is deleted. Spills contain only explicitly returned data, gateway-credential-redacted and framed as untrusted, not all intermediate results. Bearer redaction is not a general secret filter: a program can explicitly return other sensitive data. Handle session history and spill files accordingly; manually delete spills when no longer needed. Gateway/server-side audit and retention are independent.

## Fixture value evidence

Run `npx tsx --test pi/agent/extensions/code-mode/value.test.ts`. It executes both the real direct `mcp_call` adapter and the real code child against identical HTTP fixtures and asserts equal answers. It tokenizes each unique tool-call-plus-result transcript once using `gpt-tokenizer`'s `cl100k_base` encoding; common discovery, system/tool schemas, final answers, and cumulative resending/billing are excluded. Model tool round trips assume independent direct calls share a turn; HTTP discovery and invocation counts are not model round trips.

| Scenario             | Direct tokens | Code tokens | Direct/code model tool rounds |
| -------------------- | ------------: | ----------: | ----------------------------: |
| Pagination/filtering |          4687 |         237 |                         3 / 1 |
| Dependent lookups    |          9392 |         188 |                         2 / 1 |
| Aggregation          |          4691 |         184 |                         1 / 1 |

These deterministic large-payload fixtures demonstrate context reduction, not universal savings, provider-specific billing, latency improvements, or live-provider qualification. Small calls, larger source programs, and returned bulk data can erase savings.

## Non-goals

No TypeScript compilation/type generation, arbitrary extension dispatch, shell/filesystem capabilities, caches/result handles, saved programs, workflow orchestration, automatic approval handling, CPU/memory quotas, or gateway-server changes. Installation and running-session changes require separate authorization.
