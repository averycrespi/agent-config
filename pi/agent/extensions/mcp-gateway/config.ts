import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isAbsolute, join } from "node:path";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readJsonFileObject,
} from "../_shared/config.ts";

export type GatewayConfig = {
  endpoint?: string;
  credentialFile?: string;
  readOnly: boolean;
  discoveryTimeoutMs: number;
  callTimeoutMs: number;
};

export const DEFAULT_CONFIG: GatewayConfig = {
  endpoint: undefined,
  credentialFile: undefined,
  readOnly: false,
  discoveryTimeoutMs: 15_000,
  callTimeoutMs: 65_000,
};

function positive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 300_000
    ? number
    : fallback;
}

export function parseConfig(
  settings: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): GatewayConfig {
  const overrides: Record<string, unknown> = {};
  for (const [field, key] of Object.entries({
    endpoint: "MCP_GATEWAY_ENDPOINT",
    credentialFile: "MCP_GATEWAY_CREDENTIAL_FILE",
    readOnly: "MCP_GATEWAY_READONLY",
    discoveryTimeoutMs: "MCP_GATEWAY_DISCOVERY_TIMEOUT_MS",
    callTimeoutMs: "MCP_GATEWAY_CALL_TIMEOUT_MS",
  })) {
    if (env[key] !== undefined) overrides[field] = env[key];
  }
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG,
    globalSettings: settings,
    envSettings: overrides,
  });
  return {
    endpoint:
      typeof merged.endpoint === "string" ? merged.endpoint.trim() : undefined,
    credentialFile:
      typeof merged.credentialFile === "string"
        ? merged.credentialFile.trim()
        : undefined,
    readOnly:
      typeof merged.readOnly === "boolean"
        ? merged.readOnly
        : (parseBooleanEnv(String(merged.readOnly)) ?? true),
    discoveryTimeoutMs: positive(
      merged.discoveryTimeoutMs,
      DEFAULT_CONFIG.discoveryTimeoutMs,
    ),
    callTimeoutMs: positive(merged.callTimeoutMs, DEFAULT_CONFIG.callTimeoutMs),
  };
}

export async function loadGatewayConfig(
  _cwd: string,
  warnings: string[] = [],
): Promise<GatewayConfig> {
  // Project-controlled endpoints must not receive a host credential implicitly.
  const parseWarnings: string[] = [];
  const global = await readJsonFileObject(
    join(getAgentDir(), "settings.json"),
    parseWarnings,
  );
  if (parseWarnings.length)
    warnings.push("Could not parse global Pi settings; check settings.json.");
  const config = parseConfig(
    readExtensionSettings(global, "mcp-gateway"),
    process.env,
  );
  try {
    validateConfig(config);
  } catch (error) {
    warnings.push(
      error instanceof Error ? error.message : "Invalid gateway configuration.",
    );
    // Do not render unvalidated endpoint/path values (which could contain secrets).
    return { ...config, endpoint: undefined, credentialFile: undefined };
  }
  return config;
}

function isForwardingHostname(hostname: string): boolean {
  const labels = hostname.split(".");
  return (
    hostname.length <= 253 &&
    labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    ) &&
    !/^\d+$/.test(labels[labels.length - 1])
  );
}

export function validateConfig(config: GatewayConfig): string {
  if (!config.endpoint || !config.credentialFile) {
    throw new Error(
      "Configure MCP_GATEWAY_ENDPOINT and MCP_GATEWAY_CREDENTIAL_FILE (or global extension:mcp-gateway settings).",
    );
  }
  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new Error(
      "Gateway endpoint must be an absolute HTTP(S) URL ending in /mcp.",
    );
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname) ||
          isForwardingHostname(url.hostname))
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/mcp"
  )
    throw new Error(
      "Gateway endpoint must use HTTPS, numeric IPv4 loopback HTTP, or an explicitly trusted HTTP forwarding hostname; exact /mcp and no userinfo, query, or fragment.",
    );
  if (
    !isAbsolute(config.credentialFile) ||
    /[\x00-\x1f\x7f]/.test(config.credentialFile) ||
    /mgw_(?:agent|admin)_/.test(config.credentialFile)
  ) {
    throw new Error(
      "Gateway credentialFile must be an absolute protected file path, not a bearer value.",
    );
  }
  return url.href;
}
