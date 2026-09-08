# MCP Gateway

Default Pi integration for the companion MCP Gateway. It keeps three stable meta-tools instead of exposing hundreds of upstream schemas. Normal discovery and explicit child loading activate the same integration without an opt-in flag.

## Startup

When installed, start Pi normally. Missing configuration or an unavailable gateway leaves Pi usable; MCP tools report actionable errors. `/mcp-gateway-config` is available for inspection.

To test a source checkout without installation, start a **new session** with the explicit extension path:

Enter the agent token without placing its value in shell history (Bash):

```bash
read -r -s -p 'Gateway agent token: ' MCP_GATEWAY_AGENT_TOKEN
printf '\n'
export MCP_GATEWAY_AGENT_TOKEN

MCP_GATEWAY_ENDPOINT=http://127.0.0.1:8210/mcp \
pi --no-extensions -e /absolute/agent-config/pi/agent/extensions/mcp-gateway/index.ts
```

`--no-extensions` disables discovery but still loads explicit `-e` paths. Add other extensions only if they do not provide the MCP meta-tools. A conflicting provider produces a startup error without replacing its tools; remove the duplicate provider and restart rather than relying on load order. No installation or Stow command is required to run the explicit source path.

### VM/container forwarding

For a gateway on the host, explicitly configure its trusted forwarding hostname, for example `MCP_GATEWAY_ENDPOINT=http://host.lima.internal:8211/mcp`. The gateway must independently allow that exact Host name with `serve --allowed-host host.lima.internal`; arrange host-to-guest reachability separately. The extension does not rewrite the Host header to bypass gateway checks.

An HTTP hostname selected through global settings or environment is an explicit trust decision about DNS and the entire forwarding path. HTTP provides no confidentiality or server authentication: use it only for trusted local forwarding, and use HTTPS for remote networks. ASCII DNS labels (including single-label names) are accepted; non-loopback IP literals, underscores, empty labels, trailing dots, and numeric final labels are rejected for HTTP. There is no Lima-specific allowlist in the extension.

The companion's stock `serve-demo` launcher currently does not expose `--allowed-host`. For that demo, use a trusted loopback tunnel or run Pi on the same host; configuring a hostname in Pi alone cannot make the demo accept its Host header. A gateway HTTP error after configuration loads is a separate server/reachability issue.

## Tools and discovery

- `mcp_search({query})` searches names, titles, and descriptions. It returns at most **20** ranked names and short descriptions, with shown/matching/total counts. Empty query returns the first 20 in name order; narrow the query for omitted matches.
- `mcp_describe({name})` returns the exact descriptor, including input schema, optional output schema, and annotations.
- `mcp_call({name, arguments})` invokes the exact external name using its input schema. Gateway validates arguments and authorizes the call.

The prompt contains at most **24 namespaces**, each with its tool count, plus fixed discovery guidance. It never injects the full tool inventory or schemas. Namespace names are bounded to 80 characters. Tool metadata is untrusted data, not instructions or authorization.

Discovery uses modern stateless HTTP MCP **2026-07-28**, without a long-lived SDK session. There is no legacy negotiation or automatic downgrade. Startup, each agent start, search, and describe refresh the paginated catalog. The guard uses only the most recently completed traversal. Failed/incomplete discovery drops the cache. A stale cursor restarts discovery once, within the same deadline; other discovery failures are surfaced without retry.

Each response is bounded to **16 MiB**; a discovery operation shares **32 MiB**, **100 pages**, and **10,000 descriptors** across both attempts, including discarded pages and JSON error bodies. Byte budgets are enforced while consuming the response, before JSON parsing; the chunk that crosses a limit is rejected and the remaining body cancelled. Repeated cursors, duplicate names, malformed descriptors, and over-limit catalogs fail explicitly rather than returning apparent completeness.

## Configuration

