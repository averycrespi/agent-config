# Code mode design

Code mode is a bounded MCP composition surface, not a workflow extension or a replacement tool pipeline. Only the owning parent has gateway authority; each guest is disposable.

## Modules and integration

- `index.ts` registers `code`, config inspection, semantic error promotion, and session cancellation. It requests exactly one active gateway facade at execution time, independent of extension load order.
- `config.ts` accepts global/environment finite limits only. Invalid limits disable execution. Nothing from guest IPC influences configuration.
- `runtime.ts` owns call IDs, admission, the FIFO concurrency queue, traces, cancellation, deadline, and child termination. `_spawn` is the narrow test seam; production uses real Node children.
- `sandbox-source.ts` emits a trusted stdin bootstrap, separate VM setup, and separately compiled guest source. Guest bindings communicate with strings only. No parent objects, tokens, endpoint, environment, or event bus reach the child.
- `tool.ts` separates host status from framed returned data, enforces output/spill fallback bounds, and renders metadata without source/arguments/payloads.
- `runtime.test.ts`, `tool.test.ts`, and `value.test.ts` exercise real children and gateway HTTP fixtures. Compromised-bootstrap tests deliberately bypass guest helpers to test host IPC admission and the underlying Node permission boundary.

The only cross-extension runtime surface is [gateway `api.ts`](../mcp-gateway/API.md). Its session event handshake avoids a module-global client shared accidentally across SDK sessions or reloads. The gateway factory installs a listener; only an active, nonconflicting instance responds. Shutdown removes the listener and closes the client. Trusted Pi extensions already have host authority; this API is not a same-process extension sandbox.

## Admission and fidelity

A call reserves its monotonically increasing ID and finite program slot synchronously, before asynchronous work. Invalid envelope shapes/IDs or over-cap attempts end the run. A FIFO host queue enforces concurrency even when guest scheduling is bypassed. Each admitted call uses the gateway client operation deadline and fresh filtered discovery; strict schema validation runs before dispatch and the discovery credential identity is pinned through the request. No alternate endpoint, credential, transport, grant, or retry path exists.

The gateway client optionally performs this stronger admission without changing ordinary three-argument `callTool` behavior. Raw redacted `CallResult` objects preserve unknown metadata fields through IPC. Provider `isError` marks the host trace failed but still resolves the raw value to the guest; gateway exceptions reject with metadata only. The host never derives code/reason/uncertainty from remote prose or guest exceptions.

Traces are host-owned and bounded by the call limit. Tool names are exposed only after admission; rejected arbitrary names and arguments cannot become an indirect intermediate-data channel. Timings start at reservation, including queue and schema/discovery time. Any dispatch is conservatively potentially effectful, regardless of annotation. Failed/cancelled trace metadata appears in model content as well as details, so guest catches cannot hide it.

## Isolation and settlement

The workflows extension supplied the fresh permissioned Node/stdin/IPC pattern; no generalized runtime was extracted. Code mode adds an explicit network-permission feature check and a separate VM realm with denied dynamic imports and no Node globals. String code generation is disabled in both Node and the VM, preventing ordinary constructor escapes through a bridge function. The VM is defense in depth; the separate empty-environment permissioned process remains the capability boundary. The child has no retained source file or inherited descriptors except stdin, ignored stdout/stderr, and IPC.

The first terminal cause closes admission synchronously. A normal return with queued/running work becomes `unfinished_calls`; a caught nested failure becomes `nested_call_failed`. Then pending traces become cancelled, dispatched unsettled work becomes unknown, the gateway abort signal fires, and the child is killed with SIGKILL. The outer promise waits for actual process close, not just the kill request. Call promises have both rejection handlers and late-settlement guards; they cannot update a finalized snapshot, publish payloads, or dispatch queued work afterward. The runtime does not wait indefinitely for a transport ignoring cancellation or claim its remote effects ceased.

Whole-program wall time interrupts guest synchronous loops. No CPU/memory quota, malicious-schema resource guarantee, transactional rollback, or OS-level multi-tenant guarantee is claimed. Keep these limits explicit rather than treating Node permissions as a universal sandbox.

## Output boundary

Only explicit JSON return serialization crosses into output. Validation captures intrinsics and bound cycle-tracking methods before guest execution, snapshots own data descriptors into null-prototype objects/arrays, and serializes that snapshot rather than rereading guest properties. This rejects getters and lossy properties and prevents prototype mutation or inherited `toJSON` from changing the validated value. IPC envelopes are assembled from fixed keys and individually serialized fields, never a guest-prototype-bearing envelope object. Completion callbacks remain outside the guest global scope and attach through a captured Promise method, not a guest-replaced `.then`. Script failure text and child streams are suppressed, since they may contain intermediate payloads. Progress is one static host message, not a guest channel. Final JSON is credential-redacted and framed before spill; spilled previews are framed again. Shared spill failure normally returns the original text, so code mode detects that case and substitutes a bounded explicit overflow failure. Traces never store results, argument values, remote guidance, or source.

Pi session history and final spills are the only extension-side retained content. Do not add raw tracing, guest logging, error previews, hidden result handles, or source retention without revisiting the context/retention contract. The renderer deliberately shows metadata only; the returned JSON remains in tool-result content for the model.

## Change guidance

Keep direct tools and workflow policy unchanged. Add observable fixture coverage for any broadened binding, schema support, IPC field, lifecycle path, or output channel. Required deterministic checks and independent review are local evidence; live gateway qualification and remote CI remain separate. Value tests compare the actual adapters, declare tokenizer/round-trip assumptions, and must never be presented as universal token or latency savings.
