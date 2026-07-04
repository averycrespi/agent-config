import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";

export const WORKFLOWS_EXTENSION_NAME = "workflows";

export type WorkflowConfig = {
  workflowTimeoutMs: number;
  agentTimeoutMs: number;
};

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  workflowTimeoutMs: 60 * 60 * 1000,
  agentTimeoutMs: 10 * 60 * 1000,
};

type PlainObject = Record<string, unknown>;

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function parseTimeoutField(
  value: unknown,
  field: keyof WorkflowConfig,
  warnings: string[],
): number {
  const parsed = parsePositiveInteger(value);
  if (parsed !== undefined) return parsed;
  if (value !== undefined)
    warnings.push(`Ignoring invalid ${field}; using default.`);
  return DEFAULT_WORKFLOW_CONFIG[field];
}

export function readEnvSettings(
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): Partial<WorkflowConfig> {
  const settings: Partial<WorkflowConfig> = {};
  const workflowTimeoutMs = parsePositiveInteger(
    env.WORKFLOWS_WORKFLOW_TIMEOUT_MS,
  );
  if (workflowTimeoutMs !== undefined)
    settings.workflowTimeoutMs = workflowTimeoutMs;
  else if (env.WORKFLOWS_WORKFLOW_TIMEOUT_MS) {
    warnings.push("Ignoring invalid WORKFLOWS_WORKFLOW_TIMEOUT_MS.");
  }

  const agentTimeoutMs = parsePositiveInteger(env.WORKFLOWS_AGENT_TIMEOUT_MS);
  if (agentTimeoutMs !== undefined) settings.agentTimeoutMs = agentTimeoutMs;
  else if (env.WORKFLOWS_AGENT_TIMEOUT_MS) {
    warnings.push("Ignoring invalid WORKFLOWS_AGENT_TIMEOUT_MS.");
  }
  return settings;
}

export function normalizeWorkflowConfig(
  value: PlainObject,
  warnings: string[] = [],
): WorkflowConfig {
  return {
    workflowTimeoutMs: parseTimeoutField(
      value.workflowTimeoutMs,
      "workflowTimeoutMs",
      warnings,
    ),
    agentTimeoutMs: parseTimeoutField(
      value.agentTimeoutMs,
      "agentTimeoutMs",
      warnings,
    ),
  };
}

export async function loadWorkflowConfig(
  cwd: string,
  warnings: string[] = [],
): Promise<WorkflowConfig> {
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_WORKFLOW_CONFIG as unknown as PlainObject,
    globalSettings: readExtensionSettings(
      globalSettings,
      WORKFLOWS_EXTENSION_NAME,
    ),
    projectSettings: readExtensionSettings(
      projectSettings,
      WORKFLOWS_EXTENSION_NAME,
    ),
    envSettings: readEnvSettings(process.env, warnings) as PlainObject,
  });
  return normalizeWorkflowConfig(merged, warnings);
}
