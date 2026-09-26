import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";

export type WidgetConfig = {
  autoHide: boolean;
  terminalHideAfterMs: number;
};
export const DEFAULT_WIDGET_CONFIG: Readonly<WidgetConfig> = Object.freeze({
  autoHide: true,
  terminalHideAfterMs: 15000,
});

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function parseWidgetConfig(
  settings: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): WidgetConfig {
  const result = { ...DEFAULT_WIDGET_CONFIG };
  const autoHide =
    env.BACKGROUND_WIDGETS_AUTO_HIDE === undefined
      ? settings.autoHide === undefined
        ? result.autoHide
        : settings.autoHide
      : parseBooleanEnv(env.BACKGROUND_WIDGETS_AUTO_HIDE);
  if (typeof autoHide === "boolean") result.autoHide = autoHide;
  else warnings.push("Invalid Background widgets.autoHide; using true.");
  const delay =
    env.BACKGROUND_WIDGETS_TERMINAL_HIDE_AFTER_MS === undefined
      ? settings.terminalHideAfterMs === undefined
        ? result.terminalHideAfterMs
        : settings.terminalHideAfterMs
      : /^\d+$/.test(env.BACKGROUND_WIDGETS_TERMINAL_HIDE_AFTER_MS.trim())
        ? Number(env.BACKGROUND_WIDGETS_TERMINAL_HIDE_AFTER_MS)
        : NaN;
  if (typeof delay === "number" && Number.isSafeInteger(delay) && delay >= 0)
    result.terminalHideAfterMs = delay;
  else
    warnings.push(
      "Invalid Background widgets.terminalHideAfterMs; using 15000.",
    );
  return result;
}

export async function loadBackgroundConfig(
  cwd: string,
  warnings: string[] = [],
) {
  const fileWarnings: string[] = [];
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings: fileWarnings,
  });
  if (fileWarnings.length)
    warnings.push("Ignoring invalid JSON in Background settings files.");
  const widgets = (root: Record<string, unknown>) => {
    const value = readExtensionSettings(root, "background").widgets;
    if (value === undefined) return {};
    if (object(value)) return value;
    warnings.push("Ignoring invalid Background widgets section.");
    return {};
  };
  return {
    widgets: parseWidgetConfig(
      mergeExtensionConfig({
        defaults: { ...DEFAULT_WIDGET_CONFIG },
        globalSettings: widgets(globalSettings),
        projectSettings: widgets(projectSettings),
      }),
      process.env,
      warnings,
    ),
  };
}
