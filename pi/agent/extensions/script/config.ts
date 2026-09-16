import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { validName } from "./provider.ts";

export type ScriptConfig = {
  maxCalls: number;
  maxConcurrency: number;
  timeoutMs: number;
  valid: boolean;
  allowedProviders: string[];
};
export const DEFAULT_CONFIG: ScriptConfig = {
  maxCalls: 32,
  maxConcurrency: 4,
  timeoutMs: 120_000,
  valid: true,
  allowedProviders: [],
};
export const MAX_LIMITS = {
  maxCalls: 128,
  maxConcurrency: 16,
  timeoutMs: 300_000,
};
export function parseConfig(
  settings: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): ScriptConfig {
  const result = { ...DEFAULT_CONFIG };
  const overrides = {
    maxCalls: "SCRIPT_MAX_CALLS",
    maxConcurrency: "SCRIPT_MAX_CONCURRENCY",
    timeoutMs: "SCRIPT_TIMEOUT_MS",
  };
  for (const key of Object.keys(overrides) as Array<keyof typeof overrides>) {
    const raw =
      env[overrides[key]] ??
      (settings[key] === undefined ? DEFAULT_CONFIG[key] : settings[key]);
    const value =
      typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_LIMITS[key]
    )
      result.valid = false;
    else result[key] = value;
  }
  try {
    const allowed =
      env.SCRIPT_ALLOWED_PROVIDERS === undefined
        ? (settings.allowedProviders ?? [])
        : JSON.parse(env.SCRIPT_ALLOWED_PROVIDERS);
    if (
      !Array.isArray(allowed) ||
      allowed.length > 32 ||
      allowed.some((v) => !validName(v)) ||
      new Set(allowed).size !== allowed.length
    )
      result.valid = false;
    else result.allowedProviders = [...allowed];
    if (
      Object.hasOwn(settings, "allowedProviders") &&
      settings.allowedProviders === null &&
      env.SCRIPT_ALLOWED_PROVIDERS === undefined
    )
      result.valid = false;
  } catch {
    result.valid = false;
  }
  return result;
}
export async function loadScriptConfig(
  _cwd: string,
  warnings: string[] = [],
  signal?: AbortSignal,
): Promise<ScriptConfig> {
  let config: ScriptConfig;
  try {
    const root: unknown = JSON.parse(
      await readFile(join(getAgentDir(), "settings.json"), {
        encoding: "utf8",
        signal,
      }),
    );
    if (!root || typeof root !== "object" || Array.isArray(root))
      throw new Error("invalid_settings");
    const settings = Object.hasOwn(root, "extension:script")
      ? (root as Record<string, unknown>)["extension:script"]
      : {};
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new Error("invalid_settings");
    config = parseConfig(settings as Record<string, unknown>);
  } catch (error) {
    config =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? parseConfig()
        : { ...DEFAULT_CONFIG, valid: false };
  }
  if (!config.valid)
    warnings.push(
      "Script disabled: invalid global settings, provider policy, or finite limits.",
    );
  return config;
}
