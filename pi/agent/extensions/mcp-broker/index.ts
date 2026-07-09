/**
 * MCP Broker extension for Pi.
 *
 * Registers three meta-tools (mcp_search, mcp_describe, mcp_call) that
 * talk directly to the broker over MCP Streamable HTTP, plus the bash
 * guard that nudges the agent away from native gh/git in favor of
 * mcp_call. Also injects a per-namespace tool menu plus decision rules
 * into the system prompt at agent start so the agent can pick a tool
 * directly without an mcp_search round-trip.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { BrokerClient, type BrokerTool } from "./client.ts";
import { loadMcpBrokerConfig } from "./config.ts";
import initGuard from "./guard.ts";
import { registerTools } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  const client = new BrokerClient();
  let configuredCwd: string | undefined;

  async function ensureConfig(ctx: ExtensionContext): Promise<void> {
    if (configuredCwd === ctx.cwd) return;
    client.configure(await loadMcpBrokerConfig(ctx.cwd));
    configuredCwd = ctx.cwd;
  }

  registerTools(pi, client, ensureConfig);
  initGuard(pi, client);
  registerConfigCommand(pi, {
    extensionName: "mcp-broker",
    loadConfig: loadMcpBrokerConfig,
    sensitiveFields: ["authToken"],
  });

  // Pre-fetch the tool list on session start so the broker prompt menu
  // is ready by the time before_agent_start fires. Silently skip on
  // failure — the meta-tools still work, and the prompt is a nice-to-have.
  pi.on("session_start", async (_event, ctx) => {
    try {
      await ensureConfig(ctx);
      await client.listTools();
    } catch {
      // Broker unreachable or env unset. mcp_search will surface the real
      // error on the first agent call.
    }
  });

  pi.on("session_shutdown", async () => {
    await client.close();
  });

  // Inject the broker tool menu and decision rules into the system
  // prompt. Cache-safe: the tools array stays static, and the system
  // prompt is stable within a session.
  pi.on("before_agent_start", async (event, ctx) => {
    await ensureConfig(ctx);
    const tools = client.getCachedTools();
    if (!tools || tools.length === 0) {
      return undefined;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildBrokerPrompt(tools, client.getReadOnly())}`,
    };
  });
}

export function buildBrokerPrompt(
  tools: BrokerTool[],
  readOnly: boolean = false,
): string {
  const byNamespace = groupByNamespace(tools);
  const menu = Array.from(byNamespace.entries())
    .map(([ns, names]) => `- ${ns}: ${names.join(", ")}`)
    .join("\n");
  const base = [
    'MCP broker tools (call via mcp_call name="<namespace>.<tool>"):',
    wrapUntrustedContent("EXTERNAL MCP TOOL CATALOG", menu),
    "",
    "Use mcp_describe for parameter schemas. Use mcp_search to discover tools by keyword.",
    "For remote git operations (push/pull/fetch/ls-remote/remote) and GitHub work, prefer these broker tools over bash gh/git — bash invocations of gh or remote git typically aren't authenticated in this environment.",
  ].join("\n");
  if (readOnly) {
    return (
      base +
      "\n\nRead-only mode: only listed tools are callable. Write tools (create/edit/merge/push/etc.) are not available."
    );
  }
  return base;
}

function groupByNamespace(tools: BrokerTool[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tool of tools) {
    const dot = tool.name.indexOf(".");
    if (dot <= 0) continue;
    const ns = tool.name.slice(0, dot);
    const name = tool.name.slice(dot + 1);
    const list = map.get(ns);
    if (list) list.push(name);
    else map.set(ns, [name]);
  }
  for (const list of map.values()) list.sort();
  return new Map(
    Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)),
  );
}
