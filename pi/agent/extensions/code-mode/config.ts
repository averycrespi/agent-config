import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
  readExtensionSettings,
  readJsonFileObject,
} from "../_shared/config.ts";

export type CodeConfig = {
  maxCalls: number;
  maxConcurrency: number;
  timeoutMs: number;
  valid: boolean;
};
export const DEFAULT_CONFIG: CodeConfig = {
  maxCalls: 32,
  maxConcurrency: 4,
  timeoutMs: 120_000,
  valid: true,
};
export const MAX_LIMITS = {
  maxCalls: 128,
  maxConcurrency: 16,
  timeoutMs: 300_000,
};
export function parseConfig(
  settings: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): CodeConfig {
  const result = { ...DEFAULT_CONFIG };
  const overrides = {
    maxCalls: "CODE_MODE_MAX_CALLS",
    maxConcurrency: "CODE_MODE_MAX_CONCURRENCY",
    timeoutMs: "CODE_MODE_TIMEOUT_MS",
  };
  for (const key of Object.keys(overrides) as Array<keyof typeof overrides>) {
    const raw = env[overrides[key]] ?? settings[key] ?? DEFAULT_CONFIG[key];
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
  return result;
}
export async function loadCodeConfig(
  _cwd: string,
  warnings: string[] = [],
): Promise<CodeConfig> {
  const errors: string[] = [];
  const settings = await readJsonFileObject(
    join(getAgentDir(), "settings.json"),
    errors,
  );
  const config = parseConfig(readExtensionSettings(settings, "code-mode"));
  if (errors.length) config.valid = false;
  if (!config.valid)
    warnings.push(
      "Code mode disabled: invalid global settings or finite limits.",
    );
  return config;
}
