import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GatewayClient, GatewayError, type CallResult } from "./client.ts";
import { validateArguments } from "./schema.ts";
export {
  GatewayError,
  redactCredentials,
  sanitizeGatewayText,
  MAX_RESPONSE_BYTES,
} from "./client.ts";
export type { CallResult, GatewayTool } from "./client.ts";

export interface GatewayAccess {
  call(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    onDispatch: () => void,
  ): Promise<CallResult>;
}
const ACCESS_EVENT = "mcp-gateway:access-v1";

export function createGatewayAccess(client: GatewayClient): GatewayAccess {
  return Object.freeze({
    call: (
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
      onDispatch: () => void,
    ) =>
      client.callTool(name, args, signal, {
        validate: validateArguments,
        onDispatch,
      }),
  });
}

/** Host-only, session-scoped event handshake; never put this bus in a guest. */
export function provideGatewayAccess(
  pi: ExtensionAPI,
  client: GatewayClient,
  isActive: () => boolean,
): () => void {
  return pi.events.on(ACCESS_EVENT, (request: unknown) => {
    if (
      isActive() &&
      request &&
      typeof request === "object" &&
      "accept" in request &&
      typeof request.accept === "function"
    ) {
      request.accept(createGatewayAccess(client));
    }
  });
}

export function requestGatewayAccess(
  pi: Pick<ExtensionAPI, "events">,
): GatewayAccess {
  const providers: GatewayAccess[] = [];
  pi.events.emit(ACCESS_EVENT, {
    accept: (access: GatewayAccess) => providers.push(access),
  });
  if (providers.length !== 1)
    throw new GatewayError(
      "Code requires exactly one active MCP Gateway extension.",
      "gateway_unavailable",
    );
  return providers[0];
}
