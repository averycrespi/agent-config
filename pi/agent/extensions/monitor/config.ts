import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_CONFIG = {
  maxActive: 4,
  maxConcurrentPolls: 2,
  intervalMs: 30_000,
  timeoutMs: 1_800_000,
  pollTimeoutMs: 30_000,
  failureLimit: 3,
  maxCalls: 8,
  maxCallConcurrency: 2,
  receiptLimit: 32,
};
export type Limits = typeof DEFAULT_CONFIG;
export type MonitorConfig = Limits & { valid: boolean };
export const RANGES: Record<keyof Limits, readonly [number, number]> = {
  maxActive: [1, 16],
  maxConcurrentPolls: [1, 4],
  intervalMs: [1000, 3_600_000],
  timeoutMs: [1000, 86_400_000],
  pollTimeoutMs: [1, 300_000],
  failureLimit: [1, 20],
  maxCalls: [1, 128],
  maxCallConcurrency: [1, 16],
  receiptLimit: [16, 128],
};
export const ENV: Record<keyof Limits, string> = {
  maxActive: "MONITOR_MAX_ACTIVE",
  maxConcurrentPolls: "MONITOR_MAX_CONCURRENT_POLLS",
  intervalMs: "MONITOR_INTERVAL_MS",
  timeoutMs: "MONITOR_TIMEOUT_MS",
  pollTimeoutMs: "MONITOR_POLL_TIMEOUT_MS",
  failureLimit: "MONITOR_FAILURE_LIMIT",
  maxCalls: "MONITOR_MAX_CALLS",
  maxCallConcurrency: "MONITOR_MAX_CALL_CONCURRENCY",
  receiptLimit: "MONITOR_RECEIPT_LIMIT",
};
export function inRange(key: keyof Limits, value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= RANGES[key][0] &&
    value <= RANGES[key][1]
  );
}
export function parseConfig(
  settings: unknown = {},
  env: NodeJS.ProcessEnv = process.env,
): MonitorConfig {
  const config = { ...DEFAULT_CONFIG, valid: true };
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return { ...config, valid: false };
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof Limits>) {
    const stored = (settings as Record<string, unknown>)[key];
    const raw =
      env[ENV[key]] ?? (stored === undefined ? DEFAULT_CONFIG[key] : stored);
    const value =
      typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (!inRange(key, value)) config.valid = false;
    else config[key] = value;
  }
  return config;
}
export async function loadMonitorConfig(
  _cwd: string,
  warnings: string[] = [],
): Promise<MonitorConfig> {
  let config: MonitorConfig;
  try {
    const root: unknown = JSON.parse(
      await readFile(join(getAgentDir(), "settings.json"), "utf8"),
    );
    config =
      root && typeof root === "object" && !Array.isArray(root)
        ? parseConfig(
            Object.hasOwn(root, "extension:monitor")
              ? (root as Record<string, unknown>)["extension:monitor"]
              : {},
          )
        : { ...DEFAULT_CONFIG, valid: false };
  } catch (error) {
    config =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? parseConfig()
        : { ...DEFAULT_CONFIG, valid: false };
  }
  if (!config.valid)
    warnings.push(
      "Monitor disabled: invalid global configuration or finite limits.",
    );
  return config;
}
