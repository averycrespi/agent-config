import type {
  Capability,
  LiveModelRegistry,
  ModelTier,
  SpawnOutcome,
  StructuredOutputSpec,
  SubagentRunState,
  ThinkingLevel,
} from "../subagents/api.ts";

export const DEFAULT_MAX_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 16;
export const DEFAULT_MAX_VISIBLE_SETTLED_AGENTS = 5;
export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

export interface WorkflowMeta {
  name: string;
  description: string;
}

export interface ParsedWorkflow {
  script: string;
  executableScript: string;
  meta: WorkflowMeta;
  literalMeta: WorkflowMeta;
}

export type WorkflowErrorCode =
  | "agent_policy_rejected"
  | "agent_spawn_exception"
  | "subagent_failed"
  | "subagent_aborted"
  | "provider_error"
  | "provider_schema_rejected"
  | "structured_output_not_called"
  | "structured_output_incomplete"
  | "structured_output_tool_error"
  | "structured_output_malformed"
  | "structured_output_invalid"
  | "workflow_aborted"
  | "workflow_timeout"
  | "agent_timeout"
  | "workflow_budget_exceeded"
  | "workflow_run_cap_exceeded"
  | "workflow_report_rejected"
  | "workflow_missing_result"
  | "workflow_script_error";

export interface WorkflowFailureDetails {
  code: WorkflowErrorCode;
  message: string;
  phase?: string;
  agentId?: number;
  intent?: string;
  logFile?: string;
  effectiveTimeoutMs?: number;
  diagnosticWarnings?: string[];
  details?: unknown;
}

export interface WorkflowRecoveryRecord {
  requestId: number;
  intent: string;
  capabilities: Capability[];
  modelTier: ModelTier;
  thinking: ThinkingLevel;
  phase?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  effectiveTimeoutMs?: number;
  attempts: number;
  structuredValue?: unknown;
  failure?: WorkflowFailureDetails;
  logFile?: string;
}

export interface WorkflowFailureCounts {
  completed: number;
  failed: number;
  timedOut: number;
  canceled: number;
  outstanding: number;
}

export interface WorkflowRunDiagnostic {
  cause: WorkflowFailureDetails;
  counts: WorkflowFailureCounts;
  snapshot: WorkflowSnapshot;
  recoveryRecords: WorkflowRecoveryRecord[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface WorkflowLogEntry {
  level: "info" | "error";
  message: string;
  timestamp: number;
}

export interface WorkflowAgentState {
  id: number;
  intent: string;
  capabilities: Capability[];
  modelTier: ModelTier;
  thinking: ThinkingLevel;
  status: "running" | "done" | "error" | "aborted";
  resultPreview?: string;
  errorMessage?: string;
  errorCode?: WorkflowErrorCode;
  errorDetails?: WorkflowFailureDetails;
  effectiveTimeoutMs?: number;
  explicitTimeoutMs?: number;
  logFile?: string;
  diagnosticWarnings?: string[];
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
  agentFailureCount: number;
  loggedBranchFailureCount: number;
  settledBranchFailureCount: number;
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
  agentFailureCount: number;
  loggedBranchFailureCount: number;
  settledBranchFailureCount: number;
  durationMs: number;
}

export interface WorkflowBudgetSnapshot {
  total: number | null;
  used: number;
  launched: number;
  maxAgents: number | null;
}

export interface WorkflowRunLedger {
  reserve(requestId: number): WorkflowErrorCode | undefined;
  recordTokens(requestId: number, attempt: number, total: number): void;
  snapshot(): Readonly<WorkflowBudgetSnapshot>;
  subscribe(
    listener: (snapshot: Readonly<WorkflowBudgetSnapshot>) => void,
  ): () => void;
  isTokenExceeded(): boolean;
}

export interface WorkflowRuntimeOptions {
  cwd: string;
  args?: unknown;
  signal?: AbortSignal;
  onUpdate?: (snapshot: WorkflowSnapshot) => void;
  spawnAgent: (request: WorkflowAgentRequest) => Promise<WorkflowAgentResponse>;
  timeoutMs?: number;
  agentTimeoutMs?: number;
  maxConcurrency?: number;
  ledger?: WorkflowRunLedger;
}

export interface WorkflowAgentRequest {
  id: number;
  prompt: string;
  intent: string;
  capabilities: Capability[];
  modelTier: ModelTier;
  thinking: ThinkingLevel;
  output?: StructuredOutputSpec;
  retries?: number;
  timeoutMs?: number;
  effectiveTimeoutMs?: number;
  attempt?: number;
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
  modelRegistry: LiveModelRegistry;
  onAgentUpdate?: (state: WorkflowAgentState) => void;
  ledger?: WorkflowRunLedger;
}