Use global Pi settings under `extension:mcp-gateway`, or environment overrides, for nonsecret settings. The agent bearer comes **only from `MCP_GATEWAY_AGENT_TOKEN`**; token settings in JSON are ignored. **Project-local extension settings are deliberately ignored**: a project must not redirect a host credential to its own endpoint. `credentialFile` and `MCP_GATEWAY_CREDENTIAL_FILE` are no longer supported and never read; replace them with the token environment variable.

Use `/mcp-gateway-config` to inspect parsed configuration. The token is masked, and invalid endpoint/token configurations are suppressed from display. Invalid settings JSON is reported without including its contents.

| Field                   | Default | Environment override               | Description                                                                                                                                                       |
| ----------------------- | ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`              | unset   | `MCP_GATEWAY_ENDPOINT`             | Exact `/mcp` URL. HTTPS, or HTTP on numeric IPv4 loopback or an explicitly trusted forwarding hostname. No userinfo, query, fragment, or redirects.               |
| `agentToken` (env only) | unset   | `MCP_GATEWAY_AGENT_TOKEN`          | One `mgw_agent_` bearer, with surrounding whitespace trimmed. Required; administrator credentials are rejected. Not accepted from settings JSON.                  |
| `readOnly`              | `false` | `MCP_GATEWAY_READONLY`             | Restrict discovery and invocation to explicit `readOnlyHint: true`. Boolean overrides accept `1`/`true` and `0`/`false`. Invalid values fail closed to read-only. |
| `discoveryTimeoutMs`    | `15000` | `MCP_GATEWAY_DISCOVERY_TIMEOUT_MS` | Total discovery deadline, including all pages and one stale-cursor restart. Positive integer up to 300000; invalid values use the default.                        |
| `callTimeoutMs`         | `65000` | `MCP_GATEWAY_CALL_TIMEOUT_MS`      | Total invocation deadline, including read-only admission. Positive integer up to 300000; invalid values use the default.                                          |

```json
{
  "extension:mcp-gateway": {
    "endpoint": "http://127.0.0.1:8210/mcp",
    "readOnly": false,
    "discoveryTimeoutMs": 15000,
    "callTimeoutMs": 65000
  }
}
```

Environment values override global settings when set, including blank endpoint overrides. The token has no settings or file fallback; an unset, blank, or malformed token prevents requests. Configuration and token are sampled from Pi's process environment at session/agent start. Token changes abort old operations and clear cached discovery. Changing the parent shell's environment does not update a running Pi process: restart Pi with the new token. `/reload` can only see the environment already available to Pi.

Keep bearer values out of shell history, command arguments, settings JSON, prompts, and logs. Environment variables can be inherited by child processes and inspected by code running in Pi; this is a convenience trade-off, not an OS security boundary. Gateway agent credentials have no administrator authority. Unset `MCP_GATEWAY_AGENT_TOKEN` in your shell when no longer needed.

## Read-only mode and approvals

Read-only discovery excludes tools whose annotation is missing or not exactly `true`. Before every call, the client refreshes the filtered catalog and rejects names absent from it. Credential identity is pinned across discovery pages and between read-only admission and invocation; reconfiguring the token aborts old operations rather than combining identities. The next operation can discover with the new credential.

Direct subagents and workflow children requesting `read-mcp` explicitly load this extension and force `MCP_GATEWAY_READONLY=1` after inherited environment values. They inherit endpoint configuration and the process-environment token, and receive `read` for spill inspection. These checks are **not argument-sensitive proof that an operation is read-only**, nor a credential sandbox. Gateway grants govern actual authority.

Identity and grant-request operations such as `mcp_gateway.create_grant_request` are ordinary MCP tools. Search, describe, and invoke them like any other tool. The extension does not recognize approval-required calls, open an approval UI, poll requests, or replay calls after grants change. Gateway approvals do not execute the motivating operation; any later invocation is explicit.

## Errors and cancellation

Tool failures are surfaced as Pi tool errors, with safe gateway codes and invocation IDs where provided. Unknown outcomes explicitly warn against automatic retries. Raw HTTP problem bodies and JSON-RPC error messages are not copied; inspect gateway-side evidence for deeper diagnostics.

Calls are **never automatically replayed**, including after connection failure, timeout, cancellation, or shutdown. Cancelling Pi aborts request work, but does not establish rollback or nonexecution. The client deadline is not a guarantee of server completion: a gateway/network timeout can end a response earlier. Discovery retries never retry an invocation.

## Output and logging

Catalogs, descriptors, and call content are wrapped as untrusted external data. Embedded boundary markers are escaped. Text and supported images are preserved; embedded text resources, audio, resource links, unsupported blocks, and structured content are represented as JSON/text. Structured content stays in the framed result, not duplicated in renderer details. Aggregate image data above **5,000,000 characters** becomes spillable text. Credential-shaped gateway bearers and exact bearer echoes are redacted before responses leave the client.

Framed text above **25,000 characters** spills to `${tmpdir()}/pi-extension-spillover/`, with a bounded preview framed again. Directories use `0700`, files `0600`; files older than seven days are cleaned lazily. If persistence fails, the original framed content stays inline. Spill files may contain raw tool output (apart from gateway bearer redaction); handle them as sensitive external data. This is not a general secret redactor.

Failed calls write small diagnostic logs under `${tmpdir()}/pi-extension-logs/mcp-gateway/`, using the shared logger's owner-only files and lazy seven-day retention. Logs contain only the failure code and optional invocation ID—not arguments, credentials, raw HTTP errors, or result payloads. The returned failure includes a log path when available. No persistent catalog or transport session is stored.

Tool rows use a single header: bold tool name, accent query/target, and muted argument names (never argument values) for calls. Successful search results show matching/total counts and a shown count when capped; describe shows a short description; calls preview up to three nonempty output lines with an omitted-line count. Success does not repeat the header or add a completion banner. Running rows show yellow progress, and failures show a red action-specific error with unknown-outcome warnings kept visible. Expanded rows include counts, diagnostic/spill paths, and up to 30 bounded text lines. Renderers strip terminal control sequences before styling and truncate to available width.

## Advisory bash guard

Direct `gh` and remote-git operations (`push`, `pull`, `fetch`, `ls-remote`, and networked `remote show/update/prune`) still execute. The guard queues at most one steering hint per turn, with up to three visible candidates. It does not echo the command or arguments into retained hints. Local git is unaffected. Detection is heuristic; false positives never block work.

## Migration and qualification

This is a breaking replacement of `mcp-broker`: remove its explicit extension paths, `extension:mcp-broker` settings, and `MCP_BROKER_*` environment values from your local launch configuration. They are not gateway aliases or fallback configuration. Replace `read-broker` with `read-mcp` in local capability ceilings, workflow scripts and prompts; the old capability is rejected. Remove the obsolete `--mcp-gateway` trial flag.

Configure the endpoint in trusted global settings or environment and supply `MCP_GATEWAY_AGENT_TOKEN` only in the process environment. Update private scheduled tasks and their prechecks to gateway semantics; allow `mcp_search`, `mcp_describe`, `mcp_call` and read-only filesystem tools for spill inspection. Do not store tokens in task Markdown or settings JSON. Restart Pi and scheduler launch processes with the intended environment. Existing running sessions are not hot-migrated. Applying installation, private settings/task migration, service changes or deployment requires separate authorization.

If MCP fails, inspect `/mcp-gateway-config`, endpoint reachability and gateway grants; do not restore a compatibility provider or replay an uncertain invocation. Grant requests remain ordinary tools, not held approval calls.

Automated HTTP fixtures and loader tests are not live gateway qualification. Record exact extension and deployed gateway revisions, environment, discovery/describe/safe-call outcomes, read-only exclusion, noninteractive failures and gaps for normal Pi, a direct child, a workflow child and a scheduled run. The isolated demo and a configured real gateway are alternatives; neither is provisioned automatically. Real external mutations require explicit authorization.
