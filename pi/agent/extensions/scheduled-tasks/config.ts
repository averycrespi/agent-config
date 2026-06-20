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
}

export const DEFAULT_CONFIG: ScheduledTasksConfig = {
  rootDir: "~/.pi/scheduled-tasks",
  defaultTimeoutMinutes: 30,
  defaultTools: ["read", "grep", "find", "ls"],
  piCommand: "pi",
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

  return {
    rootDir: resolveRoot(rootDir),
    defaultTimeoutMinutes,
    defaultTools,
    piCommand,
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
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG as unknown as Record<string, unknown>,
    globalSettings: readExtensionSettings(globalSettings, EXTENSION_NAME),
    projectSettings: readExtensionSettings(projectSettings, EXTENSION_NAME),
    envSettings: envSettings(process.env, warnings),
  });
  return normalizeConfig(merged, warnings);
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
