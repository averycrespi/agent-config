import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  readExtensionSettings,
  readPiSettingsFiles,
  registerConfigCommand,
} from "../_shared/config.ts";
import { DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY_CEILING } from "./types.ts";

export type SubagentsConfig = { maxConcurrency: number };

export const DEFAULT_SUBAGENTS_CONFIG: SubagentsConfig = {
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
};

const EXTENSION_NAME = "subagents";
const ENV_NAME = "SUBAGENTS_MAX_CONCURRENCY";

type PlainObject = Record<string, unknown>;

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function clamp(value: number, source: string, warnings: string[]): number {
  if (value <= MAX_CONCURRENCY_CEILING) return value;
  warnings.push(
    `${source} exceeds the hard ceiling; clamping maxConcurrency to ${MAX_CONCURRENCY_CEILING}.`,
  );
  return MAX_CONCURRENCY_CEILING;
}

export function normalizeSubagentsConfig(
  globalSettings: PlainObject,
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): SubagentsConfig {
  const globalValue = parsePositiveInteger(globalSettings.maxConcurrency);
  const normalizedGlobal: PlainObject = {};
  if (globalValue !== undefined) {
    normalizedGlobal.maxConcurrency = clamp(
      globalValue,
      "Global maxConcurrency",
      warnings,
    );
  } else if (globalSettings.maxConcurrency !== undefined) {
    warnings.push("Ignoring invalid global maxConcurrency; using default.");
  }

  const envValue = parsePositiveInteger(env[ENV_NAME]);
  const normalizedEnv: PlainObject = {};
  if (envValue !== undefined) {
    normalizedEnv.maxConcurrency = clamp(envValue, ENV_NAME, warnings);
  } else if (env[ENV_NAME] !== undefined && env[ENV_NAME]?.trim() !== "") {
    warnings.push(`Ignoring invalid ${ENV_NAME}.`);
  }

  return mergeExtensionConfig({
    defaults: DEFAULT_SUBAGENTS_CONFIG as unknown as PlainObject,
    globalSettings: normalizedGlobal,
    envSettings: normalizedEnv,
  }) as SubagentsConfig;
}

export async function loadSubagentsConfig(
  cwd: string,
  warnings: string[] = [],
  options: { agentDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<SubagentsConfig> {
  const { globalSettings } = await readPiSettingsFiles({
    agentDir: options.agentDir ?? getAgentDir(),
    cwd,
    warnings,
  });
  return normalizeSubagentsConfig(
    readExtensionSettings(globalSettings, EXTENSION_NAME),
    options.env ?? process.env,
    warnings,
  );
}

export function registerSubagentsConfigCommand(pi: ExtensionAPI): void {
  registerConfigCommand(pi, {
    extensionName: EXTENSION_NAME,
    loadConfig: loadSubagentsConfig,
    sensitiveFields: [],
  });
}
