import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { GatewayClient } from "./client.ts";
import { loadGatewayConfig } from "./config.ts";
import { buildGatewayPrompt } from "./catalog.ts";
import { registerGuard } from "./guard.ts";
import { registerTools } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  pi.registerFlag("mcp-gateway", {
    type: "boolean",
    default: false,
    description:
      "Enable MCP Gateway tools in an isolated session (exclude mcp-broker).",
  });
  registerConfigCommand(pi, {
    extensionName: "mcp-gateway",
    loadConfig: loadGatewayConfig,
    sensitiveFields: ["agentToken", "authToken"],
  });
  const client = new GatewayClient();
  let active = false;
  pi.on("session_start", async (_event, ctx) => {
    // CLI flags are populated after factories run; Stow may already expose this directory.
    if (pi.getFlag("mcp-gateway") !== true || active) return;
    if (
      pi
        .getAllTools()
        .some((tool) =>
          ["mcp_search", "mcp_describe", "mcp_call"].includes(tool.name),
        )
    ) {
      if (ctx.hasUI)
        ctx.ui.notify(
          "MCP Gateway not enabled: conflicting MCP tools are loaded. Use --no-extensions -e <gateway-path> --mcp-gateway.",
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
