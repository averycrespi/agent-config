import { access } from "node:fs/promises";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeExtensionConfig,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";
import { resolveRoot } from "./paths.ts";

export const EXTENSION_NAME = "scheduled-tasks";

export interface ScheduledTasksConfig {
  rootDir: string;
  defaultTimeoutMinutes: number;
  defaultTools: string[];
  piCommand: string;
  cronEnvironment: Record<string, string>;
}

export const DEFAULT_CONFIG: ScheduledTasksConfig = {
  rootDir: "~/.pi/scheduled-tasks",
  defaultTimeoutMinutes: 30,
  defaultTools: ["read", "grep", "find", "ls"],
  piCommand: "pi",
  cronEnvironment: {},
};

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function isValidEnvName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function parseCronEnvironment(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value);
  const parsed: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!isValidEnvName(key) || typeof item !== "string") return undefined;
    parsed[key] = item;
  }
  return parsed;
}

function parseCronEnvironmentJson(
  value: string | undefined,
  warnings: string[],
): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed = parseCronEnvironment(JSON.parse(value));
    if (parsed) return parsed;
  } catch {
    // warning below
  }
  warnings.push(
    "Ignoring invalid SCHEDULED_TASKS_CRON_ENVIRONMENT; expected a JSON object of string environment values.",
  );
  return undefined;
}

export function mergeCronEnvironment(
  ...values: unknown[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const value of values) {
    const parsed = parseCronEnvironment(value);
    if (parsed) Object.assign(merged, parsed);
  }
  return merged;
}

function parseTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tools = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return tools.length === value.length ? [...new Set(tools)] : undefined;
  }
  if (typeof value === "string") {
    if (value.trim() === "") return [];
    return [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }
  return undefined;
}

function envSettings(
  env: NodeJS.ProcessEnv,
  warnings: string[],
): Partial<ScheduledTasksConfig> {
  const settings: Partial<ScheduledTasksConfig> = {};
  if (env.SCHEDULED_TASKS_ROOT_DIR)
    settings.rootDir = env.SCHEDULED_TASKS_ROOT_DIR;
  const timeout = parsePositiveNumber(
    env.SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES,
  );
  if (timeout !== undefined) settings.defaultTimeoutMinutes = timeout;
  else if (env.SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES)
    warnings.push("Ignoring invalid SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES.");
  const tools = parseTools(env.SCHEDULED_TASKS_DEFAULT_TOOLS);
  if (tools !== undefined) settings.defaultTools = tools;
  if (env.SCHEDULED_TASKS_PI_COMMAND)
    settings.piCommand = env.SCHEDULED_TASKS_PI_COMMAND;
  const cronEnvironment = parseCronEnvironmentJson(
    env.SCHEDULED_TASKS_CRON_ENVIRONMENT,
    warnings,
  );
  if (cronEnvironment !== undefined) settings.cronEnvironment = cronEnvironment;
  return settings;
}

export function normalizeConfig(
  raw: Record<string, unknown>,
  warnings: string[] = [],
): ScheduledTasksConfig {
  const rootDir =
    typeof raw.rootDir === "string" && raw.rootDir.trim()
      ? raw.rootDir
      : DEFAULT_CONFIG.rootDir;
  if (
    raw.rootDir !== undefined &&
    rootDir === DEFAULT_CONFIG.rootDir &&
    raw.rootDir !== DEFAULT_CONFIG.rootDir
  )
    warnings.push("Invalid rootDir; using default.");

  const defaultTimeoutMinutes =
    parsePositiveNumber(raw.defaultTimeoutMinutes) ??
    DEFAULT_CONFIG.defaultTimeoutMinutes;
  if (
    raw.defaultTimeoutMinutes !== undefined &&
    parsePositiveNumber(raw.defaultTimeoutMinutes) === undefined
  )
    warnings.push("Invalid defaultTimeoutMinutes; using default.");

  const defaultTools =
    parseTools(raw.defaultTools) ?? DEFAULT_CONFIG.defaultTools;
  if (
    raw.defaultTools !== undefined &&
    parseTools(raw.defaultTools) === undefined
  )
    warnings.push("Invalid defaultTools; using default.");

  const piCommand =
    typeof raw.piCommand === "string" && raw.piCommand.trim()
      ? raw.piCommand.trim()
      : DEFAULT_CONFIG.piCommand;

  const cronEnvironment =
    parseCronEnvironment(raw.cronEnvironment) ?? DEFAULT_CONFIG.cronEnvironment;
  if (
    raw.cronEnvironment !== undefined &&
    parseCronEnvironment(raw.cronEnvironment) === undefined
  )
    warnings.push("Invalid cronEnvironment; using default.");

  return {
    rootDir: resolveRoot(rootDir),
    defaultTimeoutMinutes,
    defaultTools,
    piCommand,
    cronEnvironment,
  };
}

export async function loadScheduledTasksConfig(
  cwd: string,
  warnings: string[] = [],
): Promise<ScheduledTasksConfig> {
  const agentDir = fileURLToPath(new URL("../../../", import.meta.url));
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir,
    cwd,
    warnings,
  });
  const globalExtensionSettings = readExtensionSettings(
    globalSettings,
    EXTENSION_NAME,
  );
  const projectExtensionSettings = readExtensionSettings(
    projectSettings,
    EXTENSION_NAME,
  );
  const environmentSettings = envSettings(process.env, warnings);
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG as unknown as Record<string, unknown>,
    globalSettings: globalExtensionSettings,
    projectSettings: projectExtensionSettings,
    envSettings: environmentSettings,
  });
  return normalizeConfig(
    {
      ...merged,
      cronEnvironment: mergeCronEnvironment(
        DEFAULT_CONFIG.cronEnvironment,
        globalExtensionSettings.cronEnvironment,
        projectExtensionSettings.cronEnvironment,
        environmentSettings.cronEnvironment,
      ),
    },
    warnings,
  );
}

export async function commandHealth(
  command: string,
): Promise<{ ok: boolean; warning?: string }> {
  if (command.includes("/") || command.startsWith(".")) {
    try {
      await access(command);
      return { ok: true };
    } catch {
      return {
        ok: false,
        warning: `Command path is not accessible: ${command}`,
      };
    }
  }
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      await access(`${dir}/${command}`);
      return {
        ok: true,
        warning: `Command ${command} relies on PATH resolution.`,
      };
    } catch {
      // try next PATH entry
    }
  }
  return { ok: false, warning: `Command ${command} was not found on PATH.` };
}
