import type { SearchResponse, SearchResult } from "./search.ts";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

type McpResponse = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
};

async function callExaMcp(
  toolName: "web_search_exa" | "web_fetch_exa",
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Exa MCP HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const body = await response.text();
  const payloads = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (payloads.length === 0) payloads.push(body.trim());

  let parsed: McpResponse | undefined;
  for (const payload of payloads) {
    try {
      const candidate = JSON.parse(payload) as McpResponse;
      if (candidate.result || candidate.error) {
        parsed = candidate;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!parsed) throw new Error("Exa MCP returned an invalid response");
  if (parsed.error) {
    throw new Error(
      `Exa MCP error${parsed.error.code == null ? "" : ` ${parsed.error.code}`}: ${parsed.error.message ?? "Unknown error"}`,
    );
  }

  const text = parsed.result?.content?.find(
    (item) => item.type === "text" && item.text?.trim(),
  )?.text;
  if (parsed.result?.isError || !text) {
    throw new Error(text?.trim() || "Exa MCP returned empty content");
  }
  return text.trim();
}

function field(block: string, name: string): string | undefined {
  return block.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim();
}

function parseSearchResults(text: string): SearchResult[] {
  return text
    .split(/(?=^Title: )/m)
    .map((block) => {
      const title = field(block, "Title") ?? "";
      const url = field(block, "URL") ?? "";
      const published = field(block, "Published");
      const contentStart = block.match(/\n(?:Highlights|Text):\s*\n/)?.index;
      const marker = block.match(/\n(?:Highlights|Text):\s*\n/)?.[0];
      const snippet =
        contentStart == null || !marker
          ? ""
          : block
              .slice(contentStart + marker.length)
              .replace(/\n---\s*$/, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 1_000);
      return {
        title,
        url,
        ...(published && published !== "N/A" ? { date: published } : {}),
        snippet,
      };
    })
    .filter((result) => result.url.startsWith("http"));
}

export async function searchExa(
  query: string,
  numResults: number,
  signal: AbortSignal,
): Promise<SearchResponse> {
  const text = await callExaMcp(
    "web_search_exa",
    {
      query,
      numResults,
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: 3_000,
    },
    signal,
  );
  const results = parseSearchResults(text).slice(0, numResults);
  if (results.length === 0)
    throw new Error("Exa MCP returned no search results");
  return { provider: "exa", results };
}

export async function fetchExa(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<string> {
  const text = await callExaMcp("web_fetch_exa", { urls: [url] }, signal);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Content truncated — ${text.length.toLocaleString()} total characters. Use max_chars to read more.]`;
}
