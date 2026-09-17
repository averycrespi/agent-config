import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
} from "../_shared/config.ts";

export type IdleConfig = {
  enabled: boolean;
  idleMinutes: number;
  contextPercent: number;
  valid: boolean;
};

export const DEFAULT_CONFIG: IdleConfig = {
  enabled: false,
  idleMinutes: 29,
  contextPercent: 40,
  valid: true,
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseConfig(
  settings: unknown,
  env: NodeJS.ProcessEnv,
  warnings: string[] = [],
): IdleConfig {
  let valid = true;
  const invalid = (field: string) => {
    valid = false;
    warnings.push(`idle-compaction disabled: invalid ${field}.`);
  };
  if (!object(settings)) invalid("global settings object");
  const section = object(settings)
    ? settings["extension:idle-compaction"]
    : undefined;
  if (section !== undefined && !object(section))
    invalid("extension settings object");
  const overrides: Record<string, unknown> = {};
  for (const [field, name] of [
    ["enabled", "IDLE_COMPACTION_ENABLED"],
    ["idleMinutes", "IDLE_COMPACTION_IDLE_MINUTES"],
    ["contextPercent", "IDLE_COMPACTION_CONTEXT_PERCENT"],
  ] as const) {
    const value = env[name];
    if (value === undefined) continue;
    if (field === "enabled") {
      const parsed = parseBooleanEnv(value);
      if (parsed === undefined) invalid(name);
      else overrides[field] = parsed;
    } else {
      overrides[field] = value.trim() === "" ? NaN : Number(value);
    }
  }
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG,
    globalSettings: readExtensionSettings(settings, "idle-compaction"),
    envSettings: overrides,
  });
  if (typeof merged.enabled !== "boolean")
    invalid("enabled (boolean required)");
  if (
    typeof merged.idleMinutes !== "number" ||
    !Number.isFinite(merged.idleMinutes) ||
    merged.idleMinutes <= 0 ||
    merged.idleMinutes > 10080
  )
    invalid("idleMinutes (greater than 0, at most 10080)");
  if (
    typeof merged.contextPercent !== "number" ||
    !Number.isFinite(merged.contextPercent) ||
    merged.contextPercent < 0 ||
    merged.contextPercent > 100
  )
    invalid("contextPercent (0 through 100)");
  return valid
    ? {
        enabled: merged.enabled,
        idleMinutes: merged.idleMinutes,
        contextPercent: merged.contextPercent,
        valid: true,
      }
    : { ...DEFAULT_CONFIG, valid: false };
}

// Global opt-in deliberately cannot be enabled by project-local settings.
export async function loadConfig(
  warnings: string[] = [],
  agentDir = getAgentDir(),
  env = process.env,
): Promise<IdleConfig> {
  let settings: unknown = {};
  try {
    settings = JSON.parse(
      await readFile(join(agentDir, "settings.json"), "utf8"),
    );
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      warnings.push(
        "idle-compaction disabled: global settings could not be read as JSON.",
      );
      return { ...DEFAULT_CONFIG, valid: false };
    }
  }
  return parseConfig(settings, env, warnings);
}
