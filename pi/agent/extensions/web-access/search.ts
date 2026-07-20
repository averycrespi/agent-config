/**
 * Web search providers — Tavily, keyless Exa MCP, then configured Jina Search.
 */

import { searchExa } from "./exa.ts";

export interface SearchResult {
  title: string;
  url: string;
  date?: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  provider: string;
}

type SearchConfig = {
  tavilyApiKey?: string;
  jinaApiKey?: string;
};

async function searchTavily(
  query: string,
  numResults: number,
  signal: AbortSignal,
  apiKey: string,
): Promise<SearchResponse> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: numResults,
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Tavily HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();
  if (!data.results?.length) return { results: [], provider: "tavily" };

  return {
    results: data.results.map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      date: r.published_date,
      snippet: r.content?.trim() ?? "",
    })),
    provider: "tavily",
  };
}

async function searchJina(
  query: string,
  numResults: number,
  signal: AbortSignal,
  apiKey?: string,
): Promise<SearchResponse> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Retain-Images": "none",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers, signal });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Jina Search HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();
  const items: any[] = data.data ?? [];

  return {
    results: items.slice(0, numResults).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description?.trim() ?? r.content?.trim()?.slice(0, 300) ?? "",
    })),
    provider: "jina",
  };
}

/** Search the web through the first available provider. */
export async function webSearch(
  query: string,
  numResults: number,
  signal: AbortSignal,
  config: SearchConfig = {},
): Promise<SearchResponse> {
  const errors: string[] = [];

  if (config.tavilyApiKey) {
    try {
      return await searchTavily(query, numResults, signal, config.tavilyApiKey);
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        `Tavily: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    return await searchExa(query, numResults, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Exa: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (config.jinaApiKey) {
    try {
      return await searchJina(query, numResults, signal, config.jinaApiKey);
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        `Jina: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(`Web search providers failed: ${errors.join("; ")}`);
}

/** Format search results as markdown for the model. */
export function formatResults(response: SearchResponse): string {
  if (response.results.length === 0) return "No results found.";
  return response.results
    .map((r, i) => {
      const date = r.date ? ` · ${r.date}` : "";
      return `${i + 1}. **${r.title}**${date}\n   ${r.url}\n   ${r.snippet}`;
    })
    .join("\n\n");
}
