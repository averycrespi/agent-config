# Script host and provider API

Trusted sibling extensions import `../script/api.ts`. They run with ordinary host authority; this API is not a sandbox for extensions. Neither registering the `script` tool nor installing MCP Gateway is required to call the host library. Only explicitly selected, host-permitted provider methods cross into guest code.

## Register a provider

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerScriptProvider } from "../script/api.ts";

export default function (pi: ExtensionAPI) {
  let active = false;
  const dispose = registerScriptProvider(pi, {
    namespace: "fixture",
    available: () => active,
    methods: {
      echo: {
        description: "Return one integer",
        inputSchema: {
          type: "array",
          items: [{ type: "integer" }],
          minItems: 1,
          maxItems: 1,
          additionalItems: false,
        },
        async handler(args, { signal }) {
          signal.throwIfAborted();
          return { value: args[0] };
        },
      },
    },
  });
  pi.on("session_start", () => {
    active = true;
  });
  pi.on("session_shutdown", () => {
    active = false;
    dispose();
  });
}
```

`registerScriptProvider(pi, provider)` validates the entire registration before installing one listener and returns an idempotent disposer. Invalid registrations report fixed categories together, not raw schema content. Conflict checks include unavailable registrations; a second registration cannot silently replace a namespace. Dispose the old registration explicitly before replacement. Disposal aborts current executions selecting that registration and prevents later selection. No handler or background resource starts at registration.

`ScriptProvider` contains `namespace`, `methods`, and synchronous `available(): boolean`. Availability must be cheap and is checked at selection and before each handler. False/throw means unavailable. Providers own readiness/credential lifecycle: use the disposer to cancel active runs when authority is revoked, and register a fresh provider if needed. A callback change alone prevents new handler admission but does not cancel an already-running handler. Session shutdown must dispose registrations; Pi recreates factories on reload/session replacement. No registry is persisted or restored from conversation history.

Namespaces and method names are lower-case ASCII identifiers matching `[a-z][a-z0-9_]{0,47}`. JS keywords, prototype/then names, runtime helper names and privileged globals are reserved. The sole method-name exception is `fetch`: a namespaced method such as `web.fetch` is allowed, while `fetch` remains forbidden as a provider/global binding. At most 32 providers and 32 methods per provider are supported. Public descriptions are nonblank, at most 500 characters and contain no terminal/control-format characters. They and schemas must contain no secrets.

`ScriptMethod` contains `description`, `inputSchema`, optional `errorCodes`, optional synchronous `available(): boolean`, and `handler(args, context)`. Method availability is cheap and fail-closed on false/throw, rechecked immediately before dispatch (including queued calls). Discovery includes an informational `available` boolean only for methods declaring this callback; omitted means no additional method-level readiness restriction. Neither result grants authority. `errorCodes` declares at most 64 unique public constants matching `[a-z][a-z0-9_]{0,63}`. Registration snapshots this list; never derive codes from arguments, results, credentials, or remote prose. The schema describes the **positional argument array**: `fixture.echo(3)` validates `[3]`. Schemas are snapshotted at registration, at most 16 KiB, plain JSON, strictly compiled with Ajv draft-07. Root `type: "array"` is required. No coercion, defaults, schema downloads, asynchronous schemas, unsupported keywords/formats/dialects or unresolved external references. Use standard JSON Schema constraints without format plugins. Invalid argument values fail before the handler is entered.

The handler receives JSON arguments and `{signal, deadlineMs, execution}`. `execution` is a frozen caller snapshot `{cwd, session?}` taken before asynchronous setup by `executeScript`. Optional `ScriptSession` contains `id` plus optional `file`, `provider`, `model`, and `reasoningLevel` strings. These host-only fields are not guest bindings or trace metadata. Existing handlers using only signal/deadline remain compatible. Internal bridge fixtures may omit execution; context-dependent providers must reject rather than substitute process cwd or mutable current-session state. Pass the signal/deadline into downstream work; provider-specific permission, redaction and per-call policies remain provider-owned. The host records dispatch immediately before invoking the handler, conservatively including any provider-internal admission. Do not automatically retry, grant, poll approval, or replay in a handler.

The handler returns a `Promise<MethodResult>`:

```ts
{ value: jsonValue, isError?: boolean, outcomeUnknown?: boolean, error?: string }
```

Only `value` reaches the guest, after plain-JSON snapshot and IPC size validation. `isError: true` forces failed host accounting even if the guest returns normally. `outcomeUnknown: true` also forces failure. Use a known failed result for a confirmed rejection; use unknown outcome for uncertain effects. Throwing suppresses raw exception text and conservatively records an unknown outcome. To reject a guest call with a known public category, return `{value: null, error: declaredCode, outcomeUnknown}`. The bridge validates the code against the method's snapshotted `errorCodes`; the runtime rejects with `{code, outcomeUnknown}` and retains that code in the failed host trace even when caught. Undeclared codes or a non-null rejection value fail as an unknown provider error without leaking the code. No arbitrary exception message or metadata is forwarded. Raw provider result envelopes are not automatically interpreted: providers translate their own failure semantics into this contract. Do not forward credentials in `value`; intermediate data intentionally becomes guest-readable, but does not enter traces or diagnostics.

## Execute from a trusted host

```ts
import { executeScript } from "../script/api.ts";

