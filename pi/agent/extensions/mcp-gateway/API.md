# MCP Gateway host API

Sibling extensions import only `./api.ts` for host-side composition. This API does not invoke Pi tool execute functions, create SDK sessions, or reproduce nested Pi tool hooks. Guest code must never receive the API object or event bus.

## Exports

- `GatewayAccess`: one `call(name, args, signal, onDispatch)` method returning `Promise<CallResult>`. Arguments are a JSON object; cancellation is required. `onDispatch` runs after fresh catalog membership/schema admission and immediately before the single client request attempt. Treat it conservatively as potentially dispatched, not proof of an upstream effect.
- `requestGatewayAccess(pi)`: synchronously resolves exactly one active gateway provider through the session event bus. Zero/multiple providers fail with `gateway_unavailable`. The facade exposes no configuration, credentials, catalog mutation, or shutdown methods.
- `provideGatewayAccess(pi, client, isActive)`: gateway-owner registration returning a listener-removal callback. Call it during factory setup and remove it on shutdown; inactive/conflicting providers must not respond.
- `createGatewayAccess(client)`: binds the same validated-call facade to an explicitly owned client, primarily for fixture integration.
- `GatewayError`, `redactCredentials`, `sanitizeGatewayText`, `MAX_RESPONSE_BYTES`: the gateway's existing safe error, credential-redaction, display-sanitization, and response-bound contracts.
- Types `CallResult` and `GatewayTool`: raw redacted result/descriptor shapes. `CallResult` retains additional provider metadata without inventing or interpreting it.

```ts
import { requestGatewayAccess } from "../mcp-gateway/api.ts";

const gateway = requestGatewayAccess(pi);
const result = await gateway.call(name, args, signal, () => {
  // Host accounting only: a request attempt may follow.
});
```

Each composed call refreshes discovery under the active client configuration, validates the discovered schema using strict Ajv with standard formats, and pins credential identity through invocation. Draft-07 and explicit draft-2020-12 are supported; unsupported schemas, unknown formats/keywords, async schemas, unresolved external references, and invalid arguments fail closed. No coercion/defaults/schema downloads occur. The gateway independently validates and authorizes the operation. Configured annotation-based read-only restrictions, per-call deadlines, credential rotation, and cancellation remain in force.

`GatewayError` exposes locally generated summary/code, optional validated rejection reason and invocation ID, uncertainty, and optional bounded external guidance. Consumers crossing a model-context boundary must not copy guidance or arbitrary exception messages automatically: those can contain intermediate data. The code-mode consumer forwards only safe failure metadata. Provider `isError` results remain raw data; consumers must retain a host-observed failure separately from guest control flow.

Ordinary `mcp_call` still uses the existing direct path without new local schema admission. The new facade is not an authorization grant or a promise of equivalence to the surrounding session's hooks. Trusted host extensions can already access host resources; only the fresh code guest is restricted.
