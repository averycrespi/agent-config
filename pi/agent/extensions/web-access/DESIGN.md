# web-access Design

`web-access` gives Pi two explicit tools for current external information: `web_search` and `web_fetch`. It is designed as a bounded retrieval layer that returns external content as data, not as instructions.

## Architecture

- `index.ts` registers the tools, loads config lazily per cwd, routes fetches by URL type, wraps successful external content and applies large-output spillover. `render.ts` supplies a bounded query/URL call label, nonduplicative typed search counts, muted spill summaries with labelled expanded paths, exceptional result warnings, and bounded expanded evidence. URL display preserves path/query context, removes userinfo/fragments, redacts recognizable secret parameter names, and uses width truncation within a 4,096-character safety cap (not general secret detection); routine fetch/read success and raw previews are not shown collapsed.
- `script-provider.ts` registers optional `web.search`/`web.fetch` through Script's supported API, adapting the same tool implementations to JSON and sticky failure accounting.
- `config.ts` loads Tavily, Jina, and Exa API keys plus the Playwright toggle from Pi settings and environment variables.
- `search.ts` implements provider fallback for search: Tavily, authenticated-or-keyless Exa MCP, then configured Jina Search.
- `fetch.ts` implements generic extraction: local Readability, optional local Playwright, Jina Reader, then authenticated-or-keyless Exa MCP.
- `exa.ts` implements the small JSON-RPC/SSE adapter shared by Exa search and fetch fallbacks, adding `x-api-key` authentication when configured.
- `url-safety.ts` validates public HTTP(S) targets, DNS answers, and redirects before local network access.
- `github.ts` parses GitHub URLs, shallow-clones repositories, returns README/file tree or blob contents, and handles local clone cache paths.
- `pdf.ts` extracts PDF text and metadata through `unpdf`.
- Tests cover config, provider fallback, browser extraction, URL safety, GitHub URL handling, and extension routing.

There is no persistent database, retained logging, persistent browser profile, or background crawler.

## Tool model

The surface is intentionally small:

- `web_search` finds candidate pages and returns titles, URLs, snippets, and provider-normalized details.
- `web_fetch` reads one URL and returns cleaned content or a GitHub clone overview.

Do not merge search and fetch into a generic research workflow inside the extension. The agent should decide which search results to fetch and how to synthesize them.

## Script boundary

The factory registers one provider on the session event bus; availability requires a started session context. Shutdown clears context and disposes the registration, aborting selected executions. Script need not be loaded as an extension and Gateway is not imported. The provider delegates only the two explicit web operations, never arbitrary tool names. Existing tools remain registered independently.

Reuse the authoritative tool execute functions so routing, formatting, safety, configured fallback and spill behavior cannot drift between surfaces. The adapter combines the execution signal with its absolute-deadline timer, checks cancellation before and after work, and generates spill IDs on the host. The JSON transport drops optional undefined fields. Existing `errorPreview` metadata, including PDF HTTP errors, sets sticky failure and conservative uncertainty: the tools' caught exceptions cannot certify no prior effects. Thrown/unfinished work is accounted by Script as unknown. No bridge-specific retry is permitted.

Script accounts logical provider calls, not each configured fallback request. Dispatched work can create or reuse clones, perform lazy cleanup, and write spills even when the enclosing script later fails. Non-abortable DNS, parsing and filesystem operations may outlive termination; the adapter cannot forcibly interrupt trusted host JavaScript. A returned path never becomes guest filesystem authority, but host cache reads retain their existing trust/symlink limitations. Preserve those distinctions in documentation.

Actual permissioned-child tests cover direct/bridge envelope equivalence, Gateway-free web calls, MCP-to-web-to-MCP result dependencies, selection/argument denial, fallback, URL/DNS/redirect safety, errors, cached blobs, spills, cancellation/deadline/disposal, unfinished calls and call ceilings. Real-loader tests exercise both factory orders and web-access without the Script tool. These fixtures do not qualify live services or browser installations.

## Configuration lifecycle

Config is cached by cwd in `index.ts` and loaded through the shared settings helper. API keys are optional:

- `tavilyApiKey` enables Tavily as the primary search provider.
- `jinaApiKey` enables Jina Search and raises Jina Reader limits.
- `exaApiKey` authenticates hosted Exa MCP search and fetch requests; Exa remains keyless when unset.
- `playwrightEnabled` controls the local browser fallback and defaults to `true`.

Missing keys do not disable the extension because Exa MCP provides keyless search/fetch and Jina Reader accepts anonymous fetches. Jina Search itself requires a key. Keys are sensitive and must stay masked in `/web-access-config` output and out of URLs, tool results, and logs.

## Search provider flow

`webSearch()` tries providers in a fixed order:

1. Tavily when configured.
2. Hosted Exa MCP, authenticated with `x-api-key` when configured and otherwise keyless.
3. Jina Search when configured.

Cancellation stops fallback immediately. Other provider errors are accumulated so a final tool-result error identifies each failed provider. The hosted Exa service has no contractual free quota, so failure must remain recoverable and must not disable later configured providers.

