# web-access Design

`web-access` gives Pi two explicit tools for current external information: `web_search` and `web_fetch`. It is designed as a bounded retrieval layer that returns external content as data, not as instructions.

## Architecture

- `index.ts` registers the tools, loads config lazily per cwd, routes fetches by URL type, wraps successful external content in an untrusted-content envelope, and renders compact tool output.
- `config.ts` loads Tavily/Jina API keys from Pi settings and environment variables.
- `search.ts` implements provider fallback for search: Tavily first when configured, then Jina Search.
- `fetch.ts` implements generic web-page extraction: local Readability/Turndown first, then Jina Reader fallback.
- `github.ts` parses GitHub URLs, shallow-clones repositories, returns README/file tree or blob contents, and handles local clone cache paths.
- `pdf.ts` extracts PDF text and metadata through `unpdf`.
- Tests cover config, search formatting/fallback, GitHub URL handling, and extension routing.

There is no persistent database, retained logging, browser automation, or background crawler.

## Tool model

The surface is intentionally small:

- `web_search` finds candidate pages and returns titles, URLs, snippets, and provider-normalized details.
- `web_fetch` reads one URL and returns cleaned content or a GitHub clone overview.

Do not merge search and fetch into a generic research workflow inside the extension. The agent should decide which search results to fetch and how to synthesize them.

## Configuration lifecycle

Config is cached by cwd in `index.ts` and loaded through the shared settings helper. API keys are optional:

- `tavilyApiKey` enables Tavily as the primary search provider.
- `jinaApiKey` improves Jina-backed search/fetch rate limits.

Missing keys should not disable the extension. Anonymous Jina fallback keeps the tools usable where rate limits allow. Keys are sensitive and must stay masked in `/web-access-config` output and out of tool results/logs.

## Search provider flow

`webSearch()` tries Tavily only when a Tavily key exists. Tavily failures are swallowed and Jina Search is attempted. Jina failures surface as tool-result errors.

Search output is normalized to `SearchResponse` with provider name and result list. `formatResults()` is the canonical Markdown formatter used for agent-facing content and preview rendering.

## Fetch routing

`web_fetch` routes by URL before generic page extraction:

1. GitHub repository/blob/tree URLs go to `fetchGitHub()`.
2. URLs whose path ends in `.pdf` go to direct fetch plus `extractPdf()`.
3. Everything else goes to `webFetch()` for Readability extraction with Jina Reader fallback.

Each route respects `max_chars`, clamped to the schema bounds. Route-specific metadata is returned in `details` so renderers can summarize clone paths, PDF page counts, or page titles.

## Generic web extraction

`fetch.ts` prefers local extraction for normal HTML:

- fetch with browser-like user agent and HTML accept headers;
- require an HTML/XHTML content type;
- parse with `linkedom`;
- extract article content with Readability;
- convert to Markdown with Turndown;
- require a minimum readable text length.

If local extraction fails or content is too sparse, Jina Reader is used with markdown output and common chrome selectors removed. Jina's header block is stripped before returning content.

## GitHub handling

GitHub support is optimized for repository exploration by Pi's built-in file tools. Repository URLs are shallow-cloned under `/tmp/pi-github-repos/<owner>/<repo>` or a ref-specific directory. Existing clones with a `.git` directory are reused.

Important boundaries:

- Only `github.com` URLs are parsed.
- Repository size is checked through `gh api` when available; if unavailable, clone proceeds without the size precheck.
- Clone and size commands use argument arrays, not shell strings.
- File trees skip common heavy/generated/binary directories and file extensions.
- Blob URLs return direct file contents plus the clone path.

GitHub rate-limit-looking errors are converted into recoverable tool-result messages with retry guidance.

## External content safety

All successful search/fetch content is wrapped with `BEGIN/END UNTRUSTED EXTERNAL ... CONTENT`. Preserve this envelope. Search snippets, fetched pages, repository files, and PDFs can contain prompt injection; they must be framed as untrusted data for the agent.

Do not add behavior that treats fetched content as extension instructions, Pi settings, tool arguments, or command input without explicit validation.

## Temporary files and cleanup

GitHub clones are stored under `/tmp/pi-github-repos` and are not actively cleaned up. The clone path is intentionally returned so the agent can inspect files with normal tools. These clones may contain arbitrary public repository contents and should not be treated as sanitized.

The extension writes no retained diagnostic logs.

## Boundaries and non-goals

- No authenticated GitHub integration; use the MCP broker for authenticated GitHub work.
- No Playwright/browser rendering fallback.
- No recursive crawl or multi-page research orchestration.
- No private-host blocking in v1.
- No active cleanup of temporary GitHub clones.
- No exact content deduplication or cache invalidation policy.

## Change guidance

When adding providers or URL routes, keep routing explicit and update tests for fallback behavior. Preserve untrusted-content wrapping for every successful external content path. If adding logs, temp files, authentication, cleanup, or browser execution, update README security/config/logging sections and keep secrets out of results.
