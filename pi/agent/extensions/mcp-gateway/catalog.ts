import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import type { GatewayTool } from "./client.ts";
import { display } from "./presentation.ts";

export const SEARCH_LIMIT = 50;
export function searchTools(
  query: string,
  tools: GatewayTool[],
): GatewayTool[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!tokens.length) return query.trim() ? [] : tools;
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const text =
        `${name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
      return {
        tool,
        score: tokens.reduce(
          (sum, token) =>
            sum + (name.includes(token) ? 3 : text.includes(token) ? 1 : 0),
          0,
        ),
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map((match) => match.tool);
}

export function buildGatewayPrompt(
  tools: GatewayTool[],
  readOnly: boolean,
): string {
  const namespaces = new Map<string, number>();
  for (const tool of tools) {
    const dot = tool.name.indexOf(".");
    const namespace = dot > 0 ? tool.name.slice(0, dot) : "(unqualified)";
    namespaces.set(namespace, (namespaces.get(namespace) ?? 0) + 1);
  }
  const entries = [...namespaces].sort(([a], [b]) => a.localeCompare(b));
  const summary = entries
    .slice(0, 24)
    .map(([name, count]) => `- ${display(name, 80)}: ${count} tools`)
    .join("\n");
  return [
    "MCP Gateway namespaces (advisory discovery summary, not authorization):",
    wrapUntrustedContent(
      "EXTERNAL MCP NAMESPACE SUMMARY",
      summary || "No tools discovered.",
    ),
    ...(entries.length > 24
      ? [`${entries.length - 24} additional namespaces omitted.`]
      : []),
    "Use mcp_search for tool discovery, mcp_describe for the exact input schema, and mcp_call to invoke. Search returns at most 50 matches; narrow the query for omitted matches.",
    "Prefer gateway tools over direct gh or remote-git commands for authenticated external access.",
    "Never automatically repeat a call after cancellation, timeout, or an unknown outcome; downstream effects may have occurred.",
    ...(readOnly
      ? [
          "Read-only mode: only tools explicitly annotated readOnlyHint=true are available; calls recheck discovery. Gateway grants still govern each call.",
        ]
      : []),
  ].join("\n");
}
