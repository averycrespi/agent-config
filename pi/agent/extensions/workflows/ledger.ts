import type {
  WorkflowBudgetSnapshot,
  WorkflowErrorCode,
  WorkflowRunLedger,
} from "./types.ts";

export interface WorkflowRunLedgerOptions {
  maxTokens?: number;
  maxAgents?: number;
}

function limit(value: number | undefined): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : 0;
}

export function createWorkflowRunLedger(
  options: WorkflowRunLedgerOptions = {},
): WorkflowRunLedger {
  const maxTokens = limit(options.maxTokens);
  const maxAgents = limit(options.maxAgents);
  const reservations = new Set<number>();
  const attempts = new Map<string, number>();
  const listeners = new Set<
    (snapshot: Readonly<WorkflowBudgetSnapshot>) => void
  >();
  let used = 0;
  let tokenExceeded = false;

  const snapshot = (): Readonly<WorkflowBudgetSnapshot> =>
    Object.freeze({
      total: maxTokens > 0 ? maxTokens : null,
      used,
      launched: reservations.size,
      maxAgents: maxAgents > 0 ? maxAgents : null,
    });

  const notify = () => {
    for (const listener of listeners) listener(snapshot());
  };

  return {
    reserve(requestId: number): WorkflowErrorCode | undefined {
      if (tokenExceeded) return "workflow_budget_exceeded";
      if (reservations.has(requestId)) return undefined;
      if (maxAgents > 0 && reservations.size >= maxAgents) {
        return "workflow_run_cap_exceeded";
      }
      reservations.add(requestId);
      notify();
      return undefined;
    },

    recordTokens(requestId: number, attempt: number, total: number): void {
      if (!Number.isFinite(total) || total < 0) return;
      const normalized = Math.trunc(total);
      const key = `${requestId}:${attempt}`;
      const previous = attempts.get(key) ?? 0;
      if (previous === normalized) return;
      attempts.set(key, normalized);
      used += normalized - previous;
      if (maxTokens > 0 && used >= maxTokens) tokenExceeded = true;
      notify();
    },

    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    isTokenExceeded() {
      return tokenExceeded;
    },
  };
}
