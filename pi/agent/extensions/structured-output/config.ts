import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";

export type StructuredOutputConfig = {
  schemaFile?: string;
  terminate: boolean;
  missingOutputReminders: number;
};

type PlainObject = Record<string, unknown>;

export const DEFAULT_STRUCTURED_OUTPUT_CONFIG: StructuredOutputConfig = {
  schemaFile: undefined,
  terminate: true,
  missingOutputReminders: 1,
};

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

export function readEnvSettings(
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): Partial<StructuredOutputConfig> {
  const settings: Partial<StructuredOutputConfig> = {};
  const schemaFile = normalizeString(env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE);
  if (schemaFile !== undefined) settings.schemaFile = schemaFile;

  const terminate = parseBooleanEnv(
    env.PI_STRUCTURED_OUTPUT_TERMINATE,
    "PI_STRUCTURED_OUTPUT_TERMINATE",
    warnings,
  );
  if (terminate !== undefined) settings.terminate = terminate;

  const remindersRaw = env.PI_STRUCTURED_OUTPUT_MISSING_OUTPUT_REMINDERS;
  const missingOutputReminders = parseNonNegativeInteger(remindersRaw);
  if (missingOutputReminders !== undefined) {
    settings.missingOutputReminders = missingOutputReminders;
  } else if (remindersRaw !== undefined && remindersRaw.trim() !== "") {
    warnings.push(
      `Ignoring invalid non-negative integer env PI_STRUCTURED_OUTPUT_MISSING_OUTPUT_REMINDERS=${remindersRaw}`,
    );
  }
  return settings;
}

function parseStructuredOutputConfig(
  value: PlainObject,
  warnings: string[],
): StructuredOutputConfig {
  const schemaFile = normalizeString(value.schemaFile);
  const terminate =
    typeof value.terminate === "boolean"
      ? value.terminate
      : DEFAULT_STRUCTURED_OUTPUT_CONFIG.terminate;
  if (value.terminate !== undefined && typeof value.terminate !== "boolean") {
    warnings.push(`Ignoring invalid terminate: ${String(value.terminate)}`);
  }
  const parsedReminders = parseNonNegativeInteger(value.missingOutputReminders);
  const missingOutputReminders =
    parsedReminders ?? DEFAULT_STRUCTURED_OUTPUT_CONFIG.missingOutputReminders;
  if (
    value.missingOutputReminders !== undefined &&
    parsedReminders === undefined
  ) {
    warnings.push(
      `Ignoring invalid missingOutputReminders: ${String(value.missingOutputReminders)}`,
    );
  }
  return { schemaFile, terminate, missingOutputReminders };
}

export async function loadStructuredOutputConfig(
  cwd: string,
  warnings: string[] = [],
): Promise<StructuredOutputConfig> {
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_STRUCTURED_OUTPUT_CONFIG as unknown as PlainObject,
    globalSettings: readExtensionSettings(globalSettings, "structured-output"),
    projectSettings: readExtensionSettings(
      projectSettings,
      "structured-output",
    ),
    envSettings: readEnvSettings(process.env, warnings) as PlainObject,
  });
  return parseStructuredOutputConfig(merged, warnings);
}
