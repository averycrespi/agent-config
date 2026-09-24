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
import { inventoryScripts, loadDefinition } from "./store.ts";
import { validateArguments, MAX_ARGS_BYTES } from "./definition.ts";
import { jsonSnapshot } from "./value.ts";
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
      "Describe selected provider APIs or execute one fresh bounded JavaScript child using explicitly selected host-permitted providers. [] runs pure JSON computation without providers. Describe [] lists permitted registered APIs. Use namespaced methods with the documented positional argument schemas and parallel(thunks). Explicitly return JSON (null for empty) and await all calls. No ambient filesystem/network/process/imports or credentials. Defaults: 32 calls, concurrency 4, 120s; returned JSON limited to 24000 bytes. Host failures and unknown effects survive guest catches. Foreground default. execution:background returns a persisted ID and automatic outcome notification; requires Background service. list discovers saved definitions; validate checks a named definition and args without executing. run requires exactly one source or name; args is only for names. Metadata never grants authority; definition limits only narrow policy. executions/inspect/cancel/dismiss control Script executions (id required except executions). No automatic retries, grants or replay.",
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
      if (params.action === "list" || params.action === "validate") {
        if (
          params.source !== undefined ||
          params.execution !== undefined ||
          params.providers !== undefined ||
          params.id !== undefined ||
          (params.action === "list" &&
            (params.name !== undefined || params.args !== undefined)) ||
          (params.action === "validate" && !params.name)
        )
          throw new Error("Invalid saved Script action fields");
        const config = await loadScriptConfig(ctx.cwd, [], signal);
        signal?.throwIfAborted();
        if (!config.valid) throw new Error("invalid_config");
        const inventory =
          params.action === "list"
            ? await inventoryScripts(config.userScriptsDir)
            : undefined;
        const definition =
          params.action === "validate"
            ? await loadDefinition(config.userScriptsDir, params.name!)
            : undefined;
        if (definition) validateArguments(definition, params.args);
        signal?.throwIfAborted();
        const value = inventory ?? {
          valid: true,
          ...definition!.meta,
          digest: definition!.digest,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: wrapUntrustedContent(
                "SAVED SCRIPTS",
                JSON.stringify(value),
              ),
            },
          ],
          details: {
            saved: true,
            action: params.action,
            entries: inventory?.entries ?? [
              { name: definition!.meta.name, valid: true },
            ],
            truncated: inventory?.truncated ?? false,
          },
        };
      }
      if (
        ["executions", "inspect", "cancel", "dismiss"].includes(params.action)
      ) {
        if (
          params.source !== undefined ||
          params.execution !== undefined ||
          params.providers !== undefined ||
          params.name !== undefined ||
          params.args !== undefined
        )
          throw new Error("Unexpected fields for background control");
        const service = getBackgroundService(pi);
        if (params.action === "executions") {
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
          (params.execution !== undefined ||
            params.source !== undefined ||
            params.name !== undefined ||
            params.args !== undefined)) ||
        (params.action === "run" &&
          ((params.source === undefined) === (params.name === undefined) ||
            (params.name === undefined && params.args !== undefined)))
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
      // Capture caller data before any asynchronous store or policy reads.
      const providers = [...params.providers];
      const name = params.name;
      let source = params.source;
      let limits = { ...MAX_LIMITS };
      let args: unknown;
      let saved: { name: string; digest: string } | undefined;
      if (name !== undefined) {
        const input = JSON.parse(
          jsonSnapshot(
            params.args === undefined ? {} : params.args,
            MAX_ARGS_BYTES,
          ),
        );
        const config = await loadScriptConfig(cwd, [], combined);
        if (!config.valid) throw new Error("invalid_config");
        const definition = await loadDefinition(config.userScriptsDir, name);
        combined.throwIfAborted();
        args = JSON.parse(validateArguments(definition, input));
        if (definition.meta.providers.some((p) => !providers.includes(p)))
          throw new Error("required_provider_missing");
        source = definition.executable;
        limits = { ...definition.meta.limits };
        saved = { name, digest: definition.digest };
      }
      if (
        params.action === "run" &&
        (params.execution === "background" || saved)
      ) {
        const service =
          params.execution === "background"
            ? getBackgroundService(pi)
            : undefined;
        // Pin the original policy, provider records, context and deadline before admission.
        // Tool-turn cancellation gates admission; admitted work has its own session lifetime.
        const prepared = await prepareScript(pi, cwd, {
          session,
          source: source!,
          args,
          providers,
          limits,
          signal: service ? lifetime.signal : combined,
          deadlineMs: Date.now() + limits.timeoutMs,
        });
        combined.throwIfAborted();
        if (!service) {
          const task = prepared.run(combined);
          running.add(task);
          try {
            const result = presentRun(await task);
            return {
              ...result,
              details: { ...result.details, definition: saved },
            };
          } finally {
            running.delete(task);
          }
        }
        return backgroundResult([
          service.admit({
            owner: "script",
            label: params.description,
            deadlineMs: prepared.deadlineMs,
            ...(saved ? { result: { definition: saved } } : {}),
            run: async (signal) => {
              const run = await prepared.run(signal);
              return {
                status: run.status,
                effectsMayPersist: run.effectsMayPersist,
                outcomeUnknown: run.outcomeUnknown,
                result: JSON.parse(
                  JSON.stringify({
                    ...run,
                    ...(saved ? { definition: saved } : {}),
                  }),
                ),
              };
            },
          }),
        ]);
      }
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
