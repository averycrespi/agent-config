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
  profileFastModel: string;
  profileFastEffort: ThinkingLevel;
  profileBalancedModel: string;
  profileBalancedEffort: ThinkingLevel;
  profileStrongModel: string;
  profileStrongEffort: ThinkingLevel;
  allowedCapabilities: Capability[];
};

export const DEFAULT_SUBAGENTS_CONFIG: SubagentsConfig = {
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  profileFastModel: "openai-codex/gpt-5.6-luna",
  profileFastEffort: "high",
  profileBalancedModel: "openai-codex/gpt-5.6-terra",
  profileBalancedEffort: "high",
  profileStrongModel: "openai-codex/gpt-5.6-sol",
  profileStrongEffort: "high",
  allowedCapabilities: [...CAPABILITIES],
};

const EXTENSION_NAME = "subagents";
const ENV = {
  maxConcurrency: "SUBAGENTS_MAX_CONCURRENCY",
  profileFastModel: "SUBAGENTS_PROFILE_FAST_MODEL",
  profileFastEffort: "SUBAGENTS_PROFILE_FAST_EFFORT",
  profileBalancedModel: "SUBAGENTS_PROFILE_BALANCED_MODEL",
  profileBalancedEffort: "SUBAGENTS_PROFILE_BALANCED_EFFORT",
  profileStrongModel: "SUBAGENTS_PROFILE_STRONG_MODEL",
  profileStrongEffort: "SUBAGENTS_PROFILE_STRONG_EFFORT",
  allowedCapabilities: "SUBAGENTS_ALLOWED_CAPABILITIES",
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

  for (const [legacyField, profileField] of [
    ["modelTierSmall", "profileFastModel"],
    ["modelTierMedium", "profileBalancedModel"],
    ["modelTierLarge", "profileStrongModel"],
  ] as const) {
    if (globalSettings[legacyField] === undefined) continue;
    warnings.push(
      `${legacyField} is deprecated; use ${profileField} under extension:subagents.`,
    );
    if (globalSettings[profileField] !== undefined) continue;
    const value = parseModelSelector(globalSettings[legacyField]);
    if (value) normalizedGlobal[profileField] = value;
    else warnings.push(`Ignoring invalid global ${legacyField}.`);
  }

  for (const field of [
    "profileFastModel",
    "profileBalancedModel",
    "profileStrongModel",
  ] as const) {
    const value = parseModelSelector(globalSettings[field]);
    if (value) normalizedGlobal[field] = value;
    else if (globalSettings[field] !== undefined) {
      warnings.push(`Ignoring invalid global ${field}; using fallback.`);
    }
  }

  for (const field of [
    "profileFastEffort",
    "profileBalancedEffort",
    "profileStrongEffort",
  ] as const) {
    const value = globalSettings[field];
    if (
      typeof value === "string" &&
      THINKING_LEVELS.includes(value as ThinkingLevel)
    ) {
      normalizedGlobal[field] = value;
    } else if (value !== undefined) {
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

  for (const field of [
    "allowedEffortLevels",
    "allowedThinkingLevels",
  ] as const) {
    if (globalSettings[field] !== undefined) {
      warnings.push(
        `${field} was removed; configure effort directly on each subagent profile.`,
      );
    }
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

  for (const [legacyEnv, profileField] of [
    ["SUBAGENTS_MODEL_TIER_SMALL", "profileFastModel"],
    ["SUBAGENTS_MODEL_TIER_MEDIUM", "profileBalancedModel"],
    ["SUBAGENTS_MODEL_TIER_LARGE", "profileStrongModel"],
  ] as const) {
    const raw = env[legacyEnv];
    if (!raw?.trim()) continue;
    warnings.push(`${legacyEnv} is deprecated; use ${ENV[profileField]}.`);
    if (env[ENV[profileField]]?.trim()) continue;
    const value = parseModelSelector(raw);
    if (value) normalizedEnv[profileField] = value;
    else warnings.push(`Ignoring invalid ${legacyEnv}.`);
  }

  for (const field of [
    "profileFastModel",
    "profileBalancedModel",
    "profileStrongModel",
  ] as const) {
    const envName = ENV[field];
    const raw = env[envName];
    const value = parseModelSelector(raw);
    if (value) normalizedEnv[field] = value;
    else if (raw?.trim()) warnings.push(`Ignoring invalid ${envName}.`);
  }

  for (const field of [
    "profileFastEffort",
    "profileBalancedEffort",
    "profileStrongEffort",
  ] as const) {
    const envName = ENV[field];
    const raw = env[envName];
    if (raw && THINKING_LEVELS.includes(raw as ThinkingLevel)) {
      normalizedEnv[field] = raw;
    } else if (raw?.trim()) {
      warnings.push(`Ignoring invalid ${envName}.`);
    }
  }

  const envCapabilities = parseAllowedList(
    env[ENV.allowedCapabilities],
    CAPABILITIES,
  );
  if (envCapabilities) normalizedEnv.allowedCapabilities = envCapabilities;
  else if (env[ENV.allowedCapabilities]?.trim()) {
    warnings.push(`Ignoring invalid ${ENV.allowedCapabilities}.`);
  }

  for (const envName of [
    "SUBAGENTS_ALLOWED_EFFORT_LEVELS",
    "SUBAGENTS_ALLOWED_THINKING_LEVELS",
  ] as const) {
    if (env[envName]?.trim()) {
      warnings.push(
        `${envName} was removed; configure effort directly on each subagent profile.`,
      );
    }
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
