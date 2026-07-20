/**
 * Web content fetching — local extraction with browser and hosted fallbacks.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchExa } from "./exa.ts";
import { assertSafeHttpUrl, safeFetch } from "./url-safety.ts";

type FetchConfig = {
  jinaApiKey?: string;
  playwrightEnabled?: boolean;
};

const MIN_READABLE_LENGTH = 200;
const PLAYWRIGHT_NAVIGATION_TIMEOUT_MS = 10_000;
const PLAYWRIGHT_NETWORK_IDLE_TIMEOUT_MS = 2_500;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

turndown.remove(["img", "iframe", "video", "audio", "canvas"]);
turndown.remove((node) => node.nodeName === "SVG");

export interface FetchResponse {
  text: string;
  title?: string;
  method: "readability" | "playwright" | "jina" | "exa";
}

export const _playwright: {
  load: () => Promise<typeof import("playwright-core")>;
} = {
  load: () => import("playwright-core"),
};

function truncateContent(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Content truncated — ${text.length.toLocaleString()} total characters. Use max_chars to read more.]`;
}

function extractReadable(
  html: string,
  maxChars: number,
  method: "readability" | "playwright",
): FetchResponse | null {
  const { document } = parseHTML(html);
  const article = new Readability(document as any).parse();
  if (!article?.content || article.textContent.length < MIN_READABLE_LENGTH) {
    return null;
  }

  return {
    text: truncateContent(turndown.turndown(article.content), maxChars),
    title: article.title || undefined,
    method,
  };
}

async function fetchWithReadability(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<FetchResponse | null> {
  const response = await safeFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PiAgent/1.0; +https://github.com/badlogic/pi-mono)",
      Accept: "text/html,application/xhtml+xml,*/*",
    },
    signal,
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
    return null;
  }
  return extractReadable(await response.text(), maxChars, "readability");
}

async function fetchWithPlaywright(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<FetchResponse | null> {
  const { chromium } = await _playwright.load();
  signal.throwIfAborted();
  const browser = await chromium.launch({ headless: true });
  const closeOnAbort = () => void browser.close().catch(() => undefined);
  signal.addEventListener("abort", closeOnAbort, { once: true });

  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (["image", "media", "font"].includes(request.resourceType())) {
          await route.abort("blockedbyclient");
          return;
        }
        try {
          await assertSafeHttpUrl(request.url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
      });
      await page
        .waitForLoadState("networkidle", {
          timeout: PLAYWRIGHT_NETWORK_IDLE_TIMEOUT_MS,
        })
        .catch(() => undefined);
      return extractReadable(await page.content(), maxChars, "playwright");
    } finally {
      await context.close();
    }
  } finally {
    signal.removeEventListener("abort", closeOnAbort);
    await browser.close();
  }
}

async function requestJina(
  url: string,
  signal: AbortSignal,
  apiKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    "X-Remove-Selector": "nav, header, footer, aside, .sidebar, .ads",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return fetch(`https://r.jina.ai/${url}`, { headers, signal });
}

async function fetchWithJina(
  url: string,
  maxChars: number,
  signal: AbortSignal,
  apiKey?: string,
): Promise<FetchResponse> {
  let response = await requestJina(url, signal, apiKey);
  if (apiKey && (response.status === 401 || response.status === 402)) {
    await response.body?.cancel();
    response = await requestJina(url, signal);
  }
  if (!response.ok) {
    throw new Error(`Jina Reader HTTP ${response.status}`);
  }

  let text = (await response.text()).trim();
  const title = text.match(/^Title: (.+)$/m)?.[1]?.trim();
  text = text.replace(/^(URL Source|URL|Title|Description): .+\n/gm, "").trim();
  return { text: truncateContent(text, maxChars), title, method: "jina" };
}

export async function webFetch(
  url: string,
  maxChars: number,
  signal: AbortSignal,
  config: FetchConfig = {},
): Promise<FetchResponse> {
  const safeUrl = (await assertSafeHttpUrl(url)).href;
  const errors: string[] = [];

  try {
    const result = await fetchWithReadability(safeUrl, maxChars, signal);
    if (result) return result;
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Readability: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (config.playwrightEnabled !== false) {
    try {
      const result = await fetchWithPlaywright(safeUrl, maxChars, signal);
      if (result) return result;
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        `Playwright: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    return await fetchWithJina(safeUrl, maxChars, signal, config.jinaApiKey);
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Jina: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return {
      text: await fetchExa(safeUrl, maxChars, signal),
      method: "exa",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Exa: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  throw new Error(`Web fetch providers failed: ${errors.join("; ")}`);
}
