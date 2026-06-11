/**
 * MCP client wrapper for the broker.
 *
 * Owns a single long-lived MCP client connection to the broker over
 * Streamable HTTP. Lazy-connects on first use, caches the fetched tool
 * list (so provider namespaces and schemas can be read without a round
 * trip on every call), and exposes a small surface consumed by tools.ts
 * and the namespace-hint hook in index.ts.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_NETWORK_TIMEOUT_MS = 15_000;

export type BrokerTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
};

// Strict: only readOnlyHint === true counts as read-only.
// Missing annotation, missing hint, or hint=false is treated as write.
export function isReadOnly(tool: BrokerTool): boolean {
  return tool.annotations?.readOnlyHint === true;
}

export function filterReadOnly(tools: BrokerTool[]): BrokerTool[] {
  return tools.filter(isReadOnly);
}

export class BrokerClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connecting: Promise<Client> | null = null;
  private cachedTools: BrokerTool[] | null = null;
  private cachedProviders: string[] | null = null;
  private endpoint: string | undefined;
  private authToken: string | undefined;
  private readOnly: boolean;
  private networkTimeoutMs: number;

  constructor(
    opts: {
      endpoint?: string;
      authToken?: string;
      readOnly?: boolean;
      networkTimeoutMs?: number;
    } = {},
  ) {
    this.endpoint = opts.endpoint;
    this.authToken = opts.authToken;
    this.readOnly = opts.readOnly ?? false;
    this.networkTimeoutMs = opts.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
  }

  configure(opts: {
    endpoint?: string;
    authToken?: string;
    readOnly?: boolean;
  }): void {
    const nextReadOnly = opts.readOnly ?? false;
    const changed =
      this.endpoint !== opts.endpoint ||
      this.authToken !== opts.authToken ||
      this.readOnly !== nextReadOnly;
    this.endpoint = opts.endpoint;
    this.authToken = opts.authToken;
    this.readOnly = nextReadOnly;
    if (changed) this.reset();
  }

  getReadOnly(): boolean {
    return this.readOnly;
  }

  private async withNetworkTimeout<T>(
    operation: Promise<T>,
    label: string,
    timeoutMs: number = this.networkTimeoutMs,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`MCP broker ${label} timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    const endpoint = this.endpoint;
    const token = this.authToken;
    if (!endpoint || !token) {
      throw new Error(
        "broker endpoint not configured — set endpoint/authToken or MCP_BROKER_ENDPOINT/MCP_BROKER_AUTH_TOKEN",
      );
    }

    let connectPromise!: Promise<Client>;
    connectPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${endpoint}/mcp`),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      );
      this.transport = transport;
      const client = new Client(
        { name: "pi-mcp-broker", version: "0.1.0" },
        { capabilities: {} },
      );
      try {
        await this.withNetworkTimeout(client.connect(transport), "connect");
        if (this.connecting !== connectPromise) {
          await client.close().catch(() => {});
          throw new Error("broker client closed during connect");
        }
        this.client = client;
        return client;
      } catch (error) {
        await client.close().catch(() => {});
        await transport.close().catch(() => {});
        if (this.transport === transport) this.transport = null;
        throw error;
      }
    })();

    this.connecting = connectPromise;

    try {
      return await connectPromise;
    } finally {
      if (this.connecting === connectPromise) {
        this.connecting = null;
      }
    }
  }

  private async fetchTools(): Promise<BrokerTool[]> {
    const client = await this.getClient();
    const result = await this.withNetworkTimeout(
      client.listTools(),
      "listTools",
    );
    const all: BrokerTool[] = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
    return this.readOnly ? filterReadOnly(all) : all;
  }

  async listTools(): Promise<BrokerTool[]> {
    try {
      const tools = await this.fetchTools();
      this.cachedTools = tools;
      this.cachedProviders = extractProviders(tools);
      return tools;
    } catch (error) {
      const hadCache =
        this.cachedTools !== null || this.cachedProviders !== null;
      this.reset();
      if (!hadCache) throw error;
      const tools = await this.fetchTools();
      this.cachedTools = tools;
      this.cachedProviders = extractProviders(tools);
      return tools;
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    try {
      const client = await this.getClient();
      return await this.withNetworkTimeout(
        client.callTool({ name, arguments: args }, undefined, {
          signal,
          timeout: APPROVAL_TIMEOUT_MS,
        }),
        "callTool",
        APPROVAL_TIMEOUT_MS,
      );
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        this.reset();
      }
      throw error;
    }
  }

  /** Return cached tools without a network call. Populated by listTools. */
  getCachedTools(): BrokerTool[] | null {
    return this.cachedTools;
  }

  /** Return cached provider namespaces without a network call. */
  getCachedProviders(): string[] | null {
    return this.cachedProviders;
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    const connecting = this.connecting;

    this.client = null;
    this.transport = null;
    this.connecting = null;
    this.cachedTools = null;
    this.cachedProviders = null;

    if (client) {
      await client.close().catch(() => {});
      return;
    }

    if (connecting) {
      const connectedClient = await connecting.catch(() => null);
      if (connectedClient) {
        await connectedClient.close().catch(() => {});
        return;
      }
    }

    await transport?.close().catch(() => {});
  }

  /** Drop the current client so the next call reconnects. */
  reset(): void {
    const client = this.client;
    const transport = this.transport;
    const connecting = this.connecting;

    this.client = null;
    this.transport = null;
    this.connecting = null;
    this.cachedTools = null;
    this.cachedProviders = null;

    if (client) {
      void client.close().catch(() => {});
      return;
    }

    if (connecting) {
      void connecting
        .then((connectedClient) => connectedClient.close())
        .catch(() => {});
      return;
    }

    if (transport) {
      void transport.close().catch(() => {});
    }
  }
}

export function extractProviders(tools: BrokerTool[]): string[] {
  const set = new Set<string>();
  for (const tool of tools) {
    const dot = tool.name.indexOf(".");
    if (dot > 0) set.add(tool.name.slice(0, dot));
  }
  return Array.from(set).sort();
}
