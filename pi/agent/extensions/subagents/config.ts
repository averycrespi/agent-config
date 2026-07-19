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
import {
  CAPABILITIES,
  DEFAULT_MAX_CONCURRENCY,
  MAX_CONCURRENCY_CEILING,
  THINKING_LEVELS,
  type Capability,
  type ThinkingLevel,
} from "./types.ts";

export type SubagentsConfig = {
  maxConcurrency: number;
  modelTierSmall: string;
  modelTierMedium: string;
  modelTierLarge: string;
  allowedCapabilities: Capability[];
  allowedThinkingLevels: ThinkingLevel[];
};

export const DEFAULT_SUBAGENTS_CONFIG: SubagentsConfig = {
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  modelTierSmall: "openai-codex/gpt-5.6-luna",
  modelTierMedium: "openai-codex/gpt-5.6-terra",
  modelTierLarge: "openai-codex/gpt-5.6-sol",
  allowedCapabilities: [...CAPABILITIES],
  allowedThinkingLevels: ["low", "medium", "high"],
};

const EXTENSION_NAME = "subagents";
const ENV = {
  maxConcurrency: "SUBAGENTS_MAX_CONCURRENCY",
  modelTierSmall: "SUBAGENTS_MODEL_TIER_SMALL",
  modelTierMedium: "SUBAGENTS_MODEL_TIER_MEDIUM",
  modelTierLarge: "SUBAGENTS_MODEL_TIER_LARGE",
  allowedCapabilities: "SUBAGENTS_ALLOWED_CAPABILITIES",
  allowedThinkingLevels: "SUBAGENTS_ALLOWED_THINKING_LEVELS",
} as const;

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

function parseModelSelector(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const selector = value.trim();
  const slash = selector.indexOf("/");
  if (slash <= 0 || slash === selector.length - 1) return undefined;
  return selector;
}

function parseStringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : undefined;
  if (!values) return undefined;
  const normalized = values.map((entry) =>
    typeof entry === "string" ? entry.trim() : "",
  );
  if (normalized.some((entry) => !entry)) return undefined;
  return [...new Set(normalized)];
}

function parseAllowedList<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] | undefined {
  const values = parseStringList(value);
  if (!values || values.some((entry) => !allowed.includes(entry as T))) {
    return undefined;
  }
  return values as T[];
}

export function normalizeSubagentsConfig(
  globalSettings: PlainObject,
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): SubagentsConfig {
  const normalizedGlobal: PlainObject = {};
  const globalConcurrency = parsePositiveInteger(globalSettings.maxConcurrency);
  if (globalConcurrency !== undefined) {
    normalizedGlobal.maxConcurrency = clamp(
      globalConcurrency,
      "Global maxConcurrency",
      warnings,
    );
  } else if (globalSettings.maxConcurrency !== undefined) {
    warnings.push("Ignoring invalid global maxConcurrency; using default.");
  }

  for (const field of [
    "modelTierSmall",
    "modelTierMedium",
    "modelTierLarge",
  ] as const) {
    const value = parseModelSelector(globalSettings[field]);
    if (value) normalizedGlobal[field] = value;
    else if (globalSettings[field] !== undefined) {
      warnings.push(`Ignoring invalid global ${field}; using fallback.`);
    }
  }

  const globalCapabilities = parseAllowedList(
    globalSettings.allowedCapabilities,
    CAPABILITIES,
  );
  if (globalCapabilities) {
    normalizedGlobal.allowedCapabilities = globalCapabilities;
  } else if (globalSettings.allowedCapabilities !== undefined) {
    warnings.push(
      "Ignoring invalid global allowedCapabilities; using default.",
    );
  }

  const globalThinking = parseAllowedList(
    globalSettings.allowedThinkingLevels,
    THINKING_LEVELS,
  );
  if (globalThinking) {
    normalizedGlobal.allowedThinkingLevels = globalThinking;
  } else if (globalSettings.allowedThinkingLevels !== undefined) {
    warnings.push(
      "Ignoring invalid global allowedThinkingLevels; using default.",
    );
  }

  const normalizedEnv: PlainObject = {};
  const envConcurrency = parsePositiveInteger(env[ENV.maxConcurrency]);
  if (envConcurrency !== undefined) {
    normalizedEnv.maxConcurrency = clamp(
      envConcurrency,
      ENV.maxConcurrency,
      warnings,
    );
  } else if (env[ENV.maxConcurrency]?.trim()) {
    warnings.push(`Ignoring invalid ${ENV.maxConcurrency}.`);
  }

  for (const field of [
    "modelTierSmall",
    "modelTierMedium",
    "modelTierLarge",
  ] as const) {
    const envName = ENV[field];
    const raw = env[envName];
    const value = parseModelSelector(raw);
    if (value) normalizedEnv[field] = value;
    else if (raw?.trim()) warnings.push(`Ignoring invalid ${envName}.`);
  }

  const envCapabilities = parseAllowedList(
    env[ENV.allowedCapabilities],
    CAPABILITIES,
  );
  if (envCapabilities) normalizedEnv.allowedCapabilities = envCapabilities;
  else if (env[ENV.allowedCapabilities]?.trim()) {
    warnings.push(`Ignoring invalid ${ENV.allowedCapabilities}.`);
  }

  const envThinking = parseAllowedList(
    env[ENV.allowedThinkingLevels],
    THINKING_LEVELS,
  );
  if (envThinking) normalizedEnv.allowedThinkingLevels = envThinking;
  else if (env[ENV.allowedThinkingLevels]?.trim()) {
    warnings.push(`Ignoring invalid ${ENV.allowedThinkingLevels}.`);
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
