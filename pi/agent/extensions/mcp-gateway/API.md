# MCP Gateway host API

Sibling extensions import only `./api.ts` for host-side composition. This API does not invoke Pi tool execute functions, create SDK sessions, or reproduce nested Pi tool hooks. Guest code must never receive the API object or event bus.

## Exports

- `GatewayAccess`: one `call(name, args, signal, onDispatch)` method returning `Promise<CallResult>`. Arguments are a JSON object; cancellation is required. `onDispatch` runs after fresh catalog membership/schema admission and immediately before the single client request attempt. Treat it conservatively as potentially dispatched, not proof of an upstream effect.
- `requestGatewayAccess(pi)`: synchronously resolves exactly one active gateway provider through the session event bus. Zero/multiple providers fail with `gateway_unavailable`. The facade exposes no configuration, credentials, catalog mutation, or shutdown methods.
- `provideGatewayAccess(pi, client, isActive)`: gateway-owner registration returning a listener-removal callback. Call it during factory setup and remove it on shutdown; inactive/conflicting providers must not respond.
- `createGatewayAccess(client)`: binds the same validated-call facade to an explicitly owned client, primarily for fixture integration.
- `GatewayError`, `redactCredentials`, `sanitizeGatewayText`, `MAX_RESPONSE_BYTES`: the gateway's existing safe error, credential-redaction, display-sanitization, and response-bound contracts.
- `isGatewayError(error)`: recognizes gateway exceptions across Pi's separately loaded extension module instances using a shared host-only symbol brand. Use this instead of `instanceof GatewayError` across the facade boundary; JSON-shaped error fields alone are not trusted.
- Types `CallResult` and `GatewayTool`: raw redacted result/descriptor shapes. `CallResult` retains additional provider metadata without inventing or interpreting it.

```ts
import { requestGatewayAccess } from "../mcp-gateway/api.ts";

const gateway = requestGatewayAccess(pi);
const result = await gateway.call(name, args, signal, () => {
  // Host accounting only: a request attempt may follow.
});
```

Each composed call refreshes discovery under the active client configuration, validates the discovered schema using strict Ajv with standard formats, and pins credential identity through invocation. Draft-07 and explicit draft-2020-12 are supported, including the string-valued `x-mcp-header` provider annotation. This annotation does not validate arguments or assign headers locally; gateway-owned routing is unchanged. Unsupported schemas, other unknown formats/keywords, async schemas, unresolved external references, and invalid arguments fail closed. No coercion/defaults/schema downloads occur. The gateway independently validates and authorizes the operation. Configured annotation-based read-only restrictions, per-call deadlines, credential rotation, and cancellation remain in force.

`GatewayError` exposes locally generated summary/code, optional validated rejection reason and invocation ID, uncertainty, and optional bounded external guidance. Consumers crossing a model-context boundary must not copy guidance or arbitrary exception messages automatically: those can contain intermediate data. The code-mode consumer forwards only safe failure metadata. Provider `isError` results remain raw data; consumers must retain a host-observed failure separately from guest control flow.

## Script provider

When Gateway activates, it registers the optional `mcp` namespace using `registerScriptProvider` from `../script/api.ts`. Loading the `script` tool is not required for direct gateway tools or host-library use. Factory order does not matter. Script remains usable with `providers: []` without Gateway. Legacy Code mode and Monitor still use their existing APIs unchanged.

Enable `mcp` in the trusted global Script `allowedProviders` policy, then explicitly select it per execution. Use `script({action: "describe", providers: ["mcp"]})` for the positional method schema; discover exact external names with `mcp_search` and inspect their schemas with `mcp_describe` before composition. Previously inspected names/schemas may be reused unless evidence indicates a change; fresh host admission still runs.

```js
script({
  action: "run",
  description: "Read a discovered example item",
  providers: ["mcp"],
  source: `
    const result = await mcp.call("example.lookup", {query: "item"});
    if (result.isError) return {failed: true};
    return result;
  `,
});
```

The example name is illustrative, not a discovered tool. `mcp.call(name, args)` requires a nonempty name and JSON object. It resolves the complete redacted MCP envelope, including content, structuredContent, isError and unknown metadata; it neither parses text nor changes application semantics. Provider `isError` resolves unchanged but forces host failure. The direct Pi adapter separately frames/presents that envelope; its presentation is not the guest value.

The adapter uses `createGatewayAccess` on the same owned client, preserving fresh catalog/schema/read-only admission, grants, endpoint/credential ownership, response bounds and per-call deadlines. The script deadline/signal further narrows execution. Configuration changes and shutdown dispose the registration, cancelling **all** executions selecting it, including runs between calls. New executions select a fresh registration; old executions cannot adopt new authority.

Known gateway exceptions reject with a declared safe `code` and `outcomeUnknown`; Script retains the code independently of guest catches. Raw exceptions and rejection guidance are suppressed. Rejection reasons/invocation IDs are not included in this minimal provider error contract; direct tools and legacy Code mode retain their existing richer diagnostics. Unrecognized exceptions conservatively become unknown provider failures. Script accounts handler entry as potential dispatch, even for provider-internal preflight rejection, so effects/partial flags can conservatively overstate effects. No gateway envelope is invented for a transport/admission failure.

Gateway permission is not user approval. Obtain applicable authority before mutations; there are no automatic grants, approval polling, invocation retries, replay or synthetic nested Pi tool hooks. Cancellation is not rollback. Inspect Script's host status/partial/unknown accounting, not just returned JSON. Script retains its own smaller final-output and IPC bounds; an over-limit result fails rather than replaying or truncating an envelope into apparent success. No new provider logs or spills are written.

Ordinary `mcp_call` still uses the existing direct path without new local schema admission. The new facade is not an authorization grant or a promise of equivalence to the surrounding session's hooks. Trusted host extensions can already access host resources; only the fresh code guest is restricted.
