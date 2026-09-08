import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  DEFAULT_CONFIG,
  validateConfig,
  type GatewayConfig,
} from "./config.ts";

export const PROTOCOL_VERSION = "2026-07-28";
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
export type GatewayTool = {
  name: string;
  description?: string;
  title?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};
export type CallResult = {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string = "client_error",
    public readonly invocationId?: string,
    public readonly outcomeUnknown = false,
  ) {
    super(message);
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function redactCredentials(text: string): string {
  return text.replace(
    /mgw_(?:agent|admin)_[A-Za-z0-9_-]+/g,
    "[redacted gateway credential]",
  );
}

async function credential(
  path: string,
): Promise<{ bearer: string; identity: string }> {
  try {
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.size > 4096 ||
        (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid())
      )
        throw new Error();
      const bytes = Buffer.alloc(4097);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 4096) throw new Error();
      const bearer = bytes.subarray(0, bytesRead).toString("utf8").trim();
      if (!/^mgw_agent_[A-Za-z0-9_-]{43}$/.test(bearer)) throw new Error();
      return {
        bearer,
        identity: createHash("sha256").update(bearer).digest("hex"),
      };
    } finally {
      await file.close();
    }
  } catch {
    throw new GatewayError(
      "Cannot read agent credential: use an owner-only regular file containing one mgw_agent_ bearer; symlinks and administrator credentials are rejected.",
      "credential_error",
    );
  }
}

type DiscoveryBudget = { remainingBytes: number };

