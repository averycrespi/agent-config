import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";

export type GoalConfig = {
  injectActiveGoal: boolean;
  showWidget: boolean;
  objectiveMaxChars: number;
  evidenceMaxChars: number;
  compactSummaryEnabled: boolean;
  checkpointCommits: boolean;
  showUsage: boolean;
  autoRunEnabled: boolean;
  autoRunMaxTurns: number;
  autoRunMaxActiveMinutes: number;
};

type PlainObject = Record<string, unknown>;

export const DEFAULT_GOAL_CONFIG: GoalConfig = {
  injectActiveGoal: true,
  showWidget: true,
  objectiveMaxChars: 4000,
  evidenceMaxChars: 4000,
  compactSummaryEnabled: true,
  checkpointCommits: true,
  showUsage: true,
  autoRunEnabled: true,
  autoRunMaxTurns: 10,
  autoRunMaxActiveMinutes: 60,
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
  if (parsed !== undefined && Number.isInteger(parsed) && parsed > 0)
    return parsed;
  if (value !== undefined)
    warnings.push(`Ignoring invalid ${field}: ${String(value)}`);
  return fallback;
}

function readEnvSettings(
  env: NodeJS.ProcessEnv,
  warnings: string[],
): PlainObject {
  return {
    ...(parseBooleanEnv(
      env.GOAL_INJECT_ACTIVE_GOAL,
      "GOAL_INJECT_ACTIVE_GOAL",
      warnings,
    ) !== undefined
      ? {
          injectActiveGoal: parseBooleanEnv(
            env.GOAL_INJECT_ACTIVE_GOAL,
            "GOAL_INJECT_ACTIVE_GOAL",
            warnings,
          ),
        }
      : {}),
    ...(parseBooleanEnv(env.GOAL_SHOW_WIDGET, "GOAL_SHOW_WIDGET", warnings) !==
    undefined
      ? {
          showWidget: parseBooleanEnv(
            env.GOAL_SHOW_WIDGET,
            "GOAL_SHOW_WIDGET",
            warnings,
          ),
        }
      : {}),
    ...(env.GOAL_OBJECTIVE_MAX_CHARS !== undefined
      ? { objectiveMaxChars: env.GOAL_OBJECTIVE_MAX_CHARS }
      : {}),
    ...(env.GOAL_EVIDENCE_MAX_CHARS !== undefined
      ? { evidenceMaxChars: env.GOAL_EVIDENCE_MAX_CHARS }
      : {}),
    ...(parseBooleanEnv(
      env.GOAL_COMPACT_SUMMARY_ENABLED,
      "GOAL_COMPACT_SUMMARY_ENABLED",
      warnings,
    ) !== undefined
      ? {
          compactSummaryEnabled: parseBooleanEnv(
            env.GOAL_COMPACT_SUMMARY_ENABLED,
            "GOAL_COMPACT_SUMMARY_ENABLED",
            warnings,
          ),
        }
      : {}),
    ...(parseBooleanEnv(
      env.GOAL_CHECKPOINT_COMMITS,
      "GOAL_CHECKPOINT_COMMITS",
      warnings,
    ) !== undefined
      ? {
          checkpointCommits: parseBooleanEnv(
            env.GOAL_CHECKPOINT_COMMITS,
            "GOAL_CHECKPOINT_COMMITS",
            warnings,
          ),
        }
      : {}),
    ...(parseBooleanEnv(env.GOAL_SHOW_USAGE, "GOAL_SHOW_USAGE", warnings) !==
    undefined
      ? {
          showUsage: parseBooleanEnv(
            env.GOAL_SHOW_USAGE,
            "GOAL_SHOW_USAGE",
            warnings,
          ),
        }
      : {}),
    ...(parseBooleanEnv(
      env.GOAL_AUTO_RUN_ENABLED,
      "GOAL_AUTO_RUN_ENABLED",
      warnings,
    ) !== undefined
      ? {
          autoRunEnabled: parseBooleanEnv(
            env.GOAL_AUTO_RUN_ENABLED,
            "GOAL_AUTO_RUN_ENABLED",
            warnings,
          ),
        }
      : {}),
    ...(env.GOAL_AUTO_RUN_MAX_TURNS !== undefined
      ? { autoRunMaxTurns: env.GOAL_AUTO_RUN_MAX_TURNS }
      : {}),
    ...(env.GOAL_AUTO_RUN_MAX_ACTIVE_MINUTES !== undefined
      ? { autoRunMaxActiveMinutes: env.GOAL_AUTO_RUN_MAX_ACTIVE_MINUTES }
      : {}),
  };
}

export function parseGoalConfig(options: {
  settings?: PlainObject;
  env?: NodeJS.ProcessEnv;
  warnings?: string[];
}): GoalConfig {
  const warnings = options.warnings ?? [];
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_GOAL_CONFIG,
    projectSettings: options.settings,
    envSettings: readEnvSettings(options.env ?? process.env, warnings),
  });

  return {
    injectActiveGoal:
      typeof merged.injectActiveGoal === "boolean"
        ? merged.injectActiveGoal
        : DEFAULT_GOAL_CONFIG.injectActiveGoal,
    showWidget:
      typeof merged.showWidget === "boolean"
        ? merged.showWidget
        : DEFAULT_GOAL_CONFIG.showWidget,
    objectiveMaxChars: parsePositiveInteger(
      merged.objectiveMaxChars,
      "objectiveMaxChars",
      DEFAULT_GOAL_CONFIG.objectiveMaxChars,
      warnings,
    ),
    evidenceMaxChars: parsePositiveInteger(
      merged.evidenceMaxChars,
      "evidenceMaxChars",
      DEFAULT_GOAL_CONFIG.evidenceMaxChars,
      warnings,
    ),
    compactSummaryEnabled:
      typeof merged.compactSummaryEnabled === "boolean"
        ? merged.compactSummaryEnabled
        : DEFAULT_GOAL_CONFIG.compactSummaryEnabled,
    checkpointCommits:
      typeof merged.checkpointCommits === "boolean"
        ? merged.checkpointCommits
        : DEFAULT_GOAL_CONFIG.checkpointCommits,
    showUsage:
      typeof merged.showUsage === "boolean"
        ? merged.showUsage
        : DEFAULT_GOAL_CONFIG.showUsage,
    autoRunEnabled:
      typeof merged.autoRunEnabled === "boolean"
        ? merged.autoRunEnabled
        : DEFAULT_GOAL_CONFIG.autoRunEnabled,
    autoRunMaxTurns: parsePositiveInteger(
      merged.autoRunMaxTurns,
      "autoRunMaxTurns",
      DEFAULT_GOAL_CONFIG.autoRunMaxTurns,
      warnings,
    ),
    autoRunMaxActiveMinutes: parsePositiveInteger(
      merged.autoRunMaxActiveMinutes,
      "autoRunMaxActiveMinutes",
      DEFAULT_GOAL_CONFIG.autoRunMaxActiveMinutes,
      warnings,
    ),
  };
}

export async function loadGoalConfig(cwd: string): Promise<{
  config: GoalConfig;
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
    globalSettings: readExtensionSettings(globalSettings, "goal"),
    projectSettings: readExtensionSettings(projectSettings, "goal"),
  });
  return { config: parseGoalConfig({ settings, warnings }), warnings };
}
