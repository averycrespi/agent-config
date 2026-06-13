import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";

export type WebAccessConfig = {
  tavilyApiKey?: string;
  jinaApiKey?: string;
};

const DEFAULT_CONFIG: WebAccessConfig = {
  tavilyApiKey: undefined,
  jinaApiKey: undefined,
};

export async function loadWebAccessConfig(
  cwd: string,
  warnings: string[] = [],
): Promise<WebAccessConfig> {
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG,
    globalSettings: readExtensionSettings(globalSettings, "web-access"),
    projectSettings: readExtensionSettings(projectSettings, "web-access"),
    envSettings: readEnvSettings(),
  });

  return {
    tavilyApiKey: normalizeString(merged.tavilyApiKey),
    jinaApiKey: normalizeString(merged.jinaApiKey),
  };
}

export function readEnvSettings(): Partial<WebAccessConfig> {
  const settings: Partial<WebAccessConfig> = {};
  if (process.env.TAVILY_API_KEY !== undefined) {
    settings.tavilyApiKey = normalizeString(process.env.TAVILY_API_KEY);
  }
  if (process.env.JINA_API_KEY !== undefined) {
    settings.jinaApiKey = normalizeString(process.env.JINA_API_KEY);
  }
  return settings;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}
