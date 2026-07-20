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
2. The hosted [Exa MCP](https://docs.exa.ai/docs/reference/exa-mcp), which currently works without an API key but does not publish a fixed free quota.
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

- **HTML pages** — local Readability extraction, optional local Playwright rendering, anonymous/keyed Jina Reader, then keyless Exa MCP
- **GitHub repos** — shallow-clones the repository and returns the README, file tree, and clone path for further exploration with Pi's built-in tools
- **PDFs** — returns extracted text and page-count metadata

The Playwright fallback requires Chromium installed for the repository's pinned `playwright-core` version. Run `make install-playwright` from the repository root. If Playwright or Chromium is unavailable, the extension continues to the hosted fallbacks.

## Configuration

Configure via `extension:web-access` in Pi settings. Environment variables override settings when set. Use `/web-access-config` to display the effective parsed config with API keys masked.

| Field               | Default | Environment override            | Description                                                                                                                                                        |
| ------------------- | ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tavilyApiKey`      | unset   | `TAVILY_API_KEY`                | Enables Tavily as the primary search provider.                                                                                                                     |
| `jinaApiKey`        | unset   | `JINA_API_KEY`                  | Enables keyed Jina Search and raises Jina Reader limits. Reader retries anonymously after a keyed 401/402; Search requires a funded key.                           |
| `playwrightEnabled` | `true`  | `WEB_ACCESS_PLAYWRIGHT_ENABLED` | Enables local browser rendering after static extraction fails. Boolean environment values accept `1`/`true` and `0`/`false`; missing browser binaries are skipped. |

Example settings:

```json
{
  "extension:web-access": {
    "tavilyApiKey": "tvly-...",
    "jinaApiKey": "jina_...",
    "playwrightEnabled": true
  }
}
```

## External content safety

Successful `web_search` and `web_fetch` results are wrapped in a short `BEGIN/END UNTRUSTED EXTERNAL ... CONTENT` envelope. Remote provider/fetch error messages are framed too, while the renderer uses a bounded error preview. The envelope reminds the agent that fetched web pages, search snippets, GitHub contents, PDF text, and remote error bodies are external data rather than instructions. Delimiter-like lines inside external content are escaped. Content is wrapped before large-output spillover so the persisted file retains the same trust boundary.

Generic and PDF fetches accept only public HTTP(S) URLs without embedded credentials. The extension rejects literal and DNS-resolved loopback, private, link-local, metadata, multicast, and reserved destinations; validates every HTTP redirect; and applies the same checks to Playwright subrequests. These application checks reduce SSRF risk but do not eliminate DNS-rebinding races, so do not treat the browser as a network sandbox.

Search queries and fallback fetch URLs are sent to the selected external provider. Exa MCP and anonymous Jina Reader require no local credential but remain third-party services with changeable limits and privacy policies.

GitHub rate-limit failures are returned as recoverable tool-result messages with a retry/backoff hint instead of being treated as unrecoverable extension failures.

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
