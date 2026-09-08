import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { GatewayClient } from "./client.ts";
import { loadGatewayConfig } from "./config.ts";
import { buildGatewayPrompt } from "./catalog.ts";
import { registerGuard } from "./guard.ts";
import { registerTools } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  registerConfigCommand(pi, {
    extensionName: "mcp-gateway",
    loadConfig: loadGatewayConfig,
    sensitiveFields: ["agentToken", "authToken"],
  });
  const client = new GatewayClient();
  let active = false;
  pi.on("session_start", async (_event, ctx) => {
    if (active) return;
    if (
      pi
        .getAllTools()
        .some((tool) =>
          ["mcp_search", "mcp_describe", "mcp_call"].includes(tool.name),
        )
    ) {
      if (ctx.hasUI)
        ctx.ui.notify(
          "MCP Gateway not enabled: conflicting MCP tools are loaded. Remove the duplicate MCP provider and restart Pi.",
          "error",
        );
      throw new Error(
        "MCP Gateway requires a session without other MCP meta-tools.",
      );
    }
    active = true;
    registerTools(pi, client);
    registerGuard(pi, client);
    client.configure(await loadGatewayConfig(ctx.cwd));
    try {
      await client.listTools();
    } catch {
      /* Discovery remains available through tools. */
    }
  });
  pi.on("session_shutdown", () => {
    client.close();
  });
  pi.on("before_agent_start", async (event, ctx) => {
    if (!active) return undefined;
    client.configure(await loadGatewayConfig(ctx.cwd));
    try {
      await client.listTools(ctx.signal);
    } catch {
      /* Never advertise a failed or partial traversal. */
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildGatewayPrompt(client.getCachedTools() ?? [], client.getReadOnly())}`,
    };
  });
}
