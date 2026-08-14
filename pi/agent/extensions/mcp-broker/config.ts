import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";
import { APPROVAL_TIMEOUT_MS, type ApprovalMode } from "./client.ts";

export type McpBrokerConfig = {
  endpoint?: string;
  agentToken?: string;
  readOnly: boolean;
  approvalMode: ApprovalMode;
  approvalTimeoutMs: number;
};

const DEFAULT_CONFIG: McpBrokerConfig = {
  endpoint: undefined,
  agentToken: undefined,
  readOnly: false,
  approvalMode: "wait",
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
    globalSettings: migrateDeprecatedTokenSetting(
      readExtensionSettings(globalSettings, "mcp-broker"),
      "global settings",
      warnings,
    ),
    projectSettings: migrateDeprecatedTokenSetting(
      readExtensionSettings(projectSettings, "mcp-broker"),
      "project settings",
      warnings,
    ),
    envSettings: readEnvSettings(warnings),
  });

  return {
    endpoint: normalizeString(merged.endpoint),
    agentToken: normalizeString(merged.agentToken),
    readOnly:
      typeof merged.readOnly === "boolean"
        ? merged.readOnly
        : DEFAULT_CONFIG.readOnly,
    approvalMode:
      normalizeApprovalMode(merged.approvalMode, DEFAULT_CONFIG.approvalMode) ??
      DEFAULT_CONFIG.approvalMode,
    approvalTimeoutMs:
      normalizePositiveInteger(
        merged.approvalTimeoutMs,
        DEFAULT_CONFIG.approvalTimeoutMs,
      ) ?? DEFAULT_CONFIG.approvalTimeoutMs,
  };
}

export function readEnvSettings(
  warnings: string[] = [],
): Partial<McpBrokerConfig> {
  const settings: Partial<McpBrokerConfig> = {};
  if (process.env.MCP_BROKER_ENDPOINT !== undefined) {
    settings.endpoint = normalizeString(process.env.MCP_BROKER_ENDPOINT);
  }

  const hasAgentToken = process.env.MCP_BROKER_AGENT_TOKEN !== undefined;
  const hasAuthToken = process.env.MCP_BROKER_AUTH_TOKEN !== undefined;
  if (hasAgentToken) {
    settings.agentToken = normalizeString(process.env.MCP_BROKER_AGENT_TOKEN);
    if (hasAuthToken) {
      warnings.push(
        "Both MCP_BROKER_AGENT_TOKEN and deprecated MCP_BROKER_AUTH_TOKEN are set; using MCP_BROKER_AGENT_TOKEN.",
      );
    }
  } else if (hasAuthToken) {
    settings.agentToken = normalizeString(process.env.MCP_BROKER_AUTH_TOKEN);
    warnings.push(
      "MCP_BROKER_AUTH_TOKEN is deprecated; use MCP_BROKER_AGENT_TOKEN.",
    );
  }

  if (process.env.MCP_BROKER_READONLY !== undefined) {
    const readOnly = parseBooleanEnv(process.env.MCP_BROKER_READONLY);
    if (readOnly !== undefined) settings.readOnly = readOnly;
  }
  if (process.env.MCP_BROKER_APPROVAL_MODE !== undefined) {
    const approvalMode = normalizeApprovalMode(
      process.env.MCP_BROKER_APPROVAL_MODE,
      undefined,
    );
    if (approvalMode !== undefined) settings.approvalMode = approvalMode;
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

function migrateDeprecatedTokenSetting(
  settings: Record<string, unknown>,
  source: "global settings" | "project settings",
  warnings: string[],
): Record<string, unknown> {
  if (!Object.hasOwn(settings, "authToken")) return settings;

  if (Object.hasOwn(settings, "agentToken")) {
    warnings.push(
      `extension:mcp-broker defines both agentToken and deprecated authToken in ${source}; using agentToken.`,
    );
  } else {
    settings.agentToken = settings.authToken;
    warnings.push(
      `extension:mcp-broker authToken in ${source} is deprecated; use agentToken.`,
    );
  }
  delete settings.authToken;
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

function normalizeApprovalMode(
  value: unknown,
  fallback: ApprovalMode | undefined,
): ApprovalMode | undefined {
  return value === "wait" || value === "reject" ? value : fallback;
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number | undefined,
): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return fallback;
  return numberValue;
}
