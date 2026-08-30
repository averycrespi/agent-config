import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";

export type LoopConfig = {
  showWidget: boolean;
  defaultMaxContinuations: number;
  defaultMaxActiveMinutes: number;
  hardMaxContinuations: number;
  hardMaxActiveMinutes: number;
  messageMaxChars: number;
  reasonMaxChars: number;
};

type PlainObject = Record<string, unknown>;

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  showWidget: true,
  defaultMaxContinuations: 10,
  defaultMaxActiveMinutes: 60,
  hardMaxContinuations: 100,
  hardMaxActiveMinutes: 480,
  messageMaxChars: 4_000,
  reasonMaxChars: 1_000,
};

function parsePositiveInteger(
  value: unknown,
  field: string,
  fallback: number,
  warnings: string[],
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : undefined;
  if (parsed !== undefined && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  if (value !== undefined) {
    warnings.push(`Ignoring invalid ${field}: ${String(value)}`);
  }
  return fallback;
}

function readEnvSettings(
  env: NodeJS.ProcessEnv,
  warnings: string[],
): PlainObject {
  const showWidget = parseBooleanEnv(
    env.LOOP_SHOW_WIDGET,
    "LOOP_SHOW_WIDGET",
    warnings,
  );
  return {
    ...(showWidget !== undefined ? { showWidget } : {}),
    ...(env.LOOP_DEFAULT_MAX_CONTINUATIONS !== undefined
      ? { defaultMaxContinuations: env.LOOP_DEFAULT_MAX_CONTINUATIONS }
      : {}),
    ...(env.LOOP_DEFAULT_MAX_ACTIVE_MINUTES !== undefined
      ? { defaultMaxActiveMinutes: env.LOOP_DEFAULT_MAX_ACTIVE_MINUTES }
      : {}),
    ...(env.LOOP_HARD_MAX_CONTINUATIONS !== undefined
      ? { hardMaxContinuations: env.LOOP_HARD_MAX_CONTINUATIONS }
      : {}),
    ...(env.LOOP_HARD_MAX_ACTIVE_MINUTES !== undefined
      ? { hardMaxActiveMinutes: env.LOOP_HARD_MAX_ACTIVE_MINUTES }
      : {}),
    ...(env.LOOP_MESSAGE_MAX_CHARS !== undefined
      ? { messageMaxChars: env.LOOP_MESSAGE_MAX_CHARS }
      : {}),
    ...(env.LOOP_REASON_MAX_CHARS !== undefined
      ? { reasonMaxChars: env.LOOP_REASON_MAX_CHARS }
      : {}),
  };
}

export function parseLoopConfig(options: {
  settings?: PlainObject;
  env?: NodeJS.ProcessEnv;
  warnings?: string[];
}): LoopConfig {
  const warnings = options.warnings ?? [];
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_LOOP_CONFIG,
    projectSettings: options.settings,
    envSettings: readEnvSettings(options.env ?? process.env, warnings),
  });

  const hardMaxContinuations = parsePositiveInteger(
    merged.hardMaxContinuations,
    "hardMaxContinuations",
    DEFAULT_LOOP_CONFIG.hardMaxContinuations,
    warnings,
  );
  const hardMaxActiveMinutes = parsePositiveInteger(
    merged.hardMaxActiveMinutes,
    "hardMaxActiveMinutes",
    DEFAULT_LOOP_CONFIG.hardMaxActiveMinutes,
    warnings,
  );
  const configuredDefaultContinuations = parsePositiveInteger(
    merged.defaultMaxContinuations,
    "defaultMaxContinuations",
    DEFAULT_LOOP_CONFIG.defaultMaxContinuations,
    warnings,
  );
  const configuredDefaultMinutes = parsePositiveInteger(
    merged.defaultMaxActiveMinutes,
    "defaultMaxActiveMinutes",
    DEFAULT_LOOP_CONFIG.defaultMaxActiveMinutes,
    warnings,
  );

  if (configuredDefaultContinuations > hardMaxContinuations) {
    warnings.push(
      `defaultMaxContinuations exceeds hardMaxContinuations; using ${hardMaxContinuations}.`,
    );
  }
  if (configuredDefaultMinutes > hardMaxActiveMinutes) {
    warnings.push(
      `defaultMaxActiveMinutes exceeds hardMaxActiveMinutes; using ${hardMaxActiveMinutes}.`,
    );
  }

  return {
    showWidget:
      typeof merged.showWidget === "boolean"
        ? merged.showWidget
        : DEFAULT_LOOP_CONFIG.showWidget,
    defaultMaxContinuations: Math.min(
      configuredDefaultContinuations,
      hardMaxContinuations,
    ),
    defaultMaxActiveMinutes: Math.min(
      configuredDefaultMinutes,
      hardMaxActiveMinutes,
    ),
    hardMaxContinuations,
    hardMaxActiveMinutes,
    messageMaxChars: parsePositiveInteger(
      merged.messageMaxChars,
      "messageMaxChars",
      DEFAULT_LOOP_CONFIG.messageMaxChars,
      warnings,
    ),
    reasonMaxChars: parsePositiveInteger(
      merged.reasonMaxChars,
      "reasonMaxChars",
      DEFAULT_LOOP_CONFIG.reasonMaxChars,
      warnings,
    ),
  };
}

export async function loadLoopConfig(cwd: string): Promise<{
  config: LoopConfig;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  const settings = mergeExtensionConfig({
    defaults: {},
    globalSettings: readExtensionSettings(globalSettings, "loop"),
    projectSettings: readExtensionSettings(projectSettings, "loop"),
  });
  return { config: parseLoopConfig({ settings, warnings }), warnings };
}
