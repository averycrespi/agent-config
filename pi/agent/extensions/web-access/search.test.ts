import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { formatResults, webSearch, type SearchResponse } from "./search.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("formatResults returns 'No results found.' for empty response", () => {
  const response: SearchResponse = { results: [], provider: "tavily" };
  assert.equal(formatResults(response), "No results found.");
});

test("formatResults numbers results starting from 1", () => {
  const response: SearchResponse = {
    provider: "tavily",
    results: [
      { title: "First", url: "https://a.example", snippet: "one" },
      { title: "Second", url: "https://b.example", snippet: "two" },
    ],
  };
  const out = formatResults(response);
  assert.match(out, /^1\. \*\*First\*\*/);
  assert.match(out, /\n\n2\. \*\*Second\*\*/);
});

test("formatResults includes date when present", () => {
  const response: SearchResponse = {
    provider: "tavily",
    results: [
      {
        title: "Dated",
        url: "https://a.example",
        snippet: "s",
        date: "2026-01-02",
      },
    ],
  };
  assert.equal(
    formatResults(response),
    "1. **Dated** · 2026-01-02\n   https://a.example\n   s",
  );
});

test("formatResults omits date separator when date is missing", () => {
  const response: SearchResponse = {
    provider: "tavily",
    results: [{ title: "NoDate", url: "https://a.example", snippet: "s" }],
  };
  assert.equal(
    formatResults(response),
    "1. **NoDate**\n   https://a.example\n   s",
  );
});

test("formatResults separates entries with a blank line", () => {
  const response: SearchResponse = {
    provider: "jina",
    results: [
      { title: "A", url: "https://a.example", snippet: "sa" },
      { title: "B", url: "https://b.example", snippet: "sb" },
    ],
  };
  const sections = formatResults(response).split("\n\n");
  assert.equal(sections.length, 2);
  assert.match(sections[0], /^1\. \*\*A\*\*/);
  assert.match(sections[1], /^2\. \*\*B\*\*/);
});

test("webSearch falls back from Tavily to keyless Exa MCP", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("tavily")) {
      return new Response("fail", { status: 500 });
    }
    return new Response(
      `event: message\ndata: ${JSON.stringify({
        result: {
          content: [
            {
              type: "text",
              text: [
                "Title: Exa result",
                "URL: https://example.com/exa",
                "Published: 2026-07-20",
                "Highlights:",
                "Relevant Exa snippet.",
              ].join("\n"),
            },
          ],
        },
        jsonrpc: "2.0",
        id: 1,
      })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;

  const response = await webSearch("query", 1, new AbortController().signal, {
    tavilyApiKey: "configured-tavily",
  });

  assert.equal(response.provider, "exa");
  assert.deepEqual(response.results, [
    {
      title: "Exa result",
      url: "https://example.com/exa",
      date: "2026-07-20",
      snippet: "Relevant Exa snippet.",
    },
  ]);
  assert.equal(
    JSON.parse(String(calls[0]!.init!.body)).api_key,
    "configured-tavily",
  );
  const exaRequest = JSON.parse(String(calls[1]!.init!.body));
  assert.equal(exaRequest.params.name, "web_search_exa");
  assert.equal(exaRequest.params.arguments.numResults, 1);
});

test("webSearch falls back from Exa MCP to configured Jina Search", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("tavily") || String(url).includes("mcp.exa.ai")) {
      return new Response("fail", { status: 500 });
    }
    return Response.json({
      data: [{ title: "Jina", url: "https://example.com", description: "hit" }],
    });
  }) as typeof fetch;

  const response = await webSearch("query", 1, new AbortController().signal, {
    tavilyApiKey: "configured-tavily",
    jinaApiKey: "configured-jina",
  });

  assert.equal(response.provider, "jina");
  assert.equal(
    (calls[2]!.init!.headers as Record<string, string>).Authorization,
    "Bearer configured-jina",
  );
});
