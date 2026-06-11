import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

type PlainObject = Record<string, unknown>;

type ConfigCommandOptions<T extends PlainObject> = {
  extensionName: string;
  loadConfig: (cwd: string) => Promise<T> | T;
  sensitiveFields?: readonly string[];
};

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readExtensionSettings(
  settings: unknown,
  extensionName: string,
): PlainObject {
  if (!isPlainObject(settings)) return {};
  const value = settings[`extension:${extensionName}`];
  return isPlainObject(value) ? { ...value } : {};
}

export function mergeExtensionConfig<T extends PlainObject>(options: {
  defaults: T;
  globalSettings?: PlainObject;
  projectSettings?: PlainObject;
  envSettings?: PlainObject;
}): T {
  return {
    ...options.defaults,
    ...(options.globalSettings ?? {}),
    ...(options.projectSettings ?? {}),
    ...(options.envSettings ?? {}),
  } as T;
}

export async function readJsonFileObject(
  path: string,
  warnings: string[] = [],
): Promise<PlainObject> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }

  try {
    const value = JSON.parse(raw);
    return isPlainObject(value) ? value : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Ignoring invalid JSON settings file ${path}: ${message}`);
    return {};
  }
}

export async function readPiSettingsFiles(options: {
  agentDir: string;
  cwd: string;
  warnings?: string[];
}): Promise<{ globalSettings: PlainObject; projectSettings: PlainObject }> {
  const warnings = options.warnings ?? [];
  const [globalSettings, projectSettings] = await Promise.all([
    readJsonFileObject(join(options.agentDir, "settings.json"), warnings),
    readJsonFileObject(join(options.cwd, ".pi", "settings.json"), warnings),
  ]);
  return { globalSettings, projectSettings };
}

export function parseBooleanEnv(
  value: string | undefined,
  name?: string,
  warnings: string[] = [],
): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  if (name) warnings.push(`Ignoring invalid boolean env ${name}=${value}`);
  return undefined;
}

export function maskConfigValue(
  value: unknown,
  sensitiveFields: readonly string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskConfigValue(item, sensitiveFields));
  }
  if (!isPlainObject(value)) return value === undefined ? "(unset)" : value;

  const sensitive = new Set(sensitiveFields);
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      sensitive.has(key) && fieldValue !== undefined && fieldValue !== null
        ? "********"
        : maskConfigValue(fieldValue, sensitiveFields),
    ]),
  );
}

export function formatConfigForDisplay(
  extensionName: string,
  config: PlainObject,
  options: { sensitiveFields?: readonly string[] } = {},
): string {
  const masked = maskConfigValue(config, options.sensitiveFields);
  return [
    `${extensionName} effective config:`,
    JSON.stringify(masked, null, 2),
  ].join("\n");
}

export function registerConfigCommand<T extends PlainObject>(
  pi: Pick<ExtensionAPI, "registerCommand">,
  options: ConfigCommandOptions<T>,
): void {
  pi.registerCommand(`${options.extensionName}-config`, {
    description: `Show the effective ${options.extensionName} extension config.`,
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const config = await options.loadConfig(ctx.cwd);
      ctx.ui.notify(
        formatConfigForDisplay(options.extensionName, config, {
          sensitiveFields: options.sensitiveFields,
        }),
        "info",
      );
    },
  });
}
