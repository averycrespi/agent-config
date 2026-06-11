/**
 * Web access extension for Pi — provides web_search and web_fetch tools.
 *
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
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
import { fetchGitHub, parseGitHubUrl } from "./github.ts";
import { extractPdf } from "./pdf.ts";
import { formatResults, webSearch } from "./search.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function isPdfUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return false;
  }
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
    "Search the web for current information. Returns titles, URLs, and relevant snippets. Use for finding documentation, recent news, answers to factual questions, or anything requiring up-to-date information.",
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
    if (context.isError) {
      return getTruncatedText(context.lastComponent, [
        theme.fg("error", firstLine(text) || "web_search error"),
      ]);
    }

    // Show first ~3 result titles as head snippet
    const details = result.details as { resultCount?: number } | undefined;
    const count = details?.resultCount ?? 0;
    if (count === 0) {
      return getTruncatedText(context.lastComponent, [
        theme.fg("muted", "No results found"),
      ]);
    }
    const head = headNonEmptyLines(text, 3);
    const displayLines = count > 3 ? [...head, `... +${count - 3} more`] : head;
    return getTruncatedText(
      context.lastComponent,
      displayLines.map((line) => theme.fg("muted", line)),
    );
  },

  async execute(
    _toolCallId: string,
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
      return {
        content: [{ type: "text" as const, text: formatResults(response) }],
        details: { resultCount: response.results.length },
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        details: {},
      };
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
    "Fetch and read the content of a webpage as clean markdown. Use for reading documentation, articles, GitHub READMEs, or any web page where you need the full content. For GitHub repository URLs, clones the repo and returns the README, file tree, and clone path for further exploration.",
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
    if (context.isError) {
      return getTruncatedText(context.lastComponent, [
        theme.fg("error", firstLine(text) || "web_fetch error"),
      ]);
    }

    const details = result.details as
      | {
          method?: string;
          clonePath?: string;
          pageCount?: number;
          title?: string;
        }
      | undefined;

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
    _toolCallId: string,
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
        return {
          content: [{ type: "text" as const, text: result.text }],
          details: { method: "github", clonePath: result.clonePath },
        };
      }

      // PDF URL → extract text
      if (isPdfUrl(params.url)) {
        const response = await fetch(params.url, {
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
        return {
          content: [{ type: "text" as const, text: `${header}${pdf.text}` }],
          details: { method: "pdf", pageCount: pdf.pageCount },
        };
      }

      // Regular URL → Readability + Jina fallback
      const result = await webFetch(params.url, maxChars, fetchSignal, config);
      return {
        content: [{ type: "text" as const, text: result.text }],
        details: { method: result.method, title: result.title },
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        details: {},
      };
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
    sensitiveFields: ["tavilyApiKey", "jinaApiKey"],
  });

  pi.on("session_start", async (_event, ctx) => {
    await ensureConfig(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await ensureConfig(ctx);
    return undefined;
  });
}
