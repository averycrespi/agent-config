# mcp-broker

Pi extension that exposes the MCP broker to the agent via three meta-tools (`mcp_search`, `mcp_describe`, `mcp_call`) plus a bash guard that redirects native `gh` and remote-git calls to the broker.

## What it does

- **Meta-tools** — registers `mcp_search`, `mcp_describe`, and `mcp_call`, which share one long-lived MCP client connection to the broker. The agent discovers tools with `mcp_search`, inspects their schemas with `mcp_describe`, and invokes them with `mcp_call`. The upstream broker tool set stays out of the agent's tool list, so the prompt cache prefix stays stable regardless of how many broker tools are discovered.
- **Tool menu in the system prompt** — on `session_start` the extension pre-fetches the broker's tool list. `before_agent_start` injects a per-namespace menu (e.g. `git: git_push, git_pull, …` / `github: list_pull_requests, pull_request_read, …`) plus a short decision rule into the system prompt. The agent can pick a tool and call `mcp_call` directly without an `mcp_search` round-trip.
- **Guard** — when bash is invoked with direct `gh` or remote git (`push`, `pull`, `fetch`, `ls-remote`, `remote`), the bash still runs but a hint is prepended to its result naming likely broker tools to use next time. Local git is unaffected. Detection is a heuristic; false positives are harmless because nothing is blocked.

## Usage

Typical agent flow:

1. `mcp_search` with a substring query (e.g. `"pr"`, `"git"`, empty string for everything). Returns name + one-line description per match.
2. `mcp_describe` for any candidate that looks right. Returns the full description and JSON Schema for `arguments`.
3. `mcp_call` with the exact name and an arguments object matching the schema.

Broker connect and tool-list operations use an explicit 15-second network timeout. Tool calls that require human approval block for up to 10 minutes, matching the broker's own approval timeout. After 10 minutes without an approval decision, `mcp_call` returns an error and the agent can retry.

If a cached broker tool list becomes stale or the connection fails while refreshing it, the client drops the stale cache, reconnects, and retries once before surfacing the error.

## Configuration

Configure via `extension:mcp-broker` in Pi settings. Environment variables override settings when set. Use `/mcp-broker-config` to display the effective parsed config with `authToken` masked.

| Field       | Default | Environment override    | Description                                                                                                     |
| ----------- | ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `endpoint`  | unset   | `MCP_BROKER_ENDPOINT`   | Base URL of the broker; the extension connects to `${endpoint}/mcp`.                                            |
| `authToken` | unset   | `MCP_BROKER_AUTH_TOKEN` | Bearer token for the broker's MCP endpoint.                                                                     |
| `readOnly`  | `false` | `MCP_BROKER_READONLY`   | Set to `true` in settings or `1`/`true` in the environment to activate read-only mode; `0`/`false` disables it. |

Example settings:

```json
{
  "extension:mcp-broker": {
    "endpoint": "https://broker.example.com",
    "authToken": "<token>",
    "readOnly": false
  }
}
```

If `endpoint`/`MCP_BROKER_ENDPOINT` or `authToken`/`MCP_BROKER_AUTH_TOKEN` is missing, the meta-tools are still registered, but any call returns a clear configuration error — Pi remains usable on machines without a broker.

## Read-only mode

Set `readOnly: true` in settings or `MCP_BROKER_READONLY=1`/`true` in the environment to activate read-only mode. In this mode:

- **Filtered tool list** — on `session_start`, only tools whose MCP `annotations.readOnlyHint === true` are fetched and cached. `mcp_search` and `mcp_describe` only see this filtered set.
- **Defense-in-depth** — `mcp_call` refreshes the broker tool list before forwarding and checks the requested tool name against that filtered read-only list. Any name not in the list is rejected immediately with the error `mcp_call: tool '<name>' is not available in read-only mode`. This catches stale or injected names even when the startup cache is absent.
- **Bash guard** — the guard's fuzzy-match suggestions are drawn from the same cached list, so it naturally surfaces only read-only tools in this mode. No extra code is required.