async function responseText(
  response: Response,
  budget?: DiscoveryBudget,
): Promise<string> {
  if (!response.body)
    throw new GatewayError(
      "Gateway returned an empty response.",
      "protocol_error",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new GatewayError(
          "Gateway response exceeds 16 MiB.",
          "resource_limit",
        );
      if (budget) {
        budget.remainingBytes -= value.byteLength;
        if (budget.remainingBytes < 0)
          throw new GatewayError(
            "Gateway discovery exceeds its aggregate 32 MiB response budget.",
            "resource_limit",
          );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

const SAFE_CODES = new Set([
  "call_rejected",
  "audit_unavailable",
  "tool_unavailable",
  "downstream_failure",
  "outcome_unknown",
  "invalid_params",
  "stale_cursor",
  "authorization_unavailable",
  "resource_limit",
]);

export class GatewayClient {
  private config: GatewayConfig = { ...DEFAULT_CONFIG };
  private lifetime = new AbortController();
  private cached?: GatewayTool[];

  configure(config: GatewayConfig): void {
    if (JSON.stringify(config) === JSON.stringify(this.config)) return;
    this.close();
    this.config = { ...config };
    this.lifetime = new AbortController();
  }
  close(): void {
    this.lifetime.abort();
    this.cached = undefined;
  }
  getReadOnly(): boolean {
    return this.config.readOnly;
  }
  getCachedTools(): GatewayTool[] | undefined {
    return this.cached;
  }

  private async operation<T>(
    signal: AbortSignal | undefined,
    timeout: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const combined = AbortSignal.any([
      controller.signal,
      this.lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    try {
      combined.throwIfAborted();
      return await work(combined);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    expectedIdentity?: string,
    budget?: DiscoveryBudget,
  ): Promise<{
    value: Record<string, unknown>;
    identity: string;
  }> {
    if (budget && budget.remainingBytes <= 0)
      throw new GatewayError(
        "Gateway discovery exhausted its aggregate response budget.",
        "resource_limit",
      );
    let endpoint: string;
    try {
      endpoint = validateConfig(this.config);
    } catch (error) {
      throw new GatewayError(
        error instanceof Error
          ? error.message
          : "Invalid gateway configuration.",
        "config_error",
      );
    }
    const { bearer, identity } = await credential(this.config.credentialFile!);
    signal.throwIfAborted();
    if (expectedIdentity && identity !== expectedIdentity) {
      this.cached = undefined;
      throw new GatewayError(
        "Credential changed during discovery/read-only admission; run discovery again.",
        "credential_changed",
      );
    }
    const id = randomUUID();
    let sent = false;
    try {
      sent = true;
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Mcp-Protocol-Version": PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "pi-mcp-gateway",
                version: "1",
              },
            },
          },
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GatewayError(
          `Gateway HTTP ${response.status}; check endpoint, credential, and gateway availability.`,
          "http_error",
          undefined,
          method === "tools/call",
        );
      }
      if (
        response.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
      ) {
        await response.body?.cancel();
        throw new GatewayError(
          "Gateway returned an unsupported content type.",
          "protocol_error",
        );
      }
      const raw = await responseText(response, budget);
      // A credential echo must never reach tools, diagnostics, or spill files.
      const parsed: unknown = JSON.parse(
        redactCredentials(
          JSON.stringify(JSON.parse(raw)).replaceAll(
            bearer,
            "[redacted gateway credential]",
          ),
        ),
      );
      signal.throwIfAborted();
      if (
        !record(parsed) ||
        parsed.jsonrpc !== "2.0" ||
        parsed.id !== id ||
        Object.hasOwn(parsed, "error") === Object.hasOwn(parsed, "result")
      )
        throw new GatewayError(
          "Invalid gateway JSON-RPC envelope.",
          "protocol_error",
        );
      if (Object.hasOwn(parsed, "error")) {
        const data =
          record(parsed.error) && record(parsed.error.data)
            ? parsed.error.data
            : {};
        const code =
          typeof data.code === "string" && SAFE_CODES.has(data.code)
            ? data.code
            : "rpc_error";
        const invocationId =
          typeof data.invocationId === "string" &&
          /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(data.invocationId)
            ? data.invocationId
            : undefined;
        throw new GatewayError(
          `Gateway rejected request: ${code}.`,
          code,
          invocationId,
          code === "outcome_unknown" || data.outcomeUnknown === true,
        );
      }
      if (!record(parsed.result))
        throw new GatewayError("Invalid gateway result.", "protocol_error");
      return { value: parsed.result, identity };
    } catch (error) {
      if (error instanceof GatewayError) {
        if (
          method === "tools/call" &&
          sent &&
          ["protocol_error", "resource_limit"].includes(error.code)
        )
          throw new GatewayError(error.message, error.code, undefined, true);
        throw error;
      }
      throw new GatewayError(
        signal.aborted
          ? "Gateway request cancelled or timed out."
          : "Gateway transport or response failed; check endpoint and service availability.",
        signal.aborted ? "cancelled" : "transport_error",
        undefined,
        sent && method === "tools/call",
      );
    }
  }

  private async discover(
    signal: AbortSignal,
  ): Promise<{ tools: GatewayTool[]; identity: string }> {
    this.cached = undefined;
    const budget = { remainingBytes: MAX_CATALOG_BYTES };
    let pages = 0;
    let descriptors = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const tools: GatewayTool[] = [];
      const names = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let identity: string | undefined;
      try {
        while (pages < 100) {
          pages++;
          const response = await this.request(
            "tools/list",
            cursor ? { cursor } : {},
            signal,
            identity,
            budget,
          );
          identity = response.identity;
          if (!Array.isArray(response.value.tools))
            throw new GatewayError(
              "Invalid or oversized gateway catalog.",
              "resource_limit",
            );
          descriptors += response.value.tools.length;
          if (descriptors > 10_000)
            throw new GatewayError(
              "Gateway discovery exceeds 10,000 descriptors across attempts.",
              "resource_limit",
            );
          for (const tool of response.value.tools) {
            if (
              !record(tool) ||
              typeof tool.name !== "string" ||
              !tool.name ||
              tool.name.length > 512 ||
              !record(tool.inputSchema) ||
              (tool.description !== undefined &&
                typeof tool.description !== "string") ||
              (tool.title !== undefined && typeof tool.title !== "string") ||
              (tool.annotations !== undefined && !record(tool.annotations)) ||
              names.has(tool.name)
            )
              throw new GatewayError(
                "Invalid or duplicate gateway descriptor.",
                "protocol_error",
              );
            names.add(tool.name);
            tools.push(tool as GatewayTool);
          }
          const next = response.value.nextCursor;
          if (next === undefined) {
            const visible = tools
              .filter(
                (tool) =>
                  !this.config.readOnly ||
                  tool.annotations?.readOnlyHint === true,
              )
              .sort((a, b) => a.name.localeCompare(b.name));
            this.cached = visible;
            return { tools: visible, identity };
          }
          if (
            typeof next !== "string" ||
            !next ||
            next.length > 8192 ||
            cursors.has(next)
          )
            throw new GatewayError(
              "Invalid or repeated gateway cursor.",
              "protocol_error",
            );
          cursors.add(next);
          cursor = next;
        }
        throw new GatewayError(
          "Gateway catalog exceeds 100 pages; discovery is incomplete.",
          "resource_limit",
        );
      } catch (error) {
        if (
          !(
            error instanceof GatewayError &&
            error.code === "stale_cursor" &&
            attempt === 0
          )
        )
          throw error;
      }
    }
    throw new GatewayError("Gateway discovery failed.");
  }

  async listTools(signal?: AbortSignal): Promise<GatewayTool[]> {
    return this.operation(
      signal,
      this.config.discoveryTimeoutMs,
      async (active) => (await this.discover(active)).tools,
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallResult> {
    return this.operation(signal, this.config.callTimeoutMs, async (active) => {
      let identity: string | undefined;
      if (this.config.readOnly) {
        const catalog = await this.operation(
          active,
          this.config.discoveryTimeoutMs,
          (s) => this.discover(s),
        );
        if (!catalog.tools.some((tool) => tool.name === name))
          throw new GatewayError(
            "Tool is not available in read-only mode.",
            "read_only_rejected",
          );
        identity = catalog.identity;
      }
      const { value } = await this.request(
        "tools/call",
        { name, arguments: args },
        active,
        identity,
      );
      if (
        !Array.isArray(value.content) ||
        (value.isError !== undefined && typeof value.isError !== "boolean") ||
        (value.structuredContent !== undefined &&
          !record(value.structuredContent))
      )
        throw new GatewayError(
          "Invalid gateway call result; outcome may be unknown.",
          "protocol_error",
          undefined,
          true,
        );
      return value as CallResult;
    });
  }
}
