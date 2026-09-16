import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerScriptProvider, type JsonValue } from "../script/api.ts";
import { createGatewayAccess, isGatewayError } from "./api.ts";
import type { GatewayClient } from "./client.ts";

// Public local categories only. Never forward remote prose, arbitrary exceptions,
// or guest-derived codes into host accounting.
const errorCodes = [
  "call_rejected",
  "audit_unavailable",
  "tool_unavailable",
  "downstream_failure",
  "outcome_unknown",
  "invalid_params",
  "stale_cursor",
  "authorization_unavailable",
  "resource_limit",
  "http_error",
  "protocol_error",
  "rpc_error",
  "config_error",
  "credential_changed",
  "cancelled",
  "transport_error",
  "read_only_rejected",
  "unknown_tool",
  "invalid_arguments",
  "unsupported_schema",
  "client_error",
] as const;

/** Bind one registration to one client authority lifetime, not to a late lookup. */
export function registerGatewayScriptProvider(
  pi: Pick<ExtensionAPI, "events">,
  client: GatewayClient,
  isActive: () => boolean,
): () => void {
  const lifetime = client.getLifetimeSignal();
  const access = createGatewayAccess(client);
  const unregister = registerScriptProvider(pi, {
    namespace: "mcp",
    available: () => isActive() && !lifetime.aborted,
    methods: {
      call: {
        description:
          "Invoke a discovered MCP tool once; returns its complete redacted result envelope. Inspect mcp_search/mcp_describe first. Permission is not user approval. No automatic grants, retries or replay.",
        inputSchema: {
          type: "array",
          items: [
            { type: "string", minLength: 1, maxLength: 512 },
            { type: "object" },
          ],
          minItems: 2,
          maxItems: 2,
          additionalItems: false,
        },
        errorCodes,
        async handler(args, { signal, deadlineMs }) {
          const timer = new AbortController();
          const timeout = setTimeout(
            () => timer.abort(),
            Math.max(0, deadlineMs - Date.now()),
          );
          const active = AbortSignal.any([signal, lifetime, timer.signal]);
          try {
            active.throwIfAborted();
            const value = await access.call(
              args[0] as string,
              args[1] as Record<string, unknown>,
              active,
              () => {
                if (Date.now() >= deadlineMs) timer.abort();
                active.throwIfAborted();
              },
            );
            return {
              value: value as JsonValue,
              isError: value.isError === true,
            };
          } catch (error) {
            if (
              !isGatewayError(error) ||
              !errorCodes.includes(error.code as (typeof errorCodes)[number])
            )
              throw error;
            return {
              value: null,
              error: error.code,
              outcomeUnknown: error.outcomeUnknown,
            };
          } finally {
            clearTimeout(timeout);
          }
        },
      },
    },
  });
  const dispose = () => {
    lifetime.removeEventListener("abort", dispose);
    unregister();
  };
  lifetime.addEventListener("abort", dispose, { once: true });
  if (lifetime.aborted) dispose();
  return dispose;
}
