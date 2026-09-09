import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { requestGatewayAccess } from "../mcp-gateway/api.ts";
import { loadCodeConfig } from "./config.ts";
import { runCode } from "./runtime.ts";
import { PARAMETERS, presentRun, renderers } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  let lifetime = new AbortController();
  const running = new Set<Promise<unknown>>();
  pi.on("session_start", () => {
    lifetime = new AbortController();
  });
  pi.on("session_shutdown", async () => {
    lifetime.abort();
    await Promise.allSettled(running);
  });
  registerConfigCommand(pi, {
    extensionName: "code-mode",
    loadConfig: loadCodeConfig,
  });
  pi.on("tool_result", (event) => {
    if (
      event.toolName === "code" &&
      (event.details as { codeError?: boolean } | undefined)?.codeError
    )
      return { isError: true };
    return undefined;
  });
  pi.registerTool({
    name: "code",
    label: "Code",
    parameters: PARAMETERS,
    description:
      "Compose MCP calls in one fresh permissioned JavaScript child. Use mcp_search/mcp_describe first. mcp.call(name, args) returns raw redacted MCP results; parallel(thunks) bounds independent work. Explicitly return a JSON value (null for empty); only that value and bounded host failure metadata enter context. No imports, filesystem, network, process APIs, persistent state, grants, retries, or replay. Defaults: 32 calls, concurrency 4, 120 seconds; gateway per-call deadlines still apply. Returned text above 25,000 characters spills or reports overflow. Earlier writes can survive errors/cancellation; uncertain outcomes must not be retried automatically.",
    promptSnippet:
      "Run bounded isolated JavaScript composition over MCP Gateway calls",
    promptGuidelines: [
      "Use code for multi-call MCP pagination, dependent lookups, or aggregation when filtering intermediate payloads reduces context. Direct MCP tools remain available.",
      "Code gateway permissions never substitute for user approval. Obtain required authorization before code mutations; never automatically request grants, poll approvals, retry nested calls, or replay a failed program.",
    ],
    ...renderers,
    async execute(id, params, signal, onUpdate, ctx) {
      if (
        typeof params.description !== "string" ||
        !/[^\s\p{Cf}]/u.test(params.description)
      )
        throw new Error("code description must be nonblank.");
      const config = await loadCodeConfig(ctx.cwd);
      const gateway = requestGatewayAccess(pi);
      const combined = AbortSignal.any([
        lifetime.signal,
        ...(signal ? [signal] : []),
      ]);
      onUpdate?.({
        content: [{ type: "text", text: "Running bounded MCP composition." }],
        details: {},
      });
      const task = runCode(params.source, gateway, config, combined);
      running.add(task);
      try {
        return await presentRun(await task, id);
      } finally {
        running.delete(task);
      }
    },
  });
}
