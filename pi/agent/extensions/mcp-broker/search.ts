import type { BrokerTool } from "./client.ts";

export const COMMON_SEARCH_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "for",
  "to",
  "with",
  "from",
  "and",
  "or",
  "in",
  "of",
  "on",
  "at",
  "by",
]);

export type RankedToolMatch = {
  tool: BrokerTool;
  score: number;
};

export function tokenizeSearch(
  text: string,
  stopwords: ReadonlySet<string> = COMMON_SEARCH_STOPWORDS,
): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

export function rankToolMatches(
  query: string,
  tools: BrokerTool[],
  options?: { stopwords?: ReadonlySet<string>; namespace?: string },
): RankedToolMatch[] {
  const trimmed = query.trim().toLowerCase();
  const tokens = tokenizeSearch(trimmed, options?.stopwords);
  if (tokens.length === 0 && trimmed.length === 0) {
    return tools.map((tool) => ({ tool, score: 0 }));
  }
  if (tokens.length === 0) return [];

  const prefix = options?.namespace ? `${options.namespace}.` : undefined;
  return tools
    .map((tool, index) => {
      if (prefix && !tool.name.startsWith(prefix)) return undefined;
      const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      const tokenScore = tokens.reduce(
        (score, token) => (haystack.includes(token) ? score + 1 : score),
        0,
      );
      const substringBonus =
        trimmed.length > 0 && haystack.includes(trimmed)
          ? tokens.length + 2
          : 0;
      const score = tokenScore + substringBonus;
      return score > 0 ? { tool, score, index } : undefined;
    })
    .filter((match): match is RankedToolMatch & { index: number } =>
      Boolean(match),
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ tool, score }) => ({ tool, score }));
}
