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

- **Primary provider**: [Tavily](https://app.tavily.com) (1,000 free searches/month)
- **Fallback**: [Jina Search](https://jina.ai) (works without an API key)

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

- **HTML pages** — local extraction via [Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown), with [Jina Reader](https://jina.ai/reader) as fallback for JS-rendered pages
- **GitHub repos** — shallow-clones the repository and returns the README, file tree, and clone path for further exploration with Pi's built-in tools
- **PDFs** — extracts text via [unpdf](https://github.com/unjs/unpdf)

## Configuration

Configure via `extension:web-access` in Pi settings. Environment variables override settings when set. Use `/web-access-config` to display the effective parsed config with API keys masked.

| Field          | Default | Environment override | Description                                                                                                                  |
| -------------- | ------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tavilyApiKey` | unset   | `TAVILY_API_KEY`     | Recommended for `web_search`; when absent, `web_search` falls back to Jina Search.                                           |
| `jinaApiKey`   | unset   | `JINA_API_KEY`       | Optional; improves Jina rate limits. When absent, Jina-backed search/fetch still works where anonymous rate limits allow it. |

Example settings:

```json
{
  "extension:web-access": {
    "tavilyApiKey": "tvly-...",
    "jinaApiKey": "jina_..."
  }
}
```

## External content safety

Successful `web_search` and `web_fetch` results are wrapped in a short `BEGIN/END UNTRUSTED EXTERNAL ... CONTENT` envelope. The envelope reminds the agent that fetched web pages, search snippets, GitHub contents, and PDF text are external data rather than instructions.

GitHub rate-limit failures are returned as recoverable tool-result messages with a retry/backoff hint instead of being treated as unrecoverable extension failures.

## Temporary files

For GitHub repository URLs, `web_fetch` shallow-clones the repository and returns that clone path for follow-up exploration with Pi's built-in tools. Bare repository URLs clone to `/tmp/pi-github-repos/<owner>/<repo>`. `blob` and `tree` URLs with a ref clone to a ref-specific path such as `/tmp/pi-github-repos/<owner>/<repo>--<sanitized-ref>`, so branch/tag/commit URLs do not collide with the default-branch cache. If the clone already exists and contains a `.git` directory, it is reused. Clones are not actively cleaned up by the extension. These temp clones contain raw repository contents fetched from the requested public GitHub URL; raw file contents may also be returned directly for GitHub blob URLs.

## Logging

This extension does not write retained logs or diagnostic files.

## Prior art

This extension was informed by exploring these projects:

- [eysenfalk/pi-search](https://github.com/eysenfalk/pi-search) — Pi web search/fetch extension using OpenAI/Codex web search, Readability/Turndown extraction, Playwright fallback, link extraction, and private-host blocking.
- [mavam/pi-web-providers](https://github.com/mavam/pi-web-providers) — provider-routed Pi web tools with configurable search, content extraction, grounded answers, research providers, and background page prefetch.
- [pi-web-access](https://github.com/nicobailon/pi-web-access) — multi-provider search, GitHub cloning, PDF extraction, Readability-based content extraction
- [oh-my-pi](https://github.com/can1357/oh-my-pi) — multi-provider search fallback chains, intelligent content-type routing
