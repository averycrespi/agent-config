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
};

type PlainObject = Record<string, unknown>;

export const DEFAULT_STRUCTURED_OUTPUT_CONFIG: StructuredOutputConfig = {
  schemaFile: undefined,
  terminate: true,
};

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
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
  return { schemaFile, terminate };
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
