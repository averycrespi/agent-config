import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "find",
  "grep",
] as const;

export const MAX_SUBAGENT_DEPTH = 5;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const MAX_CONCURRENCY_CEILING = 16;
export const MAX_AGENTS_PER_CALL = 16;
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type InheritSession = "none" | "fork";
export type SubagentPhase = string;

export interface AgentDefinition {
  name: string;
  description: string;
  tools: BuiltinTool[];
  extensions: string[];
  model?: string;
  thinking?: string;
  env?: Record<string, string>;
  systemPrompt: string;
  disableSkills: boolean;
  disablePromptTemplates: boolean;
}

export interface SpawnAgentItem {
  agent: string;
  intent: string;
  prompt: string;
  thinking?: ThinkingLevel;
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
  agentType?: string;
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

export function buildSpawnAgentsParams(agentDescription: string) {
  return Type.Object({
    agents: Type.Array(
      Type.Object({
        agent: Type.String({ description: agentDescription }),
        intent: Type.String({
          minLength: 1,
          description: "Short label for this agent",
        }),
        prompt: Type.String({ description: "Task for this agent" }),
        thinking: Type.Optional(
          StringEnum(THINKING_LEVELS, {
            description:
              "Thinking level override for this item; otherwise uses the agent definition or parent level",
          }),
        ),
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
      }),
      { minItems: 1, description: "Agents to run in parallel" },
    ),
  });
}
