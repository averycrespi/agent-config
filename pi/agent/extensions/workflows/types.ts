import type {
  AgentDefinition,
  SpawnOutcome,
  StructuredOutputSpec,
  SubagentRunState,
} from "../subagents/api.ts";

export const DEFAULT_AGENT_TYPE = "explore";
export const READ_MOSTLY_AGENT_TYPES = new Set([
  "explore",
  "research",
  "deep-research",
  "review",
]);
export const DEFAULT_MAX_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface WorkflowMeta {
  name: string;
  description: string;
}

export interface ParsedWorkflow {
  script: string;
  executableScript: string;
  meta: WorkflowMeta;
}

export interface WorkflowParams {
  script: string;
  args?: unknown;
}

export type WorkflowErrorCode =
  | "agent_policy_rejected"
  | "agent_spawn_exception"
  | "subagent_failed"
  | "subagent_aborted"
  | "structured_output_not_called"
  | "structured_output_incomplete"
  | "structured_output_tool_error"
  | "structured_output_malformed"
  | "structured_output_invalid"
  | "workflow_aborted"
  | "workflow_timeout"
  | "workflow_script_error";

export interface WorkflowFailureDetails {
  code: WorkflowErrorCode;
  message: string;
  phase?: string;
  agentId?: number;
  intent?: string;
  logFile?: string;
}

export interface WorkflowLogEntry {
  level: "info" | "error";
  message: string;
  timestamp: number;
}

export interface WorkflowAgentState {
  id: number;
  agent: string;
  intent: string;
  prompt: string;
  status: "running" | "done" | "error" | "aborted";
  resultPreview?: string;
  errorMessage?: string;
  logFile?: string;
  activity?: SubagentRunState;
  startedAt: number;
  finishedAt?: number;
}

export interface WorkflowSnapshot {
  meta?: WorkflowMeta;
  phase?: string;
  phases: string[];
  logs: WorkflowLogEntry[];
  agents: WorkflowAgentState[];
  failureCount: number;
  startedAt: number;
  finishedAt?: number;
  resultPreview?: string;
}

export interface WorkflowRunResult {
  ok: boolean;
  aborted: boolean;
  meta: WorkflowMeta;
  result: unknown;
  logs: WorkflowLogEntry[];
  agents: WorkflowAgentState[];
  phases: string[];
  failureCount: number;
  durationMs: number;
}

export interface WorkflowRuntimeOptions {
  cwd: string;
  args?: unknown;
  signal?: AbortSignal;
  onUpdate?: (snapshot: WorkflowSnapshot) => void;
  spawnAgent: (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse>;
  timeoutMs?: number;
}

export interface WorkflowAgentRequest {
  id: number;
  prompt: string;
  agent?: string;
  intent?: string;
  output?: StructuredOutputSpec;
  retries?: number;
  signal?: AbortSignal;
}

export interface WorkflowAgentResponse {
  ok: boolean;
  text: string | null;
  hasStructured?: boolean;
  value?: unknown;
  error?: string;
  errorCode?: WorkflowErrorCode;
  errorDetails?: WorkflowFailureDetails;
  attempts?: number;
  outcome?: SpawnOutcome;
}

export interface WorkflowAgentPolicyOptions {
  cwd: string;
  signal?: AbortSignal;
  logId: string;
  agents: AgentDefinition[];
  model?: string;
  thinking?: string;
  onAgentUpdate?: (state: WorkflowAgentState) => void;
}
