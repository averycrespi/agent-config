import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Reserve the session transport's two-second expiry grace within Node's timer range.
export const MAX_DURATION_MS = 2_147_483_647 - 2000;
export type MonitorConfig = {
  maxCycleTimeoutMs: number;
  maxLifetimeMs: number;
  valid: boolean;
};
export const DEFAULT_CONFIG: Readonly<MonitorConfig> = Object.freeze({
  maxCycleTimeoutMs: 1_680_000,
  maxLifetimeMs: 86_400_000,
  valid: true,
});
export const CONFIG_WARNING =
  "Monitor starts disabled: invalid or conflicting global settings or finite limits. Fix configuration and reload; inspection and cancellation remain available.";
export const LEGACY_WARNING =
  "Legacy Background observer configuration detected. Rename extension:background and BACKGROUND_* overrides to extension:monitor and MONITOR_* under explicit installation/reload authority; no live work is migrated.";
const overrides = {
  maxCycleTimeoutMs: "MAX_CYCLE_TIMEOUT_MS",
  maxLifetimeMs: "MAX_LIFETIME_MS",
};
const number = (raw: unknown) =>
  typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const warnLegacy = (warnings: string[]) => {
  if (!warnings.includes(LEGACY_WARNING)) warnings.push(LEGACY_WARNING);
};
export function parseConfig(
  settings: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): MonitorConfig {
  const result = { ...DEFAULT_CONFIG };
  if (Object.keys(settings).some((key) => !Object.hasOwn(overrides, key)))
    result.valid = false;
  for (const key of Object.keys(overrides) as Array<keyof typeof overrides>) {
    const modern = env[`MONITOR_${overrides[key]}`];
    const legacy = env[`BACKGROUND_${overrides[key]}`];
    if (legacy !== undefined) warnLegacy(warnings);
    if (
      modern !== undefined &&
      legacy !== undefined &&
      number(modern) !== number(legacy)
    )
      result.valid = false;
    const raw =
      modern ??
      legacy ??
      (settings[key] === undefined ? DEFAULT_CONFIG[key] : settings[key]);
    const value = number(raw);
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
export function parseGlobalConfig(
  root: unknown,
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): MonitorConfig {
  if (!object(root)) return { ...DEFAULT_CONFIG, valid: false };
  const hasLegacy = Object.hasOwn(root, "extension:background");
  const background = hasLegacy ? root["extension:background"] : {};
  // Background now owns widgets; only the remaining fields are legacy policy.
  const legacy = object(background)
    ? Object.fromEntries(
        Object.entries(background).filter(([key]) => key !== "widgets"),
      )
    : background;
  if (
    hasLegacy &&
    (!object(background) ||
      !Object.hasOwn(background, "widgets") ||
      (object(legacy) && Object.keys(legacy).length > 0))
  )
    warnLegacy(warnings);
  const modern = Object.hasOwn(root, "extension:monitor")
    ? root["extension:monitor"]
    : {};
  if (!object(legacy) || !object(modern))
    return { ...DEFAULT_CONFIG, valid: false };
  const result = parseConfig({ ...legacy, ...modern }, env, warnings);
  // Detect alias conflicts before environment precedence can conceal them.
  for (const key of Object.keys(legacy)) {
    if (
      Object.hasOwn(modern, key) &&
      number(legacy[key]) !== number(modern[key])
    )
      result.valid = false;
  }
  return result;
}
export async function loadMonitorConfig(
  warnings: string[] = [],
): Promise<MonitorConfig> {
  try {
    return parseGlobalConfig(
      JSON.parse(await readFile(join(getAgentDir(), "settings.json"), "utf8")),
      process.env,
      warnings,
    );
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? parseConfig({}, process.env, warnings)
      : { ...DEFAULT_CONFIG, valid: false };
  }
}
