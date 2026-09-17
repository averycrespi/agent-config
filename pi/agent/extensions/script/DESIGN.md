# Script design

Script provides disposable computation with a narrow provider boundary. It is not a generic Pi tool dispatcher, workflow engine or background supervisor.

## Modules

- `api.ts`: supported host/provider exports, current host policy, explicit selection, caller ceilings, setup deadline and discovery.
- `provider.ts`: atomic registration validation, strict schema compilation, immutable schema snapshots, session-bus collection, conflicts and registration cancellation.
- `bridge.ts`: selected method lookup, fresh availability, argument validation, provider invocation and JSON-only result translation. It knows nothing about MCP or web transports.
- `config.ts`: global/environment policy and finite limits, fail closed on malformed restrictions.
- `runtime.ts`: fresh permissioned process, IPC envelope validation, FIFO admission queue, immutable deadline, host traces, sticky failures and terminal cleanup.
- `sandbox-source.ts`: trusted stdin bootstrap and separate VM setup; namespaced guest wrappers communicate through strings only. Captured intrinsics snapshot final JSON without guest serialization hooks.
- `value.ts`: strict host JSON snapshots and fixed byte bounds.
- `index.ts` / `tool.ts`: tool registration, discovery, bounded framed output, safe compact rendering and cancellation of owned runs on shutdown/navigation.
- `diagnostics.ts`: fixed public error summaries and recovery guidance, with a closed allowlist for discovery exception categories.
- `fixture.ts` and colocated tests: in-process trusted provider plus real permissioned children. No live credentials or external services are required.

## Authority and identity

Registration validates every method/schema and checks existing namespace ownership before installing a single listener. Failure does not mutate the registry. Public schema copies cannot change admission. The session event bus, rather than a module-global map, allows separately loaded extension module instances to cooperate without leaking registrations across sessions. Disposers are registration-specific and idempotent; selected executions retain those exact records and abort signals, not a late lookup that could silently adopt replacement authority.

Host allowlist, per-run selection and optional caller ceiling intersect before launch. Only that immutable selected method table produces guest wrappers. The host independently checks every incoming call against the table, so compromised helpers cannot access an unselected method. Provider and optional method availability are checked again at admission; method callbacks fail closed and discovery reports their current boolean without granting access. Execution passes an immutable caller cwd/session snapshot to handlers, captured before asynchronous setup, never a mutable current-session lookup. Guest code and traces receive no context fields. Provider removal aborts active executions; policy edits apply on subsequent runs. Trusted host extensions can bypass these APIs themselves and are outside the guest threat boundary.

Providers retain domain-specific permission, admission, redaction and transport responsibilities. Core traces conservatively mark **handler entry** as dispatch: this can overstate possible effects for a provider that subsequently denies a call, but cannot silently understate them. The runtime never claims a provider-internal preflight proves a whole execution safe to repeat. Methods may declare a bounded snapshotted set of public error codes; a returned rejection must select one of those constants and have a null value. This generic contract preserves known failure categories without interpreting transport exceptions or accepting arbitrary dynamic diagnostic text. Declared rejections force sticky host failure independently of guest control flow.

## Settlement invariants

A call reserves its monotonic ID and finite slot synchronously. Malformed IPC or over-cap attempts terminate; queued calls consume slots. Host FIFO concurrency applies even when guest code bypasses `parallel`. An absolute deadline is checked at IPC receipt and immediately before handler entry, not only by a timer.

The first terminal cause closes admission. A return with outstanding calls fails, and a caught host-observed failure still fails. Unknown provider outcomes force failure independently of guest output. Queued/running traces become cancelled; dispatched unsettled calls become unknown. Termination aborts handlers, discards queued work, SIGKILLs the child, and waits for close. Late settlements have handlers and terminal guards, cannot revise finalized accounting, and cannot restart the queue. Uncooperative host promises are not awaited indefinitely; external effects may persist.

The child has no inherited environment or privileged descriptors beyond stdin/IPC. Permission mode and disabled code generation remain mandatory, with no capability fallback on unsupported Node versions. VM separation denies imports/Node globals and keeps host closures and event objects out of the guest. See the README's explicit limitations: this is not hostile multi-tenant isolation and does not bound CPU, memory, synchronous host callbacks or malicious schema allocations.

## Output and privacy

Only explicit JSON enters final output. A bounded host receipt accompanies it, including failures even after guest catches. Schema/handler/guest errors never expose raw exception text. Unknown arbitrary method names remain `(not dispatched)`; only registered ASCII names can become trace labels. Child stdout/stderr are ignored. There are no argument previews, result previews, guest logs, source files, persistent interpreters, retained diagnostics or automatic spill/replay.

The 24,000-byte result limit is deliberately smaller than IPC bounds and leaves room for bounded accounting in tool context. Oversized output fails rather than persisting data. Host API discovery returns copied definitions; agent discovery fails when its output is oversized. Providers must keep credentials out of public definitions and guest values. Explicit output is not secret-filtered; a generic core cannot know all provider credentials. Renderers show sanitized display labels and host metadata only, never source or returned payloads.

Discovery failures retain only known core categories (or `discovery_unavailable`), plus cancellation derived from the owned signal. They return semantic-error details through the same `tool_result` promotion as execution failures; raw exceptions never enter content or renderers. Oversized discovery is distinct from oversized explicit JSON, so guidance does not confuse narrowing discovery with replaying execution.

Rendering consumes host accounting and `context.args`, not source or result payloads. Selection labels describe the request, not effective authority. Discovery details retain only namespace/method names and counts, not duplicate schemas. Expanded rows show bounded inventories, traces, and static guidance; collapsed rows prioritize outcomes and partial/unknown warnings over zero-call accounting. No renderer performs discovery, grants access, or adds live-session state.

## Verification and change guidance

Actual-boundary fixtures cover pure execution, namespace wrappers and parallel calls, explicit host/caller selection, unavailable/missing methods, invalid schemas and atomic conflicts, schema rejection without dispatch, count/concurrency limits, deadline/cancellation/actual child exit, provider revocation, sticky known/unknown failures, partial writes, late settlements, strict JSON/output bounds, credential/intermediate diagnostic privacy, forged IPC and underlying Node permissions. Loader tests cover independent loading without Gateway, event-bus interoperability across module caches, discovery, semantic error promotion and shutdown. Rendering tests cover narrow widths and hostile control text.

Gateway's optional MCP provider and future providers implement this API rather than importing core internals; fixture qualification is not live integration qualification. Any new guest binding, schema dialect, output channel or failure disposition needs actual-boundary regression coverage and corresponding contract updates. Background supervision belongs to a separate owner calling the supported host API.
