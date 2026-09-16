# web-access

Web access extension for Pi — provides `web_search` and `web_fetch` tools.

## Tools

### web_search

Search the web for current information. Returns titles, URLs, and relevant snippets.

| Parameter     | Type    | Required | Description                                      |
| ------------- | ------- | -------- | ------------------------------------------------ |
| `query`       | string  | yes      | Search query                                     |
| `num_results` | integer | no       | Number of results to return, 1–10; defaults to 5 |

Example:

```json
{ "query": "Pi coding agent extension docs", "num_results": 3 }
```

Provider order:

1. [Tavily](https://app.tavily.com) when configured.
2. The hosted [Exa MCP](https://docs.exa.ai/docs/reference/exa-mcp), authenticated when an Exa API key is configured and otherwise keyless. The anonymous service does not publish a fixed free quota.
3. [Jina Search](https://jina.ai) when a Jina API key is configured. Jina Search no longer accepts anonymous requests.

### web_fetch

Fetch and read web content as clean markdown.

| Parameter   | Type    | Required | Description                                               |
| ----------- | ------- | -------- | --------------------------------------------------------- |
| `url`       | string  | yes      | Full URL to fetch, including `https://`                   |
| `max_chars` | integer | no       | Maximum characters to return, 1–32,000; defaults to 8,000 |

Example:

```json
{ "url": "https://example.com/docs", "max_chars": 12000 }
```

Routes by URL type:

- **HTML pages** — local Readability extraction, optional local Playwright rendering, anonymous/keyed Jina Reader, then authenticated or keyless Exa MCP
- **GitHub repos** — shallow-clones the public repository without interactive authentication and returns the README, file tree, and clone path for further exploration with Pi's built-in tools
- **PDFs** — returns extracted text and page-count metadata

The Playwright fallback requires Chromium installed for the repository's pinned `playwright-core` version. Run `make install-playwright` from the repository root. If Playwright or Chromium is unavailable, the extension continues to the hosted fallbacks.

<a id="script-composition"></a>

## Script provider

### Availability

When web-access is active it registers the `web` namespace through the supported [Script provider API](../script/API.md). Put `"web"` in the global Script `allowedProviders` policy and explicitly select `providers: ["web"]`. Registration alone grants no execution access.

Web-only scripts need no MCP Gateway. Hosted Exa MCP is an existing web transport, not the Gateway extension. Direct web tools work without the Script tool loaded. The provider is available after session startup; factory order is irrelevant. The sibling Script host library must remain installed, but its extension need not be activated.

### Methods

| Method                              | Purpose                                         | Guest result                                        |
| ----------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| `web.search({query, num_results?})` | Search through configured web providers         | Existing `web_search` `{content, details}` envelope |
| `web.fetch({url, max_chars?})`      | Retrieve a public page, PDF, or GitHub resource | Existing `web_fetch` `{content, details}` envelope  |

These are not new structured search/page APIs. Untrusted framing, configured fallbacks, limits, clone reuse and spill behavior are shared with the direct tools. Optional `undefined` metadata is omitted for JSON transport. Runtime discovery is authoritative for positional argument schemas; this section owns web-specific semantics, while shared bounds and execution rules live in [Script](../script/README.md).

### Example

Discover the method schemas first:

```js
script({
  action: "describe",
  description: "Inspect web composition methods",
  providers: ["web"],
});
```

Then select the provider for execution:

```js
script({
  action: "run",
  description: "Read a public page summary",
  providers: ["web"],
  source: `
    const page = await web.fetch({url: "https://example.com", max_chars: 1000});
    return {content: page.content, details: page.details};
  `,
});
```

For cross-provider composition, enable and select both `mcp` and `web`. Discover exact MCP names with `mcp_search` and inspect schemas with `mcp_describe` first. This illustrative tool must return the documented `structuredContent.url` field:

```js
script({
  action: "run",
  description: "Read a discovered item's public page",
  providers: ["mcp", "web"],
  source: `
    const item = await mcp.call("example.lookup", {query: "public page"});
    if (item.isError) return {failed: true};
    const page = await web.fetch({url: item.structuredContent.url, max_chars: 1000});
    return {content: page.content, method: page.details.method};
  `,
});
```

### Permissions and effects

Provider selection is not user approval: obtain applicable authority before operations with side effects. Queries and URLs may be sent to configured external services; the [network and content safety limits](#external-content-safety) apply equally to composed calls.

Clone/spill paths are host references only. The guest gets no filesystem, raw network, process or credential binding and cannot invoke `read` on a returned path. Follow-up file exploration requires a separate authorized host tool. Selecting web nevertheless permits its existing host retrieval implementation, including GitHub cached-file reads, temporary writes and lazy cleanup; this is not a filesystem/egress sandbox. A host-generated unique ID names each potential spill. GitHub cache handling assumes trusted local cache paths and does not isolate repository symlinks. Network/DNS and cache limitations below remain applicable. Nested provider calls do not synthesize Pi tool hooks; gate the outer Script tool when needed.

### Failure and lifecycle

Retrieval errors, including PDF HTTP errors, carry framed text and `details.errorPreview`. Any error preview forces failed Script accounting even if the guest ignores it; retrieval errors conservatively mark the outcome unknown because the tools do not prove absence of effects. Inspect Script status before using returned JSON.

The provider is disposed on shutdown, cancelling executions selecting it. The execution signal and absolute deadline bound host admission and propagate to web requests and clone subprocesses. Script call/concurrency ceilings apply to logical search/fetch calls; existing fallback attempts occur inside those calls. No extra bridge retries or replay are added. Await every operation: unfinished calls fail accounting. Cancellation is not rollback; clones, cleanup and spills may survive, and non-abortable DNS, PDF parsing, filesystem work or browser startup may settle late. The runtime cannot interrupt synchronous host work. Final explicit JSON must fit Script's 24,000-byte limit even when the web tool's inline output is larger; return a compact selection rather than automatically replaying on overflow.

## Configuration

Configure via `extension:web-access` in Pi settings. Environment variables override settings when set. Use `/web-access-config` to display the effective parsed config with API keys masked.

| Field               | Default | Environment override            | Description                                                                                                                                                        |
| ------------------- | ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tavilyApiKey`      | unset   | `TAVILY_API_KEY`                | Enables Tavily as the primary search provider.                                                                                                                     |
| `jinaApiKey`        | unset   | `JINA_API_KEY`                  | Enables keyed Jina Search and raises Jina Reader limits. Reader retries anonymously after a keyed 401/402; Search requires a funded key.                           |
| `exaApiKey`         | unset   | `EXA_API_KEY`                   | Authenticates hosted Exa MCP search and fetch requests through the `x-api-key` header; requests remain anonymous when unset.                                       |
| `playwrightEnabled` | `true`  | `WEB_ACCESS_PLAYWRIGHT_ENABLED` | Enables local browser rendering after static extraction fails. Boolean environment values accept `1`/`true` and `0`/`false`; missing browser binaries are skipped. |

Example settings:

```json
{
  "extension:web-access": {
    "tavilyApiKey": "tvly-...",
    "jinaApiKey": "jina_...",
    "exaApiKey": "exa-...",
    "playwrightEnabled": true
  }
}
```

## External content safety

Successful `web_search` and `web_fetch` results are wrapped in a short `BEGIN/END UNTRUSTED EXTERNAL ... CONTENT` envelope. Remote provider/fetch error messages are framed too, while the renderer uses a bounded error preview. The envelope reminds the agent that fetched web pages, search snippets, GitHub contents, PDF text, and remote error bodies are external data rather than instructions. Delimiter-like lines inside external content are escaped. Content is wrapped before large-output spillover so the persisted file retains the same trust boundary.

Generic and PDF fetches accept only public HTTP(S) URLs without embedded credentials. The extension rejects literal and DNS-resolved loopback, private, link-local, metadata, multicast, and reserved destinations; validates every HTTP redirect; and applies the same checks to Playwright subrequests. These application checks reduce SSRF risk but do not eliminate DNS-rebinding races, so do not treat the browser as a network sandbox.

Search queries and fallback fetch URLs are sent to the selected external provider. Exa MCP receives the configured Exa key in an `x-api-key` header; without one it uses the anonymous service. Anonymous Exa MCP and Jina Reader require no local credential but remain third-party services with changeable limits and privacy policies.

GitHub clones disable credential helpers and interactive terminal prompts. An unavailable or inaccessible repository fails without asking for GitHub credentials. GitHub rate-limit failures are returned as recoverable tool-result messages with a retry/backoff hint instead of being treated as unrecoverable extension failures.

## Temporary files

For GitHub repository URLs, `web_fetch` shallow-clones the repository and returns that clone path for follow-up exploration with Pi's built-in tools. Bare repository URLs clone to `/tmp/pi-github-repos/<owner>/<repo>`. `blob` and `tree` URLs with a ref clone to a ref-specific path such as `/tmp/pi-github-repos/<owner>/<repo>--<sanitized-ref>`, so branch/tag/commit URLs do not collide with the default-branch cache. If the clone already exists and contains a `.git` directory, it is reused. On each GitHub fetch, the extension best-effort deletes cached clone directories older than 7 days. These temp clones contain raw repository contents fetched from the requested public GitHub URL; raw file contents may also be returned directly for GitHub blob URLs.

When wrapped search, fetch, or remote-error output exceeds 25,000 joined text characters, the full wrapped content is written to `${tmpdir()}/pi-extension-spillover/<toolCallId>.txt` and the tool returns a wrapped `<persisted-output>` envelope with a preview and path for the `read` tool. The spill directory is restricted to the current user with mode `0700`, files use mode `0600`, and old files are cleaned up lazily after 7 days. If directory validation or persistence fails, the full wrapped content is returned inline.

## Logging

This extension does not write retained logs or diagnostic files. Large-output spill files and GitHub clone caches are temporary artifacts described above; both may contain raw external content and should not be treated as sanitized.

## Prior art

This extension was informed by exploring these projects:

- [eysenfalk/pi-search](https://github.com/eysenfalk/pi-search) — Pi web search/fetch extension using OpenAI/Codex web search, Readability/Turndown extraction, Playwright fallback, link extraction, and private-host blocking.
- [mavam/pi-web-providers](https://github.com/mavam/pi-web-providers) — provider-routed Pi web tools with configurable search, content extraction, grounded answers, research providers, and background page prefetch.
- [pi-web-access](https://github.com/nicobailon/pi-web-access) — multi-provider search, GitHub cloning, PDF extraction, Readability-based content extraction
- [oh-my-pi](https://github.com/can1357/oh-my-pi) — multi-provider search fallback chains, intelligent content-type routing