Subagents activate read-only mode via the `env:` block in their agent frontmatter:

```markdown
---
extensions: mcp-broker
env:
  MCP_BROKER_READONLY: "1"
---
```

## Large output spillover

When an `mcp_call` result exceeds **25,000 characters** of joined text, the extension writes the full output to a temporary file and returns a short envelope instead:

```
<persisted-output>
Output too large (46.2 KB / 47312 chars). Full output saved to: `/tmp/pi-extension-spillover/call_abc123.txt`

Preview (first 2.0 KB):
…

…45312 bytes truncated…

Use the read tool on the path above to fetch the full content.
</persisted-output>
```

File location: `${tmpdir()}/pi-extension-spillover/<toolCallId>.txt`. Files are written with owner-only permissions and old spillover files are cleaned up lazily by the shared spillover helper.

**Scope and edge cases:**

- Only `mcp_call` is affected. `mcp_search` and `mcp_describe` outputs are bounded by design and are never spilled.
- Error responses are never spilled — they pass through inline regardless of size.
- Multi-block results: all text blocks are joined and measured together; if the total exceeds the threshold, the joined text is spilled and image blocks are preserved inline.
- Write failure (disk full, permissions): the extension falls back to returning the original content inline rather than failing the tool call.

## Logging

Failed `mcp_call` invocations write a retained diagnostic log under `${tmpdir()}/pi-extension-logs/mcp-broker/`, and the returned tool error includes the log path when logging succeeds. Logs are written with owner-only permissions and cleaned up lazily by the shared logging helper. These logs may contain broker tool names, arguments implied by error output, and raw failure messages.

Large-output spillover writes temporary output files as described above; those files may contain raw broker tool output. If a spillover write fails, the extension returns the original content inline.

## Guard behavior

When `gh ...` or a remote git operation is detected in bash:

1. Bash runs as the agent requested — nothing is blocked.
2. After the bash result lands, a steering message is queued for the agent. It names up to three likely broker tools (fuzzy-matched from the cached tool list against the bash subcommand) and reminds the agent to use `mcp_call`. One steer per turn at most, so back-to-back matches don't pile up.
3. A UI notification surfaces the hint to the user.

The steer is delivered via `pi.sendMessage` rather than `tool_result` content rewriting because Pi discards `tool_result` content modifications when the underlying tool reports an error — and auth failures (the most common trigger) are exactly that case.

If the broker is unreachable (no cached tool list), the hint falls back to suggesting `mcp_search`. Detection strips quoted substrings before matching, so `git commit -m "fix gh issue"` does not trigger.

## File layout

- `index.ts` — entry point, loads configuration, instantiates `BrokerClient`, wires up tools, guard, and the broker tool menu in the system prompt
- `config.ts` — settings/env merge and validation
- `client.ts` — `BrokerClient` wrapping `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`
- `tools.ts` — `mcp_search`, `mcp_describe`, `mcp_call` definitions
- `spillover.ts` — re-exports shared large-output spill-to-file logic from `../_shared/spillover.ts`
- `guard.ts` — bash detection and `tool_result` hint injection

## Prior art

- [tickernelz/pi-mcp-tools](https://github.com/tickernelz/pi-mcp-tools) — universal Pi MCP extension that connects local and remote MCP servers, auto-registers tools, and provides commands for status, reconnect, toggling, and tool selection.
- [nicobailon/pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) — proxy-tool pattern for exposing an MCP broker to Pi through a minimal set of meta-tools rather than one-tool-per-upstream-tool fan-out. Influenced the decision to go with a small static surface instead of fanning upstream tools into the Pi tool list, and demonstrated the value of making the meta-tool's search/describe path feel first-class.
- Claude Code's `ToolSearch` + `defer_loading` pattern — studied and explicitly not copied. Claude Code accepts prompt-cache invalidation on tool discovery in exchange for context-window savings; this extension optimizes in the other direction (cache stability > per-call token efficiency) because Pi has no API-level `defer_loading` support and our sessions are long-lived.
