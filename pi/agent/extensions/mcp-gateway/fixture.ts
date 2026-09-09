import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { GatewayClient, type GatewayTool } from "./client.ts";
import { DEFAULT_CONFIG } from "./config.ts";

export type Request = {
  jsonrpc: string;
  id: string;
  method: string;
  params: Record<string, any>;
};
export type Handler = (
  body: Request,
  response: ServerResponse,
  request: IncomingMessage,
) => void | Promise<void>;
export const TEST_BEARER = `mgw_agent_${Buffer.alloc(32, 1).toString("base64url")}`;
export const rejectionCases = [
  {
    reason: "invalid_params",
    message:
      "Request rejected: invalid tools/call parameters. Check the request shape.",
  },
  {
    reason: "unknown_tool",
    message:
      "Request rejected: unknown tool. Refresh tools/list and check the tool name.",
  },
  {
    reason: "invalid_arguments",
    message:
      "Request rejected: invalid tool arguments. Check the tool’s input schema.",
  },
  {
    reason: "deny",
    message:
      "DENIED: a matching DENY grant forbids this call. Additional ALLOW grants and self-service requests cannot override it.",
  },
  {
    reason: "block",
    message:
      "BLOCKED: no matching ALLOW grant authorizes this call. If available, you may use mcp_gateway.list_grants to inspect your access or mcp_gateway.create_grant_request to request access. Requesting access does not authorize the call; approval is required.",
  },
  {
    reason: "block",
    message:
      "BLOCKED: no matching ALLOW grant authorizes this call. You may ask an administrator to review your access.",
  },
  {
    reason: "authorization_unavailable",
    message:
      "Call rejected: authorization could not be established. This is not a DENY or BLOCK decision.",
  },
] as const;

export function tool(
  name = "example.lookup",
  readOnly: boolean | undefined = true,
): GatewayTool {
  return {
    name,
    description: `Lookup ${name}`,
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    ...(readOnly === undefined
      ? {}
      : { annotations: { readOnlyHint: readOnly } }),
  };
}
export function reply(
  response: ServerResponse,
  body: Request,
  result: unknown,
) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
}
export function rpcError(
  response: ServerResponse,
  body: Request,
  code: string,
  extra = {},
  message: unknown = "remote error",
) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      error: {
        code: -32000,
        message,
        data: { code, ...extra },
      },
    }),
  );
}
export async function fixture(t: TestContext, handler?: Handler) {
  const dir = await mkdtemp(join(tmpdir(), "pi-gateway-test-"));
  const requests: Request[] = [];
  const headers: IncomingMessage["headers"][] = [];
  const state = {
    handler:
      handler ??
      (((body, response) =>
        reply(
          response,
          body,
          body.method === "tools/list"
            ? { tools: [tool()] }
            : { content: [{ type: "text", text: "success" }] },
        )) as Handler),
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Request;
    requests.push(body);
    headers.push(request.headers);
    try {
      await state.handler(body, response, request);
    } catch {
      response.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  const config = {
    ...DEFAULT_CONFIG,
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    agentToken: TEST_BEARER,
  };
  const client = new GatewayClient();
  client.configure(config);
  t.after(async () => {
    client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, config, client, requests, headers, state };
}