Search output is normalized to `SearchResponse` with provider name and result list. `formatResults()` is the canonical Markdown formatter used for agent-facing content. Existing bounded preview metadata remains available but is not shown collapsed.

## Fetch routing

`web_fetch` routes by URL before generic page extraction:

1. GitHub repository/blob/tree URLs go to `fetchGitHub()`.
2. URLs whose path ends in `.pdf` go to direct fetch plus `extractPdf()`.
3. Everything else goes to `webFetch()` for static, browser, and hosted extraction.

Generic and PDF routes pass through public-URL validation. Each route respects `max_chars`, clamped to the schema bounds. Route-specific metadata is returned in `details` so renderers can summarize clone/read state and PDF page counts without previewing arbitrary titles or page bodies.

## Generic web extraction

`fetch.ts` uses this ordered pipeline:

1. Fetch static HTML with a browser-like user agent, parse with `linkedom`, extract with Readability, and convert through Turndown.
2. When enabled, launch an ephemeral Playwright Chromium context, block image/media/font requests, validate every subrequest, and apply the same Readability/Turndown extraction to the rendered DOM.
3. Request Markdown from Jina Reader. When a configured key returns 401/402, retry once without authentication because anonymous Reader remains independently available.
4. Call Exa MCP `web_fetch_exa`, authenticated with `x-api-key` when configured and otherwise keyless.

Provider failures are accumulated, while cancellation stops the chain. Playwright load, browser-installation, or rendering failures are normal fallback conditions. Browser contexts never load user profiles, cookies, workspace files, or persistent state.

## GitHub handling

GitHub support is optimized for repository exploration by Pi's built-in file tools. Repository URLs are shallow-cloned under `/tmp/pi-github-repos/<owner>/<repo>` or a ref-specific directory. Existing clones with a `.git` directory are reused, and each GitHub fetch best-effort removes cached clone directories older than the retention window.

Important boundaries:

- Only `github.com` URLs are parsed.
- Repository size is checked through GitHub's public REST API; if unavailable, clone proceeds without the size precheck.
- Clone commands use argument arrays, not shell strings, and disable credential helpers and interactive prompts because this route supports public access only.
- Clone subprocesses run in an isolated process group so timeout or cancellation terminates Git transport descendants as well as the direct child.
- File trees skip common heavy/generated/binary directories and file extensions.
- Blob URLs return direct file contents plus the clone path.

GitHub rate-limit-looking errors are converted into recoverable tool-result messages with retry guidance.

## Network and external content safety

`url-safety.ts` accepts only public HTTP(S) URLs without credentials. It blocks literal and DNS-resolved loopback, private, link-local, metadata, multicast, documentation, benchmarking, and reserved addresses. Static/PDF fetches use manual redirects so every destination is revalidated. Playwright intercepts every subrequest and applies the same policy before continuing it.

These checks do not pin the validated address to the eventual socket and therefore do not fully eliminate DNS-rebinding or other time-of-check/time-of-use races. Playwright is a renderer, not a network sandbox; deployments with sensitive network access should also enforce egress restrictions outside the process.

All successful search/fetch content and remote provider/fetch error messages are wrapped with `BEGIN/END UNTRUSTED EXTERNAL ... CONTENT`. Preserve this envelope and escape delimiter-like lines from external payloads. Search snippets, fetched pages, repository files, PDFs, and remote error bodies can contain prompt injection; they must be framed as untrusted data for the agent.

Wrap before spillover so persisted files retain the trust boundary. When content spills, wrap the returned preview envelope again because its inner preview may be truncated before the persisted content's closing marker. Keep renderer-only previews bounded in `details` rather than copying the complete result.

Do not add behavior that treats fetched content as extension instructions, Pi settings, tool arguments, or command input without explicit validation.

## Temporary files and cleanup

GitHub clones are stored under `/tmp/pi-github-repos` and clone directories older than 7 days are deleted best-effort during GitHub fetches. The clone path is intentionally returned so the agent can inspect files with normal tools. These clones may contain arbitrary public repository contents and should not be treated as sanitized.

Wrapped result or remote-error output above the shared threshold is stored under `${tmpdir()}/pi-extension-spillover`; the directory must be a real current-user-owned directory and is restricted to mode `0700`, while files use mode `0600` and lazy seven-day cleanup. Spill files contain the full wrapped external content. Directory validation or persistence failures fall back to the wrapped inline result.

The extension writes no retained diagnostic logs.

## Boundaries and non-goals

- No authenticated GitHub integration; use MCP Gateway for authenticated GitHub work.
- No recursive crawl or multi-page research orchestration.
- No browser profiles, cookies, screenshots, interaction, downloads, or arbitrary page scripts supplied by the caller.
- No guarantee that hosted keyless providers remain free or available.
- No configurable retention policy for temporary GitHub clones.
- No exact content deduplication or cache invalidation policy.

## Change guidance

When adding providers or URL routes, keep routing explicit and update tests for fallback behavior. Preserve untrusted-content wrapping for every successful external content path, the frame-before-spill ordering, and bounded renderer details. If changing logs, temp files, authentication, cleanup, or browser execution, update README security/config/logging sections and keep secrets out of results.
