import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { describeScriptProviders, executeScript, MAX_LIMITS } from "./api.ts";
import { loadScriptConfig } from "./config.ts";
import {
  PARAMETERS,
  presentRun,
  presentDiscovery,
  discoveryFailure,
  renderers,
} from "./tool.ts";

export default function (pi: ExtensionAPI) {
  let lifetime = new AbortController();
  const running = new Set<Promise<unknown>>();
  const stop = async () => {
    lifetime.abort();
    await Promise.allSettled(running);
  };
  pi.on("session_start", () => {
    lifetime = new AbortController();
  });
  pi.on("session_shutdown", stop);
  pi.on("session_tree", async () => {
    await stop();
    lifetime = new AbortController();
  });
  registerConfigCommand(pi, {
    extensionName: "script",
    loadConfig: loadScriptConfig,
  });
  pi.on("tool_result", (event) => {
    if (
      event.toolName === "script" &&
      (event.details as { scriptError?: boolean } | undefined)?.scriptError
    )
      return { isError: true };
    return undefined;
  });
  pi.registerTool({
    name: "script",
    label: "Script",
    parameters: PARAMETERS,
    ...renderers,
    description:
      "Describe selected provider APIs or execute one fresh bounded JavaScript child using explicitly selected host-permitted providers. [] runs pure JSON computation without providers. Describe [] lists permitted registered APIs. Use namespaced methods with the documented positional argument schemas and parallel(thunks). Explicitly return JSON (null for empty) and await all calls. No ambient filesystem/network/process/imports or credentials. Defaults: 32 calls, concurrency 4, 120s; returned JSON limited to 24000 bytes. Host failures and unknown effects survive guest catches. No automatic retries, grants, replay or background jobs.",
    promptSnippet:
      "Run isolated JavaScript with explicitly selected extension capabilities",
    promptGuidelines: [
      "Prefer direct mcp_call for straightforward gateway calls. Use script with the selected mcp provider when bounded pagination, dependent lookups, or aggregation materially reduces intermediate context. Discover external names with mcp_search and inspect schemas with mcp_describe before calling mcp.call; reuse inspected schemas unless evidence indicates a change. Check each raw MCP envelope's isError and actual content shape, and await every call. Script is not subagent reasoning or persistent polling.",
      "Discover script provider APIs with action describe before using unfamiliar methods. Provider permission is not user approval: obtain action authorization before mutations; never automatically replay failed or uncertain script execution.",
    ],
    async execute(_id, params, signal, onUpdate, ctx) {
      if (
        typeof params.description !== "string" ||
        params.description.length > 200 ||
        !/[^\s\p{Cf}]/u.test(params.description)
      )
        throw new Error("script description must be nonblank and bounded");
      const session = {
        id: ctx.sessionManager.getSessionId(),
        file: ctx.sessionManager.getSessionFile(),
        provider: ctx.model?.provider,
        model: ctx.model?.id,
        reasoningLevel: ctx.thinkingLevel,
      };
      const cwd = ctx.cwd;
      const combined = AbortSignal.any([
        lifetime.signal,
        ...(signal ? [signal] : []),
      ]);
      const task = (async () => {
        if (params.action === "describe") {
          try {
            return presentDiscovery(
              await describeScriptProviders(
                pi,
                cwd,
                params.providers,
                undefined,
                combined,
              ),
            );
          } catch (error) {
            return discoveryFailure(error, combined.aborted);
          }
        }
        if (params.action !== "run") throw new Error("invalid script action");
        onUpdate?.({
          content: [{ type: "text", text: "Running bounded script." }],
          details: {},
        });
        return presentRun(
          await executeScript(pi, cwd, {
            session,
            source: params.source!,
            providers: params.providers,
            limits: MAX_LIMITS,
            signal: combined,
            deadlineMs: Date.now() + MAX_LIMITS.timeoutMs,
          }),
        );
      })();
      running.add(task);
      try {
        return await task;
      } finally {
        running.delete(task);
      }
    },
  });
}
