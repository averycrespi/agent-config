import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";
import { APPROVAL_TIMEOUT_MS } from "./client.ts";

export type McpBrokerConfig = {
  endpoint?: string;
  authToken?: string;
  readOnly: boolean;
  approvalTimeoutMs: number;
};

const DEFAULT_CONFIG: McpBrokerConfig = {
  endpoint: undefined,
  authToken: undefined,
  readOnly: false,
  approvalTimeoutMs: APPROVAL_TIMEOUT_MS,
};

export async function loadMcpBrokerConfig(
  cwd: string,
  warnings: string[] = [],
): Promise<McpBrokerConfig> {
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG,
    globalSettings: readExtensionSettings(globalSettings, "mcp-broker"),
    projectSettings: readExtensionSettings(projectSettings, "mcp-broker"),
    envSettings: readEnvSettings(),
  });

  return {
    endpoint: normalizeString(merged.endpoint),
    authToken: normalizeString(merged.authToken),
    readOnly:
      typeof merged.readOnly === "boolean"
        ? merged.readOnly
        : DEFAULT_CONFIG.readOnly,
    approvalTimeoutMs:
      normalizePositiveInteger(
        merged.approvalTimeoutMs,
        DEFAULT_CONFIG.approvalTimeoutMs,
      ) ?? DEFAULT_CONFIG.approvalTimeoutMs,
  };
}

export function readEnvSettings(): Partial<McpBrokerConfig> {
  const settings: Partial<McpBrokerConfig> = {};
  if (process.env.MCP_BROKER_ENDPOINT !== undefined) {
    settings.endpoint = normalizeString(process.env.MCP_BROKER_ENDPOINT);
  }
  if (process.env.MCP_BROKER_AUTH_TOKEN !== undefined) {
    settings.authToken = normalizeString(process.env.MCP_BROKER_AUTH_TOKEN);
  }
  if (process.env.MCP_BROKER_READONLY !== undefined) {
    const readOnly = parseBooleanEnv(process.env.MCP_BROKER_READONLY);
    if (readOnly !== undefined) settings.readOnly = readOnly;
  }
  if (process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS !== undefined) {
    const approvalTimeoutMs = parsePositiveIntegerEnv(
      process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS,
    );
    if (approvalTimeoutMs !== undefined) {
      settings.approvalTimeoutMs = approvalTimeoutMs;
    }
  }
  return settings;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function parsePositiveIntegerEnv(value: string): number | undefined {
  return normalizePositiveInteger(value, undefined);
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number | undefined,
): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return fallback;
  return numberValue;
}
