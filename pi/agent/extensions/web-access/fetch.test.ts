import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { _playwright, webFetch } from "./fetch.ts";

const originalFetch = globalThis.fetch;
const targetUrl = "https://93.184.216.34/page";

function unreadableHtml(): Response {
  return new Response("<html><body>Loading...</body></html>", {
    headers: { "content-type": "text/html" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

test("webFetch retries Jina Reader anonymously when a configured key has no balance", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init });
    if (String(url) === targetUrl) return unreadableHtml();
    if ((init?.headers as Record<string, string>).Authorization) {
      return Response.json(
        { message: "insufficient balance" },
        { status: 402 },
      );
    }
    return new Response("Title: Reader result\n\nAnonymous reader content.");
  }) as typeof fetch;

  const result = await webFetch(
    targetUrl,
    1_000,
    new AbortController().signal,
    { jinaApiKey: "depleted-key", playwrightEnabled: false },
  );

  assert.equal(result.method, "jina");
  assert.match(result.text, /Anonymous reader content/);
  assert.equal(
    (calls[1]!.init!.headers as Record<string, string>).Authorization,
    "Bearer depleted-key",
  );
  assert.equal(
    (calls[2]!.init!.headers as Record<string, string>).Authorization,
    undefined,
  );
});

for (const exaApiKey of [undefined, "configured-exa"]) {
  test(`webFetch uses ${exaApiKey ? "authenticated" : "anonymous"} Exa MCP fallback`, async () => {
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(url) === targetUrl) return unreadableHtml();
      if (String(url).startsWith("https://r.jina.ai/")) {
        return new Response("unavailable", { status: 503 });
      }
      assert.equal(
        (init?.headers as Record<string, string>)["x-api-key"],
        exaApiKey,
      );
      const request = JSON.parse(String(init?.body));
      assert.equal(request.params.name, "web_fetch_exa");
      assert.deepEqual(request.params.arguments.urls, [targetUrl]);
      return new Response(
        `event: message\ndata: ${JSON.stringify({
          result: {
            content: [
              {
                type: "text",
                text: "# Exa result\nURL: https://93.184.216.34/page\n\nExa page content.",
              },
            ],
          },
          jsonrpc: "2.0",
          id: 1,
        })}\n\n`,
      );
    }) as typeof fetch;

    const result = await webFetch(
      targetUrl,
      1_000,
      new AbortController().signal,
      { exaApiKey, playwrightEnabled: false },
    );

    assert.equal(result.method, "exa");
    assert.match(result.text, /Exa page content/);
  });
}

test("webFetch uses Playwright for client-rendered pages before remote providers", async () => {
  let remoteFallbackCalled = false;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url) === targetUrl) return unreadableHtml();
    remoteFallbackCalled = true;
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  let browserClosed = false;
  mock.method(_playwright, "load", async () => ({
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                return {
                  async route(
                    _pattern: string,
                    handler: (route: any) => Promise<void>,
                  ) {
                    let continued = false;
                    let aborted = false;
                    await handler({
                      request: () => ({
                        url: () => "http://127.0.0.1/private",
                        resourceType: () => "script",
                      }),
                      async continue() {
                        continued = true;
                      },
                      async abort() {
                        aborted = true;
                      },
                    });
                    assert.equal(aborted, true);
                    assert.equal(continued, false);
                  },
                  async goto() {},
                  async waitForLoadState() {},
                  async content() {
                    return `<html><head><title>Rendered</title></head><body><article><p>${"Rendered content. ".repeat(20)}</p></article></body></html>`;
                  },
                };
              },
              async close() {},
            };
          },
          async close() {
            browserClosed = true;
          },
        };
      },
    },
  }));

  const result = await webFetch(
    targetUrl,
    1_000,
    new AbortController().signal,
    { playwrightEnabled: true },
  );

  assert.equal(result.method, "playwright");
  assert.match(result.text, /Rendered content/);
  assert.equal(remoteFallbackCalled, false);
  assert.equal(browserClosed, true);
});
