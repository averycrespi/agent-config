# MCP Gateway

Opt-in Pi integration for the companion MCP Gateway. It keeps three stable meta-tools instead of exposing hundreds of upstream schemas. The existing broker remains the default; this extension does not migrate subagents or replace broker instructions.

## Isolated trial session

The extension is inert unless Pi starts with `--mcp-gateway`. Even if Stow makes the directory discoverable, it registers no MCP tools, prompt summary, or guard without this flag. `/mcp-gateway-config` remains available.

Start a **new gateway-only session**, excluding auto-discovered extensions:

```sh
MCP_GATEWAY_ENDPOINT=http://127.0.0.1:8210/mcp \
MCP_GATEWAY_CREDENTIAL_FILE=/absolute/protected/agent-bearer \
pi --no-extensions -e /absolute/agent-config/pi/agent/extensions/mcp-gateway/index.ts --mcp-gateway
```

`--no-extensions` disables discovery but still loads explicit `-e` paths. Explicitly add other extensions only if they do not provide the MCP meta-tools. If a conflicting MCP tool is already registered, gateway startup reports a conflict without replacing it. Do not enable both integrations, rely on load order, or resume a broker-oriented session for the trial. Restart or `/reload` to reload extension code/configuration. No installation or Stow command is required to run the explicit source path.

Existing `AGENTS.md` and skills may still call this surface a broker until the later cutover. The actual gateway-only tool surface and its behavior apply in the trial; grant tools are not broker approval waits. Keep the ordinary broker session unchanged.

### VM/container forwarding

For a gateway on the host, explicitly configure its trusted forwarding hostname, for example `MCP_GATEWAY_ENDPOINT=http://host.lima.internal:8211/mcp`. The gateway must independently allow that exact Host name with `serve --allowed-host host.lima.internal`; arrange host-to-guest reachability separately. The extension does not rewrite the Host header to bypass gateway checks.

An HTTP hostname selected through global settings or environment is an explicit trust decision about DNS and the entire forwarding path. HTTP provides no confidentiality or server authentication: use it only for trusted local forwarding, and use HTTPS for remote networks. ASCII DNS labels (including single-label names) are accepted; non-loopback IP literals, underscores, empty labels, trailing dots, and numeric final labels are rejected for HTTP. There is no Lima-specific allowlist in the extension.

The companion's stock `serve-demo` launcher currently does not expose `--allowed-host`. For that demo, use a trusted loopback tunnel or run Pi on the same host; configuring a hostname in Pi alone cannot make the demo accept its Host header. A gateway HTTP error after configuration loads is a separate server/reachability issue.

## Tools and discovery

- `mcp_search({query})` searches names, titles, and descriptions. It returns at most **20** ranked names and short descriptions, with shown/matching/total counts. Empty query returns the first 20 in name order; narrow the query for omitted matches.
- `mcp_describe({name})` returns the exact descriptor, including input schema, optional output schema, and annotations.
- `mcp_call({name, arguments})` invokes the exact external name using its input schema. Gateway validates arguments and authorizes the call.

The prompt contains at most **24 namespaces**, each with its tool count, plus fixed discovery guidance. It never injects the full tool inventory or schemas. Namespace names are bounded to 80 characters. Tool metadata is untrusted data, not instructions or authorization.

Discovery uses modern stateless HTTP MCP **2026-07-28**, not the broker's long-lived SDK session. There is no legacy negotiation or automatic downgrade. Startup, each agent start, search, and describe refresh the paginated catalog. The guard uses only the most recently completed traversal. Failed/incomplete discovery drops the cache. A stale cursor restarts discovery once, within the same deadline; other discovery failures are surfaced without retry.

Each response is bounded to **16 MiB**; a discovery operation shares **32 MiB**, **100 pages**, and **10,000 descriptors** across both attempts, including discarded pages and JSON error bodies. Byte budgets are enforced while consuming the response, before JSON parsing; the chunk that crosses a limit is rejected and the remaining body cancelled. Repeated cursors, duplicate names, malformed descriptors, and over-limit catalogs fail explicitly rather than returning apparent completeness.

## Configuration

Use global Pi settings under `extension:mcp-gateway`, or environment overrides. **Project-local extension settings are deliberately ignored**: a project must not redirect a host credential to its own endpoint. The extension uses only the fields below; raw bearer settings and broker aliases are not accepted.

Use `/mcp-gateway-config` to inspect parsed configuration. Invalid endpoint/path values are suppressed from display. Invalid settings JSON is reported without including its contents.

