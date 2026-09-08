import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GatewayClient } from "./client.ts";
import { searchTools } from "./catalog.ts";
import { display } from "./presentation.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";

const ASSIGNMENT = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*`;
const PREFIX = String.raw`^\s*${ASSIGNMENT}(?:command\s+|builtin\s+)?(?:env\s+${ASSIGNMENT})?(?:\S+/)?`;
const GIT_FLAGS = String.raw`(?:-[CcP](?:\s+\S+)?|--[a-z][a-z0-9-]*(?:=\S+)?)`;
const GH = new RegExp(`${PREFIX}gh(?=\\s|$)`);
const GIT = new RegExp(
  `${PREFIX}git(?:\\s+${GIT_FLAGS})*\\s+(push|pull|fetch|ls-remote|remote)\\b`,
);

export function matchCommand(
  command: string,
): { namespace: string; query: string } | undefined {
  for (const segment of command
    .replace(/'[^']*'|"[^"]*"/g, "")
    .split(/&&|\|\||;|\||\n/g)) {
    if (GH.test(segment)) return { namespace: "github", query: segment };
    if (GIT.test(segment)) return { namespace: "git", query: segment };
  }
  return undefined;
}

export function registerGuard(pi: ExtensionAPI, client: GatewayClient): void {
  const pending = new Map<
    string,
    NonNullable<ReturnType<typeof matchCommand>>
  >();
  let steered = false;
  pi.on("turn_start", () => {
    steered = false;
    pending.clear();
  });
  pi.on("session_shutdown", () => {
    pending.clear();
  });
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "bash" || typeof event.input.command !== "string")
      return undefined;
    const match = matchCommand(event.input.command);
    if (!match) return undefined;
    pending.set(event.toolCallId, match);
    if (ctx.hasUI)
      ctx.ui.notify(
        "Prefer MCP Gateway tools for authenticated gh/remote-git work; bash is not blocked.",
        "info",
      );
    return undefined;
  });
  pi.on("tool_result", (event) => {
    const match = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (!match || steered) return undefined;
    steered = true;
    const tools = (client.getCachedTools() ?? []).filter((tool) =>
      tool.name.startsWith(`${match.namespace}.`),
    );
    const names = searchTools(match.query, tools)
      .slice(0, 3)
      .map((tool) => display(tool.name, 512));
    pi.sendMessage(
      {
        customType: "gateway-guard",
        display: false,
        content: [
          "Prefer MCP Gateway tools for authenticated external operations. Use mcp_search to find a tool and mcp_describe for its schema, then mcp_call.",
          ...(names.length
            ? [
                wrapUntrustedContent(
                  "EXTERNAL MCP TOOL CANDIDATES",
                  names.join("\n"),
                ),
              ]
            : []),
        ].join("\n"),
      },
      { deliverAs: "steer" },
    );
    return undefined;
  });
}
