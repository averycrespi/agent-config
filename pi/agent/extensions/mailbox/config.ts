import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  readPiSettingsFiles,
  readExtensionSettings,
  mergeExtensionConfig,
} from "../_shared/config.ts";
export const DEFAULTS = {
  batchWindowMs: 5000,
  visibilityTimeoutMs: 300000,
  maxDeliveryAttempts: 3,
};
export type DeliveryConfig = typeof DEFAULTS;
export function validateConfig(input: Record<string, unknown>): DeliveryConfig {
  const limits = {
    batchWindowMs: [0, 86400000],
    visibilityTimeoutMs: [1000, 86400000],
    maxDeliveryAttempts: [1, 100],
  };
  if (Object.keys(input).some((k) => !(k in limits)))
    throw new Error("Invalid mailbox configuration");
  const value = { ...DEFAULTS, ...input };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const v = value[key as keyof DeliveryConfig];
    if (!Number.isSafeInteger(v) || v < min || v > max)
      throw new Error("Invalid mailbox configuration");
  }
  return value;
}
export async function loadConfig(cwd: string): Promise<DeliveryConfig> {
  const warnings: string[] = [];
  const files = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  if (warnings.length) throw new Error("Invalid mailbox settings file");
  const envSettings: Record<string, unknown> = {};
  for (const [key, env] of Object.entries({
    batchWindowMs: "PI_MAILBOX_BATCH_WINDOW_MS",
    visibilityTimeoutMs: "PI_MAILBOX_VISIBILITY_TIMEOUT_MS",
    maxDeliveryAttempts: "PI_MAILBOX_MAX_DELIVERY_ATTEMPTS",
  })) {
    if (process.env[env] !== undefined)
      envSettings[key] = /^\d+$/.test(process.env[env]!)
        ? Number(process.env[env])
        : NaN;
  }
  for (const file of Object.values(files)) {
    const section = file["extension:mailbox"];
    if (
      section !== undefined &&
      (!section || typeof section !== "object" || Array.isArray(section))
    )
      throw new Error("Invalid mailbox configuration");
  }
  return validateConfig(
    mergeExtensionConfig({
      defaults: DEFAULTS,
      globalSettings: readExtensionSettings(files.globalSettings, "mailbox"),
      projectSettings: readExtensionSettings(files.projectSettings, "mailbox"),
      envSettings,
    }),
  );
}
