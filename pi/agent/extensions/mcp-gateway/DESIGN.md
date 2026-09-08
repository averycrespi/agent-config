# MCP Gateway design

Expose an existing governed MCP Gateway through three stable Pi meta-tools while keeping the current broker untouched. This increment must remain opt-in and independently testable; it is not the cutover mechanism.

## Architecture

- `index.ts` registers the CLI opt-in and config command. CLI flag values are unavailable during initial factory loading, so tool registration is deferred to `session_start`. Refuse activation if another MCP meta-tool is already registered. The default path must remain network-free and tool-inert even when Stow exposes this directory.
- `config.ts` loads only global settings plus explicit environment overrides through shared config helpers. Project settings cannot redirect a global credential. Public endpoint/path validation errors are static and must not echo unvalidated input. File contents are never settings.
- `client.ts` owns modern JSON HTTP requests, protected credential reads, pagination, read-only admission, cancellation, response limits, safe error projection, and the advisory catalog cache.
- `catalog.ts` owns bounded keyword discovery and the namespace-count prompt. Do not regenerate a per-tool system-prompt inventory.
- `tools.ts` adapts the three operations to Pi, marks semantic failures through `tool_result`, and implements width-aware renderers. Never infer errors from arbitrary remote prose.
- `presentation.ts` normalizes MCP content, bounds previews, strips terminal controls, frames before spill, and writes metadata-only diagnostics using shared helpers.
- `guard.ts` is advisory only. Command text is transient matching input, never copied into steering content or result details. Candidate names remain framed external metadata.
- `fixture.ts` supports colocated tests with an ephemeral HTTP server and synthetic protected credential; it has no entrypoint or runtime side effects on import.

## State and lifecycle

Each active extension instance owns one client, an abortable lifetime, parsed configuration, and a completed catalog cache. There are no server sessions, background pollers, credential strings retained between requests, or persistent catalogs. Timers are operation-scoped and cleared in `finally`.

Configuration changes abort the old lifetime and clear its cache. Shutdown aborts request work. Session replacement/reload constructs a fresh extension instance. Startup and agent start attempt a bounded fresh traversal; failure is nonfatal and never advertises partial discovery. Search/describe refresh independently; the guard only reads the last complete catalog.

A traversal pins a hash of the credential actually read per HTTP request. It accumulates descriptors privately and publishes only after all pages succeed. A stale cursor permits one restart from page one under the same deadline and aggregate page/byte/descriptor budgets; any other failure or a second stale cursor fails. Only the candidate catalog and cursor state reset, never resource consumption. Distinct concurrent operations share no cancellation controller. Read-only calls require fresh filtered discovery and the same credential identity at dispatch; reconfiguration aborts old operations rather than mixing endpoints or authority.

## Transport and outcome invariants

Use the current gateway's implemented `2026-07-28` stateless contract: explicit JSON-RPC IDs, mirrored protocol header/metadata, client capabilities/info on each request, exact `/mcp`, no initialize/session header, no redirects. Gateway's `internal/contract` and ingress code are the integration authority; do not assume a generic SDK implements this protocol era or silently downgrade.

Bound response transfer before JSON parsing and bound aggregate catalog work. Validate the envelope ID and result shape. Decode before credential redaction so JSON escapes cannot hide a bearer echo. Discard raw HTTP problem bodies and arbitrary JSON-RPC error strings; project only closed safe codes, validated gateway invocation IDs (`^[0-7][0-9A-HJKMNP-TV-Z]{25}$`, not UUIDs), and explicit uncertainty. Result shape/transport failures after a call may mean effects occurred.

There is exactly one client invocation attempt. Never reuse the broker's session-looking-error retry heuristic. Cancellation, timeout, credentials changing, gateway restart, grant approval, and unknown outcomes must not create a replay edge. A cancelled request is not evidence that a downstream effect did not occur.

## Security boundaries

Bearer files are opened without following a symlink leaf, checked as owner-only regular files, bounded before reading, and accepted only in the agent credential domain. The host endpoint and credential path are paired through trusted global configuration/environment, not merged with project data. HTTPS is required except numeric IPv4 loopback HTTP; arbitrary proxy/redirect destinations cannot acquire the header through client redirection.

Annotation filtering is defense in depth, not authorization or an argument-sensitive read-only proof. Missing hints reject in read-only mode. Gateway independently authorizes every call. This extension cannot prevent same-OS-user filesystem/shell tools from accessing readable files and must not claim otherwise.

Remote schemas, names, results, and candidate lists remain untrusted. Normalize to supported Pi blocks, frame before spill, and frame spilled previews again. Keep images inside the data envelope; oversize images become bounded-transfer, spillable text. Do not put full structured results in renderer details. Render dynamic strings only after sanitization and bounding. Diagnostic logs retain failure metadata, not payloads.

## Non-goals and change guidance

No approval orchestration, administrator surface, credential provisioning, multi-backend router, deferred tool activation, code composition, legacy negotiation, persistent discovery store, or broker/subagent migration. Do not import broker internals: the temporary parallel implementation must remain removable without changing broker behavior. Shared generic helpers are reusable; avoid extracting a new transport abstraction across incompatible gateway/broker lifecycles.

Tests cover actual HTTP envelopes and call counts, stale/invalid pages, rotation/admission, cancellation/shutdown, size limits, safe result conversion, prompt bounds, terminal controls, semantic/framework errors, and the real Pi loader's late flag application. Add tests at the observable boundary for changes to these invariants. Required repository checks and the separately recorded live-session gate remain distinct evidence.
