import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const CAPABILITIES = [
  "read-filesystem",
  "exec-shell",
  "read-broker",
  "read-web",
] as const;

export const MODEL_TIERS = ["small", "medium", "large"] as const;
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const MAX_SUBAGENT_DEPTH = 5;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const MAX_CONCURRENCY_CEILING = 16;
export const MAX_AGENTS_PER_CALL = 16;

export type Capability = (typeof CAPABILITIES)[number];
export type ModelTier = (typeof MODEL_TIERS)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type EffectiveTool =
  | "read"
  | "bash"
  | "ls"
  | "find"
  | "grep"
  | "mcp_search"
  | "mcp_describe"
  | "mcp_call"
  | "web_search"
  | "web_fetch";
export type InheritSession = "none" | "fork";
export type SubagentPhase = string;

export interface SpawnAgentItem {
  intent: string;
  prompt: string;
  capabilities: Capability[];
  model_tier: ModelTier;
  thinking: ThinkingLevel;
  files?: string[];
  output_schema?: Record<string, unknown>;
}

export interface SpawnAgentsParams {
  agents: SpawnAgentItem[];
}

export interface SubagentEvent {
  kind: "tool" | "stderr";
  text: string;
}

export interface SubagentRunState {
  intent: string;
  capabilities?: Capability[];
  modelTier?: ModelTier;
  thinking?: ThinkingLevel;
  phase: SubagentPhase;
  activeTool?: string;
  currentCommand?: string;
  lastCommand?: string;
  lastOutput?: string;
  lastToolInfo?: string;
  recentEvents: SubagentEvent[];
  toolUseCount: number;
  totalTokens: number;
  resolved?: boolean;
  errorMessage?: string;
  logFile?: string;
  startedAt: number;
  lastUpdateAt: number;
}

export function buildSpawnAgentsParams(policyDescription: string) {
  return Type.Object(
    {
      agents: Type.Array(
        Type.Object(
          {
            intent: Type.String({
              minLength: 1,
              description: "Short label for this subagent run",
            }),
            prompt: Type.String({
              minLength: 1,
              description: "Self-contained task for this subagent",
            }),
            capabilities: Type.Array(StringEnum(CAPABILITIES), {
              description:
                "Explicit built-in capabilities. An empty array launches a no-tools child.",
            }),
            model_tier: StringEnum(MODEL_TIERS, {
              description: policyDescription,
            }),
            thinking: StringEnum(THINKING_LEVELS, {
              description: "Explicit configured thinking level for this item",
            }),
            files: Type.Optional(
              Type.Array(Type.String(), {
                description:
                  "Readable regular files attached with native @file handling. Contents are sent to the selected model/provider and may appear in retained logs or spillover output.",
              }),
            ),
            output_schema: Type.Optional(
              Type.Record(Type.String(), Type.Unknown(), {
                description:
                  "Supported JSON Schema subset for a validated machine-readable result",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, description: "Subagents to run in parallel" },
      ),
    },
    { additionalProperties: false },
  );
}