const controller = new AbortController(); // caller aborts on shutdown/navigation
const result = await executeScript(pi, ctx.cwd, {
  source: "return await fixture.echo(3);",
  providers: ["fixture"],
  capabilityCeiling: ["fixture"],
  limits: { maxCalls: 4, maxConcurrency: 2, timeoutMs: 5000 },
  signal: controller.signal,
  deadlineMs: Date.now() + 5000,
});
```

Optional `options.args` is strict JSON data (at most 64 KiB), snapshotted before asynchronous setup and initialized inside the guest over string-only IPC. Omission leaves the original inline startup path unchanged. `args` is a reserved provider/helper name. The model-facing tool exposes arguments only for saved names; this host API still executes a body, not a name or filesystem path.

`executeScript(pi, cwd, options)` returns `Promise<RunResult>` after actual child close. `providers`, finite positive `limits`, `signal`, and an absolute safe-integer wall-clock `deadlineMs` are required. Caller limits must not exceed exported `MAX_LIMITS` (128 calls, 16 concurrent, 300000 ms). Effective limits are the minimum of caller ceilings and current global settings, including elapsed setup time. Missing/invalid selection fails before launch. An omitted `capabilityCeiling` uses host policy; `[]` permits only pure computation. A nonempty selection must be contained in both host policy and caller ceiling. `cwd` does not enable project policy. Callers must supply their execution-scoped cwd, and may pass `options.session` with plain session metadata; it is copied and frozen before asynchronous setup. Omitting session metadata never requests an ambient/global session fallback. The agent-facing tool samples cwd, session ID/file and selected model/reasoning from its own invocation context.

Every call gets a fresh child; the API owns no scheduler or session handlers. Callers own their signal, scheduling, lifecycle, output framing and stale-result suppression. The API never retries. Policy is sampled per execution; unregistering a provider cancels active executions, while editing global settings only affects subsequent executions.

`RunResult` has `status` (`success`, `failed`, `cancelled`, `timeout`), optional fixed `code`, optional serialized explicit JSON `json`, `traces`, `effectsMayPersist`, `partialExecution`, and `outcomeUnknown`. JSON may accompany failed status; inspect accounting before consuming it. A host failure cannot be erased by guest JSON.

Each bounded `Trace` contains `id`, `tool` (validated `namespace.method` only after dispatch; otherwise `(not dispatched)`), `state` (`queued`, `running`, `succeeded`, `failed`, `cancelled`), `dispatched`, queue-inclusive `startedMs`/`durationMs`, optional fixed `code`, and `outcomeUnknown`. No raw arguments, results or exception messages are included. Every dispatched handler is conservatively potentially effectful. There is no repeat-safety classification or transactional guarantee.

`snapshotScriptJson(value, maxBytes?)` exposes the executor's strict plain-JSON snapshot contract to trusted host consumers. It returns serialized JSON or throws a fixed validation/size category; default bound is the 16 MiB IPC ceiling. Callers such as [Monitor](../monitor/README.md) supply tighter state/evidence bounds. It rejects accessors, lossy/cyclic values and serialization hooks rather than calling them. This helper grants no execution or provider authority.

## Prepared background execution

`prepareScript(pi, cwd, options)` validates source, policy and provider selection without launching a child, returning `{deadlineMs, run(signal)}`. It pins source, JSON arguments, a copied provider selection/caller ceiling, selected registration records, immutable execution context, effective limits and original setup-inclusive deadline. `run` is single-use and calls the existing runtime; provider disposal remains revocation and availability is still checked per dispatch. A delayed admission never renews the deadline. Invalid preparation throws a fixed category and starts nothing.

The Script tool prepares with its session-lifetime signal, checks tool-turn cancellation before durable admission, then gives the prepared callback to [Background](../background/API.md). After admission the run is independent of the foreground turn's signal, but explicit cancellation and session teardown abort it. Other host callers retain their own lifecycle responsibilities. This API is not permission to retry or queue a prepared execution indefinitely.

## Discovery and host communication

`describeScriptProviders(pi, cwd, providers, capabilityCeiling?, signal?)` returns copied `{namespace, methods: [{name, description, inputSchema, errorCodes?, available?}]}` definitions. `providers: []` requests all permitted registered definitions; a nonempty list requires each selected provider to be permitted and available. There is no execution authority in this result. The agent-facing `script` describe action limits serialized discovery to 24,000 bytes; host consumers must also bound/frame presentation. Its tool result retains fixed discovery error codes (`capability_denied`, `capability_unavailable`, `invalid_config`, `invalid_selection`, `provider_conflict`, `output_limit`, or fallback `discovery_unavailable`) and signal-derived `cancelled`, with semantic failure promoted to Pi's error flag. Raw exception text is never exposed. This presentation does not change the host API's rejection behavior.

Internally, `script:providers-v1` is a synchronous, host-only event-bus query with `{accept(provider)}`. Registration installs one listener; collection rejects duplicate namespaces/over-cap inventories. It exists to avoid accidental module-global state across Pi's separate extension module caches and to make factory order irrelevant. Use the supported API, not this internal message shape. Handlers, schemas and cancellation signals stay in trusted host memory; this is not a public telemetry event or a guest binding. The executor emits no other lifecycle notifications, model messages or continuations. Optional background tool execution delegates those concerns to the separate Background service.

MCP Gateway implements the optional `mcp` namespace through this API; see its [provider contract and example](../mcp-gateway/API.md#script-provider). No MCP transport or error interpretation belongs in script core. Web-access supplies optional `web.search` and `web.fetch`; see its [provider and host-effects contract](../web-access/README.md#script-provider).

Builtins supplies active stock filesystem/shell methods; see its [provider contract](../builtins/README.md#script-provider) for structured results, image rejection and nested-hook limitations.

See [README.md](README.md) for configuration, isolation limitations, output bounds and retention; [DESIGN.md](DESIGN.md) for implementation invariants.
