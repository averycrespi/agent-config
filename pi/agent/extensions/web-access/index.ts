/**
 * Web access extension for Pi — provides web_search and web_fetch tools.
 *
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import {
  wrapUntrustedContent,
  wrapUntrustedTextBlocks,
} from "../_shared/untrusted.ts";
import { type Static, Type } from "@sinclair/typebox";
import {
  clearPartialTimer,
  firstLine,
  getResultText,
  getTruncatedText,
  headNonEmptyLines,
  partialElapsed,
  plural,
} from "../_shared/render.ts";
import { loadWebAccessConfig, type WebAccessConfig } from "./config.ts";
import { webFetch } from "./fetch.ts";
import {
  fetchGitHub,
  isGitHubRateLimitError,
  parseGitHubUrl,
} from "./github.ts";
import { extractPdf } from "./pdf.ts";
import { formatResults, webSearch } from "./search.ts";
import { safeFetch } from "./url-safety.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function isPdfUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return false;
  }
}

async function externalResult(
  kind: string,
  text: string,
  toolCallId: string,
  details: Record<string, unknown>,
) {
  const content = [
    {
      type: "text" as const,
      text: wrapUntrustedContent(`EXTERNAL ${kind}`, text),
    },
  ];
  const spill = await spillIfNeeded(content, toolCallId);
  return {
    content: spill.spilled
      ? wrapUntrustedTextBlocks(`EXTERNAL ${kind}`, spill.content)
      : spill.content,
    details: {
      ...details,
      ...(spill.spilled
        ? {
            spilled: true,
            spillFilePath: spill.filePath,
            originalSize: spill.originalSize,
          }
        : {}),
    },
  };
}

function githubRateLimitMessage(url: string): string {
  return [
    `GitHub rate limit encountered while fetching ${url}.`,
    "This is recoverable: wait for the rate-limit window to reset, retry later, or configure authenticated GitHub access outside web-access.",
  ].join(" ");
}

let config: WebAccessConfig = {};
let configuredCwd: string | undefined;

async function ensureConfig(ctx: ExtensionContext): Promise<void> {
  if (configuredCwd === ctx.cwd) return;
  config = await loadWebAccessConfig(ctx.cwd);
  configuredCwd = ctx.cwd;
}

// ── web_search ───────────────────────────────────────────────────────

const searchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  num_results: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 10,
      description: "Number of results to return (1–10, default 5)",
    }),
  ),
});

const searchTool = {
  name: "web_search",
  label: "Web Search",
  description:
    "Search the web for current information. Returns titles, URLs, and relevant snippets as untrusted external content; oversized results are saved to a temporary file. Use for documentation, recent news, factual questions, or anything requiring up-to-date information.",
  parameters: searchParams,

  renderCall(args: Static<typeof searchParams>, theme: any, context: any) {
    const query = args?.query ?? "";
    const count =
      args?.num_results != null
        ? ` ${theme.fg("dim", `(${args.num_results})`)}`
        : "";
    return getTruncatedText(context.lastComponent, [
      `${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", query)}${count}`,
    ]);
  },

  renderResult(result: any, { isPartial }: any, theme: any, context: any) {
    if (isPartial) {
      const q = context.args?.query ?? "web";
      return getTruncatedText(context.lastComponent, [
        theme.fg("warning", `Searching ${q}...${partialElapsed(context)}`),
      ]);
    }
    clearPartialTimer(context);

    const text = getResultText(result);
    const details = result.details as
      | { resultCount?: number; previewText?: string; errorPreview?: string }
      | undefined;
    if (context.isError || details?.errorPreview) {
      return getTruncatedText(context.lastComponent, [
        theme.fg(
          "error",
          details?.errorPreview || firstLine(text) || "web_search error",
        ),
      ]);
    }

    // Show first ~3 result titles as head snippet
    const count = details?.resultCount ?? 0;
    if (count === 0) {
      return getTruncatedText(context.lastComponent, [
        theme.fg("muted", "No results found"),
      ]);
    }
    const head = headNonEmptyLines(details?.previewText ?? text, 3);
    const displayLines = count > 3 ? [...head, `... +${count - 3} more`] : head;
    return getTruncatedText(
      context.lastComponent,
      displayLines.map((line) => theme.fg("muted", line)),
    );
  },

  async execute(
    toolCallId: string,
    params: Static<typeof searchParams>,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ) {
    const numResults = Math.max(1, Math.min(params.num_results ?? 5, 10));

    try {
      await ensureConfig(ctx);
      const response = await webSearch(
        params.query,
        numResults,
        signal ?? AbortSignal.timeout(15_000),
        config,
      );
      const formattedResults = formatResults(response);
      return await externalResult("SEARCH", formattedResults, toolCallId, {
        resultCount: response.results.length,
        previewText: headNonEmptyLines(formattedResults, 3)
          .map((line) => line.slice(0, 500))
          .join("\n"),
      });
    } catch (error: unknown) {
      const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
      return await externalResult("SEARCH ERROR", message, toolCallId, {
        errorPreview: firstLine(message).slice(0, 500),
      });
    }
  },
};

// ── web_fetch ────────────────────────────────────────────────────────

const fetchParams = Type.Object({
  url: Type.String({ description: "Full URL to fetch (include https://)" }),
  max_chars: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 32_000,
      description: "Maximum characters to return (default 8000, max 32000)",
    }),
  ),
});

const fetchTool = {
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch and read web content as clean markdown wrapped as untrusted external data; oversized results are saved to a temporary file. For GitHub repository URLs, clones the repo and returns the README, file tree, and clone path for further exploration.",
  parameters: fetchParams,

  renderCall(args: Static<typeof fetchParams>, theme: any, context: any) {
    const url = args?.url ?? "";
    const chars =
      args?.max_chars != null
        ? ` ${theme.fg("dim", `(${args.max_chars})`)}`
        : "";
    return getTruncatedText(context.lastComponent, [
      `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", url)}${chars}`,
    ]);
  },

  renderResult(result: any, { isPartial }: any, theme: any, context: any) {
    if (isPartial) {
      const url = context.args?.url ?? "page";
      return getTruncatedText(context.lastComponent, [
        theme.fg("warning", `Fetching ${url}...${partialElapsed(context)}`),
      ]);
    }
    clearPartialTimer(context);

    const text = getResultText(result);
    const details = result.details as
      | {
          method?: string;
          clonePath?: string;
          pageCount?: number;
          title?: string;
          errorPreview?: string;
        }
      | undefined;
    if (context.isError || details?.errorPreview) {
      return getTruncatedText(context.lastComponent, [
        theme.fg(
          "error",
          details?.errorPreview || firstLine(text) || "web_fetch error",
        ),
      ]);
    }

    // GitHub clone: show clone path
    if (details?.clonePath) {
      return getTruncatedText(context.lastComponent, [
        theme.fg("muted", `Cloned to ${details.clonePath}`),
      ]);
    }

    // PDF: show page count
    if (details?.pageCount) {
      return getTruncatedText(context.lastComponent, [
        theme.fg("muted", plural(details.pageCount, "page")),
      ]);
    }

    // Regular fetch: show page title, falling back to first content line
    const title = details?.title;
    const preview = title || firstLine(text);
    return getTruncatedText(context.lastComponent, [
      theme.fg(
        "muted",
        preview ? preview : `${text.length.toLocaleString()} chars`,
      ),
    ]);
  },

  async execute(
    toolCallId: string,
    params: Static<typeof fetchParams>,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ) {
    const maxChars = Math.max(1, Math.min(params.max_chars ?? 8_000, 32_000));
    const fetchSignal = signal ?? AbortSignal.timeout(20_000);

    try {
      await ensureConfig(ctx);
      // GitHub URL → clone
      const gh = parseGitHubUrl(params.url);
      if (gh) {
        const result = await fetchGitHub(gh, maxChars, fetchSignal);
        return await externalResult("GITHUB", result.text, toolCallId, {
          method: "github",
          clonePath: result.clonePath,
        });
      }

      // PDF URL → extract text
      if (isPdfUrl(params.url)) {
        const response = await safeFetch(params.url, {
          signal: fetchSignal,
          headers: { Accept: "application/pdf" },
        });
        if (!response.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Fetch failed (HTTP ${response.status}): ${params.url}`,
              },
            ],
            details: {},
          };
        }
        const buffer = await response.arrayBuffer();
        const pdf = await extractPdf(buffer, maxChars);
        const header = pdf.title ? `# ${pdf.title}\n\n` : "";
        return await externalResult("PDF", `${header}${pdf.text}`, toolCallId, {
          method: "pdf",
          pageCount: pdf.pageCount,
        });
      }

      // Regular URL → Readability + Jina fallback
      const result = await webFetch(params.url, maxChars, fetchSignal, config);
      return await externalResult("WEB", result.text, toolCallId, {
        method: result.method,
        title: result.title,
      });
    } catch (error: unknown) {
      const message = isGitHubRateLimitError(error)
        ? githubRateLimitMessage(params.url)
        : `Error: ${error instanceof Error ? error.message : String(error)}`;
      return await externalResult("FETCH ERROR", message, toolCallId, {
        errorPreview: firstLine(message).slice(0, 500),
      });
    }
  },
};

// ── Extension registration ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(searchTool as any);
  pi.registerTool(fetchTool as any);
  registerConfigCommand(pi, {
    extensionName: "web-access",
    loadConfig: loadWebAccessConfig,
    sensitiveFields: ["tavilyApiKey", "jinaApiKey", "exaApiKey"],
  });

  pi.on("session_start", async (_event, ctx) => {
    await ensureConfig(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await ensureConfig(ctx);
    return undefined;
  });
}
