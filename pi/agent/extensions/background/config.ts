import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Reserve the session transport's two-second expiry grace within Node's timer range.
export const MAX_DURATION_MS = 2_147_483_647 - 2000;
export type BackgroundConfig = {
  maxCycleTimeoutMs: number;
  maxLifetimeMs: number;
  valid: boolean;
};
export const DEFAULT_CONFIG: Readonly<BackgroundConfig> = Object.freeze({
  maxCycleTimeoutMs: 1_680_000,
  maxLifetimeMs: 86_400_000,
  valid: true,
});
export const CONFIG_WARNING =
  "Background starts disabled: invalid global settings or finite limits. Fix configuration and reload; inspection and cancellation remain available.";
export function parseConfig(
  settings: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): BackgroundConfig {
  const result = { ...DEFAULT_CONFIG };
  const overrides = {
    maxCycleTimeoutMs: "BACKGROUND_MAX_CYCLE_TIMEOUT_MS",
    maxLifetimeMs: "BACKGROUND_MAX_LIFETIME_MS",
  };
  if (Object.keys(settings).some((key) => !Object.hasOwn(overrides, key)))
    result.valid = false;
  for (const key of Object.keys(overrides) as Array<keyof typeof overrides>) {
    const raw =
      env[overrides[key]] ??
      (settings[key] === undefined ? DEFAULT_CONFIG[key] : settings[key]);
    const value =
      typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1000 ||
      value > MAX_DURATION_MS
    )
      result.valid = false;
    else result[key] = value;
  }
  return result;
}
export async function loadBackgroundConfig(): Promise<BackgroundConfig> {
  try {
    const root: unknown = JSON.parse(
      await readFile(join(getAgentDir(), "settings.json"), "utf8"),
    );
    if (!root || typeof root !== "object" || Array.isArray(root))
      throw new Error();
    const settings = Object.hasOwn(root, "extension:background")
      ? (root as Record<string, unknown>)["extension:background"]
      : {};
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new Error();
    return parseConfig(settings as Record<string, unknown>);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? parseConfig()
      : { ...DEFAULT_CONFIG, valid: false };
  }
}
