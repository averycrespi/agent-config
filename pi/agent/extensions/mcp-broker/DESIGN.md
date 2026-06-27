# mcp-broker Design

`mcp-broker` exposes a dynamic MCP broker catalog to Pi through three stable meta-tools. The core design trade-off is cache stability: the agent sees `mcp_search`, `mcp_describe`, and `mcp_call`, while the potentially large upstream broker tool set stays out of Pi's active tool list.

## Architecture

- `index.ts` is the extension entry point. It configures one shared `BrokerClient`, registers tools, installs the bash guard, registers `/mcp-broker-config`, prefetches broker tools on session start, closes the client on shutdown, and injects the broker menu into the system prompt.
- `client.ts` wraps the MCP SDK Streamable HTTP client. It owns connection lifecycle, network timeouts, tool-list caching, read-only filtering, reconnect/reset behavior, and approval-timeout forwarding for tool calls.
- `tools.ts` registers `mcp_search`, `mcp_describe`, and `mcp_call`, handles broker errors, read-only defense-in-depth, spillover, diagnostic logs, and compact renderers.
- `guard.ts` detects bash calls that look like `gh` or remote git operations and queues a hidden steer toward broker tools without blocking the bash call.
- `config.ts` loads settings/env overrides and masks `authToken` through the shared config command.
- `spillover.ts` re-exports the shared large-output spillover helper.

## Meta-tool model

The extension intentionally does not register one Pi tool per broker tool. A stable three-tool surface avoids prompt-cache churn and prevents huge provider catalogs from inflating the model-visible tool list.

Agent flow is:

1. `mcp_search` filters cached/refreshed broker tools by name or description.
2. `mcp_describe` returns the selected tool description and JSON schema.
3. `mcp_call` invokes the exact broker tool name with an arguments object.

`before_agent_start` injects a compact namespace menu from the cached tool list so agents can often call `mcp_call` directly. This menu is advisory; `mcp_search` and `mcp_describe` remain the recovery path when the menu is missing or stale.

## Client lifecycle and cache

`BrokerClient` is long-lived within the Pi session and lazy-connects on first use. `configure()` resets the connection only when endpoint, auth token, or read-only mode changes. `ensureConfig()` in `index.ts` reloads config per cwd and avoids repeated reconfiguration for the same cwd.

Tool-list behavior:

- `listTools()` fetches from the broker, applies read-only filtering if configured, and caches tools/providers.
- If a fetch fails while a cache exists, the client resets and retries once.
- `getCachedTools()` never performs network I/O; it is used by prompt injection and the bash guard.

Network connect/list operations use short explicit timeouts. `mcp_call` uses the configured broker approval timeout window, defaulting to 10 minutes, because some broker tools intentionally wait for human approval.

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

Large successful text output is spilled to a temporary file through the shared spillover helper. Error responses are not spilled. If spill writing fails, the original content is returned inline rather than failing the call.

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

Broker-provided tool names, descriptions, and schemas are external data. They are shown to the agent as tool catalog information, not instructions. Do not allow broker metadata to alter extension control flow except through explicit tool selection and validated arguments.

The broker menu in the system prompt should stay factual and short: namespaces, tool names, and decision rules for using the meta-tools. Avoid embedding full broker descriptions or schemas into the prompt; `mcp_describe` exists for just-in-time detail.

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

When changing broker behavior, preserve the stable meta-tool surface and read-only defense-in-depth. Add tests for connection reset, read-only filtering, guard detection, and call error/spillover behavior when relevant. Any change to tool flow, logging, configuration, or security expectations must be reflected in `README.md`.