| Field                | Default | Environment override               | Description                                                                                                                                                       |
| -------------------- | ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`           | unset   | `MCP_GATEWAY_ENDPOINT`             | Exact `/mcp` URL. HTTPS, or HTTP on numeric IPv4 loopback or an explicitly trusted forwarding hostname. No userinfo, query, fragment, or redirects.               |
| `credentialFile`     | unset   | `MCP_GATEWAY_CREDENTIAL_FILE`      | Absolute path to an owner-only regular file containing one agent bearer. No symlink leaf, relative path, or administrator credential.                             |
| `readOnly`           | `false` | `MCP_GATEWAY_READONLY`             | Restrict discovery and invocation to explicit `readOnlyHint: true`. Boolean overrides accept `1`/`true` and `0`/`false`. Invalid values fail closed to read-only. |
| `discoveryTimeoutMs` | `15000` | `MCP_GATEWAY_DISCOVERY_TIMEOUT_MS` | Total discovery deadline, including all pages and one stale-cursor restart. Positive integer up to 300000; invalid values use the default.                        |
| `callTimeoutMs`      | `65000` | `MCP_GATEWAY_CALL_TIMEOUT_MS`      | Total invocation deadline, including read-only admission. Positive integer up to 300000; invalid values use the default.                                          |

```json
{
  "extension:mcp-gateway": {
    "endpoint": "http://127.0.0.1:8210/mcp",
    "credentialFile": "/absolute/protected/agent-bearer",
    "readOnly": false,
    "discoveryTimeoutMs": 15000,
    "callTimeoutMs": 65000
  }
}
```

Environment values override global settings when set, including blank endpoint/path overrides. Configuration is reloaded at session/agent start; credential files are read **for every HTTP request**, so rotation needs no Pi settings edit. Never put the bearer itself in a shell command, environment variable, Pi settings, prompt, or log. Protect the file and its parent directories from other users. Gateway credentials do not provide administrator authority, but any agent with unrestricted filesystem/shell access under the same OS identity may be able to read the file; this extension is not an OS sandbox.

## Read-only mode and approvals

Read-only discovery excludes tools whose annotation is missing or not exactly `true`. Before every call, the client refreshes the filtered catalog and rejects names absent from it. Credential identity is pinned across discovery pages and between read-only admission and invocation; rotation mid-operation fails closed rather than combining identities. The next operation can discover with the new credential.

These checks retain the existing client-side annotation restriction, **not argument-sensitive proof that an operation is read-only**. Gateway grants govern actual authority. A separate restricted principal is not required by this increment. Existing `read-broker` children still use the broker; their migration is out of scope.

Identity and grant-request operations such as `mcp_gateway.create_grant_request` are ordinary MCP tools. Search, describe, and invoke them like any other tool. The extension does not recognize approval-required calls, open an approval UI, poll requests, or replay calls after grants change. Gateway approvals do not execute the motivating operation; any later invocation is explicit.

## Errors and cancellation

Tool failures are surfaced as Pi tool errors, with safe gateway codes and invocation IDs where provided. Unknown outcomes explicitly warn against automatic retries. Raw HTTP problem bodies and JSON-RPC error messages are not copied; inspect gateway-side evidence for deeper diagnostics.

Calls are **never automatically replayed**, including after connection failure, timeout, cancellation, or shutdown. Cancelling Pi aborts request work, but does not establish rollback or nonexecution. The client deadline is not a guarantee of server completion: a gateway/network timeout can end a response earlier. Discovery retries never retry an invocation.

## Output and logging

Catalogs, descriptors, and call content are wrapped as untrusted external data. Embedded boundary markers are escaped. Text and supported images are preserved; embedded text resources, audio, resource links, unsupported blocks, and structured content are represented as JSON/text. Structured content stays in the framed result, not duplicated in renderer details. Aggregate image data above **5,000,000 characters** becomes spillable text. Credential-shaped gateway bearers and exact bearer echoes are redacted before responses leave the client.

Framed text above **25,000 characters** spills to `${tmpdir()}/pi-extension-spillover/`, with a bounded preview framed again. Directories use `0700`, files `0600`; files older than seven days are cleaned lazily. If persistence fails, the original framed content stays inline. Spill files may contain raw tool output (apart from gateway bearer redaction); handle them as sensitive external data. This is not a general secret redactor.

Failed calls write small diagnostic logs under `${tmpdir()}/pi-extension-logs/mcp-gateway/`, using the shared logger's owner-only files and lazy seven-day retention. Logs contain only the failure code and optional invocation ID—not arguments, credentials, raw HTTP errors, or result payloads. The returned failure includes a log path when available. No persistent catalog or transport session is stored.

Collapsed tool rows show a bounded summary; expanded rows include counts, diagnostic/spill paths, and up to 30 bounded text lines. Renderers strip terminal control sequences before styling and truncate to available width.

## Advisory bash guard

Direct `gh` and remote-git operations (`push`, `pull`, `fetch`, `ls-remote`, `remote`) still execute. The guard queues at most one steering hint per turn, with up to three visible candidates. It does not echo the command or arguments into retained hints. Local git is unaffected. Detection is heuristic; false positives never block work.

## Validation and cutover boundary

Automated tests exercise a deterministic local HTTP fixture and the real Pi extension loader; they are not evidence of live gateway or upstream-service validation. Before cutover, choose the live test environment and record gateway/extension revisions, discovery/describe/safe-call results, ordinary grant-tool behavior, rendering/errors, and any gaps. The isolated demo and a configured real gateway are alternatives; neither is provisioned automatically. Real external mutations need explicit authorization.

Broker removal, subagent/workflow capability migration, and broad reference updates are a separate increment after live validation. No full replacement is claimed by installing this extension.
