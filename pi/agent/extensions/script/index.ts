import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import {
  describeScriptProviders,
  executeScript,
  prepareScript,
  MAX_LIMITS,
} from "./api.ts";
import { getBackgroundService, type Execution } from "../background/api.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
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
      "Describe selected provider APIs or execute one fresh bounded JavaScript child using explicitly selected host-permitted providers. [] runs pure JSON computation without providers. Describe [] lists permitted registered APIs. Use namespaced methods with the documented positional argument schemas and parallel(thunks). Explicitly return JSON (null for empty) and await all calls. No ambient filesystem/network/process/imports or credentials. Defaults: 32 calls, concurrency 4, 120s; returned JSON limited to 24000 bytes. Host failures and unknown effects survive guest catches. Foreground default. execution:background returns a persisted ID and automatic outcome notification; requires Background service. list/inspect/cancel/dismiss control Script executions (id required except list). No automatic retries, grants or replay.",
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
      const backgroundResult = (records: Execution[]) => ({
        content: [
          {
            type: "text" as const,
            text: wrapUntrustedContent(
              "SCRIPT BACKGROUND",
              JSON.stringify(records),
            ),
          },
        ],
        details: {
          background: true,
          action: params.action,
          records: records.map(({ result: _result, ...r }) => r),
        },
      });
      if (["list", "inspect", "cancel", "dismiss"].includes(params.action)) {
        if (
          params.source !== undefined ||
          params.execution !== undefined ||
          params.providers !== undefined
        )
          throw new Error("Unexpected fields for background control");
        const service = getBackgroundService(pi);
        if (params.action === "list") {
          if (params.id !== undefined)
            throw new Error("Unexpected id for list");
          return backgroundResult(
            service.list("script").map(({ result: _result, ...r }) => r),
          );
        }
        if (!params.id) throw new Error("Execution id required");
        return backgroundResult([
          params.action === "inspect"
            ? service.inspect("script", params.id)
            : params.action === "cancel"
              ? service.cancel("script", params.id)
              : service.dismiss("script", params.id),
        ]);
      }
      if (
        params.id !== undefined ||
        !params.providers ||
        (params.action === "describe" &&
          (params.execution !== undefined || params.source !== undefined))
      )
        throw new Error("Invalid Script action fields");
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
      if (params.action === "run" && params.execution === "background") {
        const service = getBackgroundService(pi);
        // Pin the original policy, provider records, context and deadline before admission.
        // Tool-turn cancellation gates admission; admitted work has its own session lifetime.
        const prepared = await prepareScript(pi, cwd, {
          session,
          source: params.source!,
          providers: params.providers,
          limits: MAX_LIMITS,
          signal: lifetime.signal,
          deadlineMs: Date.now() + MAX_LIMITS.timeoutMs,
        });
        combined.throwIfAborted();
        return backgroundResult([
          service.admit({
            owner: "script",
            label: params.description,
            deadlineMs: prepared.deadlineMs,
            run: async (signal) => {
              const run = await prepared.run(signal);
              return {
                status: run.status,
                effectsMayPersist: run.effectsMayPersist,
                outcomeUnknown: run.outcomeUnknown,
                result: JSON.parse(JSON.stringify(run)),
              };
            },
          }),
        ]);
      }
      const providers = params.providers;
      const task = (async () => {
        if (params.action === "describe") {
          try {
            return presentDiscovery(
              await describeScriptProviders(
                pi,
                cwd,
                providers,
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
            providers,
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
