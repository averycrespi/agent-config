import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { resolveCapabilities } from "./capabilities.ts";
import { loadSubagentsConfig, type SubagentsConfig } from "./config.ts";
import {
  formatSpawnFailure,
  spawnSubagent,
  type SpawnInvocation,
  type SpawnOutcome,
  type StructuredOutputSpec,
} from "./spawn.ts";
import { resolveExtensionAllowlist } from "./utils.ts";
import {
  CAPABILITIES,
  MODEL_TIERS,
  THINKING_LEVELS,
  type Capability,
  type ModelTier,
  type ThinkingLevel,
} from "./types.ts";

export interface LiveModelRegistry {
  find(provider: string, modelId: string): unknown;
}

export interface RunSubagentRequest {
  intent: string;
  prompt: string;
  capabilities: Capability[];
  modelTier: ModelTier;
  thinking: ThinkingLevel;
  files?: string[];
  output?: StructuredOutputSpec;
  cwd: string;
  signal?: AbortSignal;
  logId?: string;
  onEvent?: (event: unknown) => void;
  modelRegistry: LiveModelRegistry;
}

export interface PreparedSubagent {
  invocation: SpawnInvocation;
  modelSelector: string;
  capabilities: Capability[];
  modelTier: ModelTier;
  thinking: ThinkingLevel;
}

export interface SubagentPreflight {
  prepared?: PreparedSubagent;
  errors: string[];
  warnings: string[];
}

export const _loadConfig = { fn: loadSubagentsConfig };
export const _resolveExtensions = { fn: resolveExtensionAllowlist };
export const _spawnSubagent = { fn: spawnSubagent };
export const _thinkingLevels = {
  fn: (model: unknown): string[] => {
    const levels = (
      getSupportedThinkingLevels as (value: unknown) => unknown[]
    )(model).map(String);
    const map = (model as { thinkingLevelMap?: Record<string, unknown> })
      ?.thinkingLevelMap;
    if (
      map &&
      map.max !== undefined &&
      map.max !== null &&
      !levels.includes("max")
    ) {
      levels.push("max");
    }
    return levels;
  },
};

function selectorForTier(config: SubagentsConfig, tier: ModelTier): string {
  if (tier === "small") return config.modelTierSmall;
  if (tier === "medium") return config.modelTierMedium;
  return config.modelTierLarge;
}

function parseSelector(selector: string): [string, string] | undefined {
  const slash = selector.indexOf("/");
  if (slash <= 0 || slash === selector.length - 1) return undefined;
  return [selector.slice(0, slash), selector.slice(slash + 1)];
}

export function resolveSubagentRequest(
  request: RunSubagentRequest,
  config: SubagentsConfig,
): SubagentPreflight {
  const errors: string[] = [];
  const intent =
    typeof request.intent === "string" ? request.intent.trim() : "";
  const prompt =
    typeof request.prompt === "string" ? request.prompt.trim() : "";
  if (!intent) errors.push("intent is required");
  if (!prompt) errors.push("prompt is required");

  if (!Array.isArray(request.capabilities)) {
    errors.push("capabilities is required and must be an array");
  } else {
    for (const capability of request.capabilities as unknown[]) {
      if (!CAPABILITIES.includes(capability as Capability)) {
        errors.push(`unknown capability: ${String(capability)}`);
      } else if (
        !config.allowedCapabilities.includes(capability as Capability)
      ) {
        errors.push(`capability is globally disallowed: ${String(capability)}`);
      }
    }
  }

  if (!MODEL_TIERS.includes(request.modelTier)) {
    errors.push(`modelTier must be one of: ${MODEL_TIERS.join(", ")}`);
  }
  if (!THINKING_LEVELS.includes(request.thinking)) {
    errors.push(`thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
  } else if (!config.allowedThinkingLevels.includes(request.thinking)) {
    errors.push(`thinking level is globally disallowed: ${request.thinking}`);
  }

  const selector = MODEL_TIERS.includes(request.modelTier)
    ? selectorForTier(config, request.modelTier)
    : "";
  const parsed = parseSelector(selector);
  if (!parsed) errors.push(`model tier ${request.modelTier} is not configured`);

  const model = parsed
    ? request.modelRegistry?.find?.(parsed[0], parsed[1])
    : undefined;
  if (parsed && !model) {
    errors.push(`configured model could not be resolved: ${selector}`);
  }
  if (
    model &&
    THINKING_LEVELS.includes(request.thinking) &&
    !_thinkingLevels.fn(model).includes(request.thinking)
  ) {
    errors.push(
      `thinking level ${request.thinking} is not supported by model ${selector}`,
    );
  }

  if (errors.length > 0 || !parsed || !model) {
    return { errors, warnings: [] };
  }

  const capabilities = [...new Set(request.capabilities)];
  const grants = resolveCapabilities(capabilities);
  return {
    errors: [],
    warnings: [],
    prepared: {
      modelSelector: selector,
      capabilities,
      modelTier: request.modelTier,
      thinking: request.thinking,
      invocation: {
        prompt,
        toolAllowlist: grants.tools,
        extensionAllowlist: grants.extensions,
        files: request.files,
        model: selector,
        thinking: request.thinking,
        inheritSession: "none",
        output: request.output,
        logId: request.logId,
        cwd: request.cwd,
        env: grants.env,
        signal: request.signal,
        onEvent: request.onEvent,
      },
    },
  };
}

export async function validatePreparedExtensions(
  prepared: PreparedSubagent,
  cwd: string,
): Promise<string[]> {
  const errors: string[] = [];
  for (const extension of prepared.invocation.extensionAllowlist) {
    if ((await _resolveExtensions.fn([extension], cwd)).length === 0) {
      errors.push(`required capability extension is unavailable: ${extension}`);
    }
  }
  return errors;
}

export async function preflightSubagent(
  request: RunSubagentRequest,
): Promise<SubagentPreflight> {
  const warnings: string[] = [];
  const config = await _loadConfig.fn(request.cwd, warnings);
  const result = resolveSubagentRequest(request, config);
  result.warnings.push(...warnings);
  if (result.prepared) {
    result.errors.push(
      ...(await validatePreparedExtensions(result.prepared, request.cwd)),
    );
    if (result.errors.length > 0) result.prepared = undefined;
  }
  return result;
}

export async function runSubagent(
  request: RunSubagentRequest,
): Promise<SpawnOutcome> {
  const preflight = await preflightSubagent(request);
  if (!preflight.prepared) {
    return {
      ok: false,
      aborted: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      errorMessage: `subagent policy validation failed: ${preflight.errors.join("; ")}`,
      diagnosticWarnings: preflight.warnings,
    };
  }
  const outcome = await _spawnSubagent.fn(preflight.prepared.invocation);
  if (preflight.warnings.length > 0) {
    outcome.diagnosticWarnings = [
      ...(outcome.diagnosticWarnings ?? []),
      ...preflight.warnings,
    ];
  }
  return outcome;
}

export { formatSpawnFailure };
