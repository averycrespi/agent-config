# mcp-broker Design

`mcp-broker` exposes a dynamic MCP broker catalog to Pi through three stable meta-tools. The core design trade-off is cache stability: the agent sees `mcp_search`, `mcp_describe`, and `mcp_call`, while the potentially large upstream broker tool set stays out of Pi's active tool list.

## Architecture

- `index.ts` is the extension entry point. It configures one shared `BrokerClient`, registers tools, installs the bash guard, registers `/mcp-broker-config`, prefetches broker tools on session start, closes the client on shutdown, and injects the broker menu into the system prompt.
- `client.ts` wraps the MCP SDK Streamable HTTP client. It owns connection lifecycle, network timeouts, tool-list caching, read-only filtering, reconnect/reset behavior, approval-mode request headers, and approval-timeout forwarding for tool calls.
- `tools.ts` registers `mcp_search`, `mcp_describe`, and `mcp_call`, frames broker-originated data, handles broker errors, read-only defense-in-depth, spillover, diagnostic logs, and compact renderers.
- `search.ts` ranks broker tools by token overlap against names and descriptions; `mcp_search` and the bash guard share this scorer.
- `guard.ts` detects bash calls that look like `gh` or remote git operations and queues a hidden steer toward broker tools without blocking the bash call.
- `config.ts` loads settings/env overrides and masks `authToken` through the shared config command.
- `spillover.ts` re-exports the shared large-output spillover helper.

## Meta-tool model

The extension intentionally does not register one Pi tool per broker tool. A stable three-tool surface avoids prompt-cache churn and prevents huge provider catalogs from inflating the model-visible tool list.

Agent flow is:

1. `mcp_search` ranks cached/refreshed broker tools by token overlap against names and descriptions.
2. `mcp_describe` returns the selected tool description and JSON schema.
3. `mcp_call` invokes the exact broker tool name with an arguments object.

`before_agent_start` injects a compact namespace menu from the cached tool list so agents can often call `mcp_call` directly. This menu is advisory; `mcp_search` and `mcp_describe` remain the recovery path when the menu is missing or stale.

## Client lifecycle and cache

`BrokerClient` is long-lived within the Pi session and lazy-connects on first use. `configure()` resets the connection only when endpoint, auth token, read-only mode, or approval mode changes. `ensureConfig()` in `index.ts` reloads config per cwd and avoids repeated reconfiguration for the same cwd.

Tool-list behavior:

- `listTools()` fetches from the broker, applies read-only filtering if configured, and caches tools/providers.
- If a fetch fails while a cache exists, the client resets and retries once.
- `getCachedTools()` never performs network I/O; it is used by prompt injection and the bash guard.

Network connect/list operations use short explicit timeouts. `mcp_call` uses the configured broker approval timeout window, defaulting to 10 minutes, because some broker tools intentionally wait for human approval.

## Approval mode

Approval mode is configured at the extension/client level, not as an `mcp_call` argument. `reject` mode sends `Mcp-Broker-Approval-Mode: reject` through the Streamable HTTP transport so broker calls that would require human approval fail immediately. `wait` mode omits the header and preserves broker defaults.

Keep this as config-controlled transport state. Do not let broker metadata, prompt text, or per-call agent arguments toggle approval mode, because that would let untrusted content silently alter the approval boundary during a session.

## Read-only mode

Read-only mode is strict and annotation-driven. Only broker tools with `annotations.readOnlyHint === true` are considered read-only. Missing annotations are treated as write-capable.

Defense happens in two places:

- `BrokerClient.fetchTools()` filters the visible tool catalog.
- `callBrokerTool()` refreshes the filtered list before forwarding a call and rejects names absent from that list.

This second check matters because tool names can appear from stale context, prompt injection, or copied examples. Do not weaken it by trusting only startup cache or the model-visible menu.

## Error handling, logging, and spillover

Broker tool errors are different from transport failures:

- When the broker returns `isError`, `mcp_call` preserves the broker content, prepends a marker, records `brokerError` in details, and writes a retained diagnostic log when possible.
- Transport/client failures return a text error. Session-looking failures reset the client and retry once.
- Abort errors are rethrown so Pi can handle cancellation normally.

Broker-originated meta-tool output and remote error messages are framed as untrusted external data before they reach the shared spillover helper. This ordering ensures persisted files retain the trust boundary. When content spills, the returned preview envelope is framed again because its inner preview may not include the persisted content's closing marker. Broker-reported errors keep an extension-authored marker outside the frame; transport failures use an extension-authored summary plus a framed remote message. If spill writing fails, the wrapped original content is returned inline rather than failing the call.

Diagnostic logs keep dynamic tool names and failure messages inside the same escaped untrusted-content frame. Keep renderer-only previews bounded in `details`; never duplicate complete broker results there.

## Bash guard

The guard is advisory, not enforcement. It detects likely `gh` and remote git operations in bash commands, notifies the user when UI is available, and after the bash result queues one hidden steer per turn with likely broker tool candidates.

Important guard invariants:

- Bash is never blocked or rewritten.
- Local git operations are unaffected.
- Quoted strings are stripped before detection to reduce false positives.
- Candidate suggestions come from cached tools, so read-only mode naturally limits suggestions.
- The steer is sent through `pi.sendMessage(..., { deliverAs: "steer" })` because Pi may discard `tool_result` content rewrites when the underlying tool errors.

False positives are acceptable because the command still runs and the agent can ignore the hint. False negatives are acceptable because the prompt menu and meta-tools still exist.

## Prompt injection boundary

Broker-provided tool names, descriptions, schemas, call results, and remote error messages are external data. Meta-tool results must retain explicit `BEGIN/END UNTRUSTED` framing, delimiter-like payload lines must be escaped, and static tool descriptions must tell the agent that returned broker data is untrusted. Normalize MCP content to Pi-supported text/image blocks before framing; embedded text resources become text blocks, all images stay between boundary markers, and aggregate image payloads above the inline cap are serialized so text spillover bounds them. Do not allow broker metadata to alter extension control flow except through explicit tool selection and validated arguments.

The broker menu in the system prompt should stay factual and short: namespaces and tool names inside an untrusted catalog frame, followed by extension-authored decision rules outside that frame. Avoid embedding full broker descriptions or schemas into the prompt; `mcp_describe` exists for just-in-time detail.

## Configuration boundaries

Missing endpoint or auth token should not prevent Pi startup. The meta-tools remain registered and return clear configuration errors when used. This keeps the extension safe to install on machines without broker access.

`authToken` is sensitive and must remain masked in config output. Do not write it to logs, prompt text, tool results, or diagnostic details.

## Non-goals

- No one-tool-per-upstream-tool registration.
- No generic local MCP server manager.
- No hard blocking of bash `gh` or remote git.
- No schema validation beyond returning broker schemas for the agent to follow.
- No persistent broker catalog storage across Pi sessions.

## Change guidance

When changing broker behavior, preserve the stable meta-tool surface, read-only defense-in-depth, untrusted-content framing, and frame-before-spill ordering. Add tests for connection reset, read-only filtering, guard detection, catalog/result framing, and error/spillover behavior when relevant. Any change to tool flow, logging, configuration, temporary files, or security expectations must be reflected in `README.md`.
