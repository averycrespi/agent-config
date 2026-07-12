import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import {
  mergeExtensionConfig,
  readExtensionSettings,
  readPiSettingsFiles,
} from "../_shared/config.ts";
import { DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY } from "./types.ts";

export const WORKFLOWS_EXTENSION_NAME = "workflows";

export type WorkflowConfig = {
  workflowTimeoutMs: number;
  agentTimeoutMs: number;
  maxConcurrency: number;
  maxTokensPerRun: number;
  maxAgentsPerRun: number;
  modelTierSmall: string;
  modelTierBig: string;
  userWorkflowsDir: string;
};

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  workflowTimeoutMs: 60 * 60 * 1000,
  agentTimeoutMs: 10 * 60 * 1000,
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  maxTokensPerRun: 0,
  maxAgentsPerRun: 100,
  modelTierSmall: "openai-codex/gpt-5.6-luna",
  modelTierBig: "openai-codex/gpt-5.6-sol",
  userWorkflowsDir: join(getAgentDir(), "workflows"),
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

function parseNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function parsePositiveField(
  value: unknown,
  field: "workflowTimeoutMs" | "agentTimeoutMs",
  warnings: string[],
): number {
  const parsed = parsePositiveInteger(value);
  if (parsed !== undefined) return parsed;
  if (value !== undefined)
    warnings.push(`Ignoring invalid ${field}; using default.`);
  return DEFAULT_WORKFLOW_CONFIG[field];
}

function parseConcurrency(value: unknown, warnings: string[]): number {
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) {
    if (value !== undefined)
      warnings.push("Ignoring invalid maxConcurrency; using default.");
    return DEFAULT_MAX_CONCURRENCY;
  }
  if (parsed > MAX_CONCURRENCY) {
    warnings.push(`Clamping maxConcurrency to ${MAX_CONCURRENCY}.`);
    return MAX_CONCURRENCY;
  }
  return parsed;
}

function parseLimit(
  value: unknown,
  field: "maxTokensPerRun" | "maxAgentsPerRun",
  warnings: string[],
): number {
  const parsed = parseNonNegativeInteger(value);
  if (parsed !== undefined) return parsed;
  if (value !== undefined)
    warnings.push(`Ignoring invalid ${field}; using default.`);
  return DEFAULT_WORKFLOW_CONFIG[field];
}

function parseModelTier(
  value: unknown,
  field: "modelTierSmall" | "modelTierBig",
  warnings: string[],
): string {
  if (typeof value === "string") return value.trim();
  if (value !== undefined)
    warnings.push(`Ignoring invalid ${field}; using default.`);
  return DEFAULT_WORKFLOW_CONFIG[field];
}

function parseWorkflowsDir(
  value: unknown,
  cwd: string,
  warnings: string[],
): string {
  if (typeof value === "string" && value.trim())
    return resolve(cwd, value.trim());
  if (value !== undefined)
    warnings.push("Ignoring invalid userWorkflowsDir; using default.");
  return DEFAULT_WORKFLOW_CONFIG.userWorkflowsDir;
}

export function readEnvSettings(
  env: NodeJS.ProcessEnv = process.env,
  warnings: string[] = [],
): Partial<WorkflowConfig> {
  const settings: Partial<WorkflowConfig> = {};
  const positiveFields = [
    ["WORKFLOWS_WORKFLOW_TIMEOUT_MS", "workflowTimeoutMs"],
    ["WORKFLOWS_AGENT_TIMEOUT_MS", "agentTimeoutMs"],
  ] as const;
  for (const [environment, field] of positiveFields) {
    const raw = env[environment];
    if (raw === undefined) continue;
    const parsed = parsePositiveInteger(raw);
    if (parsed !== undefined) settings[field] = parsed;
    else warnings.push(`Ignoring invalid ${environment}.`);
  }

  const concurrencyRaw = env.WORKFLOWS_MAX_CONCURRENCY;
  if (concurrencyRaw !== undefined) {
    const parsed = parsePositiveInteger(concurrencyRaw);
    if (parsed === undefined) {
      warnings.push("Ignoring invalid WORKFLOWS_MAX_CONCURRENCY.");
    } else {
      settings.maxConcurrency = Math.min(parsed, MAX_CONCURRENCY);
      if (parsed > MAX_CONCURRENCY) {
        warnings.push(
          `Clamping WORKFLOWS_MAX_CONCURRENCY to ${MAX_CONCURRENCY}.`,
        );
      }
    }
  }

  const limitFields = [
    ["WORKFLOWS_MAX_TOKENS_PER_RUN", "maxTokensPerRun"],
    ["WORKFLOWS_MAX_AGENTS_PER_RUN", "maxAgentsPerRun"],
  ] as const;
  for (const [environment, field] of limitFields) {
    const raw = env[environment];
    if (raw === undefined) continue;
    const parsed = parseNonNegativeInteger(raw);
    if (parsed !== undefined) settings[field] = parsed;
    else warnings.push(`Ignoring invalid ${environment}.`);
  }

  const workflowsDir = env.WORKFLOWS_USER_WORKFLOWS_DIR;
  if (workflowsDir !== undefined) {
    if (workflowsDir.trim()) settings.userWorkflowsDir = workflowsDir.trim();
    else warnings.push("Ignoring invalid WORKFLOWS_USER_WORKFLOWS_DIR.");
  }

  const modelFields = [
    ["WORKFLOWS_MODEL_TIER_SMALL", "modelTierSmall"],
    ["WORKFLOWS_MODEL_TIER_BIG", "modelTierBig"],
  ] as const;
  for (const [environment, field] of modelFields) {
    const raw = env[environment];
    if (raw !== undefined) settings[field] = raw.trim();
  }
  return settings;
}

export function normalizeWorkflowConfig(
  value: PlainObject,
  warnings: string[] = [],
  cwd: string = process.cwd(),
): WorkflowConfig {
  return {
    workflowTimeoutMs: parsePositiveField(
      value.workflowTimeoutMs,
      "workflowTimeoutMs",
      warnings,
    ),
    agentTimeoutMs: parsePositiveField(
      value.agentTimeoutMs,
      "agentTimeoutMs",
      warnings,
    ),
    maxConcurrency: parseConcurrency(value.maxConcurrency, warnings),
    maxTokensPerRun: parseLimit(
      value.maxTokensPerRun,
      "maxTokensPerRun",
      warnings,
    ),
    maxAgentsPerRun: parseLimit(
      value.maxAgentsPerRun,
      "maxAgentsPerRun",
      warnings,
    ),
    modelTierSmall: parseModelTier(
      value.modelTierSmall,
      "modelTierSmall",
      warnings,
    ),
    modelTierBig: parseModelTier(value.modelTierBig, "modelTierBig", warnings),
    userWorkflowsDir: parseWorkflowsDir(value.userWorkflowsDir, cwd, warnings),
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
  return normalizeWorkflowConfig(merged, warnings, cwd);
}
