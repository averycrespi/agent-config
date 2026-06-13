export type GoalStatus = "active" | "paused" | "complete";

export interface GoalUsage {
  activeElapsedMs: number;
  totalTokens: number;
  turns: number;
  startedAt: number;
  activeSince?: number;
}

export interface Goal {
  id: string;
  objective: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  completionEvidence?: string;
  usage?: GoalUsage;
}

export type AutoRunStatus = "idle" | "running" | "stopped";
export type AutoRunStopReason =
  | "user_stopped"
  | "user_input"
  | "goal_paused"
  | "goal_cleared"
  | "goal_complete"
  | "turn_budget"
  | "time_budget"
  | "provider_error";

export interface GoalAutoRunState {
  status: AutoRunStatus;
  startedAt?: number;
  updatedAt: number;
  continuationTurns: number;
  stopReason?: AutoRunStopReason;
  lastContinuationAt?: number;
}

export interface GoalState {
  goal?: Goal;
  autoRun?: GoalAutoRunState;
}

export interface GoalStore {
  getGoal(): Goal | undefined;
  getAutoRun(): GoalAutoRunState | undefined;
  getState(): GoalState;
  replaceState(state: GoalState): void;
  setGoal(objective: string, maxChars: number): Goal;
  pause(): Goal | undefined;
  resume(): Goal | undefined;
  complete(evidence: string, maxChars: number): Goal | undefined;
  recordAssistantUsage(totalTokens?: number): Goal | undefined;
  startAutoRun(): GoalAutoRunState;
  stopAutoRun(reason: AutoRunStopReason): GoalAutoRunState;
  recordAutoRunContinuation(): GoalAutoRunState;
  clear(): void;
  subscribe(listener: (state: GoalState) => void): () => void;
}

function defaultUsage(timestamp: number, active: boolean): GoalUsage {
  return {
    activeElapsedMs: 0,
    totalTokens: 0,
    turns: 0,
    startedAt: timestamp,
    ...(active ? { activeSince: timestamp } : {}),
  };
}

function cloneGoal(goal: Goal, now?: () => number): Goal {
  const usage = goal.usage ? { ...goal.usage } : undefined;
  if (
    usage &&
    goal.status === "active" &&
    usage.activeSince !== undefined &&
    now
  ) {
    usage.activeElapsedMs += Math.max(0, now() - usage.activeSince);
  }
  return { ...goal, ...(usage ? { usage } : {}) };
}

function cloneAutoRun(
  autoRun: GoalAutoRunState | undefined,
): GoalAutoRunState | undefined {
  return autoRun ? { ...autoRun } : undefined;
}

function cloneState(
  goal: Goal | undefined,
  autoRun: GoalAutoRunState | undefined,
  now?: () => number,
): GoalState {
  return {
    ...(goal ? { goal: cloneGoal(goal, now) } : {}),
    ...(autoRun ? { autoRun: cloneAutoRun(autoRun) } : {}),
  };
}

function accrueActiveTime(goal: Goal, timestamp: number): Goal {
  if (!goal.usage || goal.usage.activeSince === undefined) return goal;
  const { activeSince, ...rest } = goal.usage;
  return {
    ...goal,
    usage: {
      ...rest,
      activeElapsedMs:
        goal.usage.activeElapsedMs + Math.max(0, timestamp - activeSince),
    },
  };
}

export function isGoalStatus(value: unknown): value is GoalStatus {
  return value === "active" || value === "paused" || value === "complete";
}

export function isAutoRunStatus(value: unknown): value is AutoRunStatus {
  return value === "idle" || value === "running" || value === "stopped";
}

export function isAutoRunStopReason(
  value: unknown,
): value is AutoRunStopReason {
  return (
    value === "user_stopped" ||
    value === "user_input" ||
    value === "goal_paused" ||
    value === "goal_cleared" ||
    value === "goal_complete" ||
    value === "turn_budget" ||
    value === "time_budget" ||
    value === "provider_error"
  );
}

export function normalizeBoundedText(
  value: unknown,
  maxChars: number,
  label: string,
): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required.`);
  if (trimmed.length > maxChars) {
    throw new Error(`${label} must be at most ${maxChars} characters.`);
  }
  return trimmed;
}

export function createGoalStore(
  now: () => number = () => Date.now(),
): GoalStore {
  let goal: Goal | undefined;
  let autoRun: GoalAutoRunState | undefined;
  let nextId = 1;
  const listeners = new Set<(state: GoalState) => void>();

  const notify = () => {
    const state = cloneState(goal, autoRun, now);
    for (const listener of listeners) listener(state);
  };

  return {
    getGoal() {
      return goal ? cloneGoal(goal, now) : undefined;
    },

    getAutoRun() {
      return cloneAutoRun(autoRun);
    },

    getState() {
      return cloneState(goal, autoRun, now);
    },

    replaceState(state) {
      goal = state.goal ? cloneGoal(state.goal) : undefined;
      autoRun = cloneAutoRun(state.autoRun);
      notify();
    },

    setGoal(objective, maxChars) {
      const timestamp = now();
      goal = {
        id: `goal-${timestamp}-${nextId}`,
        objective: normalizeBoundedText(objective, maxChars, "Objective"),
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        usage: defaultUsage(timestamp, true),
      };
      nextId += 1;
      autoRun = undefined;
      notify();
      return cloneGoal(goal, now);
    },

    pause() {
      if (!goal) return undefined;
      const timestamp = now();
      goal = {
        ...accrueActiveTime(goal, timestamp),
        status: "paused",
        updatedAt: timestamp,
      };
      if (autoRun?.status === "running") {
        autoRun = {
          ...autoRun,
          status: "stopped",
          updatedAt: timestamp,
          stopReason: "goal_paused",
        };
      }
      notify();
      return cloneGoal(goal, now);
    },

    resume() {
      if (!goal) return undefined;
      const timestamp = now();
      goal = {
        ...goal,
        status: "active",
        updatedAt: timestamp,
        usage: {
          ...(goal.usage ?? defaultUsage(timestamp, false)),
          activeSince: timestamp,
        },
      };
      notify();
      return cloneGoal(goal, now);
    },

    complete(evidence, maxChars) {
      if (!goal) return undefined;
      const timestamp = now();
      goal = {
        ...accrueActiveTime(goal, timestamp),
        status: "complete",
        updatedAt: timestamp,
        completedAt: timestamp,
        completionEvidence: normalizeBoundedText(
          evidence,
          maxChars,
          "Evidence",
        ),
      };
      if (autoRun?.status === "running") {
        autoRun = {
          ...autoRun,
          status: "stopped",
          updatedAt: timestamp,
          stopReason: "goal_complete",
        };
      }
      notify();
      return cloneGoal(goal, now);
    },

    recordAssistantUsage(totalTokens) {
      if (!goal || goal.status !== "active") return undefined;
      const usage = goal.usage ?? defaultUsage(now(), true);
      goal = {
        ...goal,
        updatedAt: now(),
        usage: {
          ...usage,
          totalTokens:
            usage.totalTokens +
            (typeof totalTokens === "number" && totalTokens > 0
              ? totalTokens
              : 0),
          turns: usage.turns + 1,
        },
      };
      notify();
      return cloneGoal(goal, now);
    },

    startAutoRun() {
      const timestamp = now();
      autoRun = {
        status: "running",
        startedAt: timestamp,
        updatedAt: timestamp,
        continuationTurns: 0,
      };
      notify();
      return cloneAutoRun(autoRun)!;
    },

    stopAutoRun(reason) {
      const timestamp = now();
      autoRun = {
        ...(autoRun ?? { continuationTurns: 0 }),
        status: "stopped",
        updatedAt: timestamp,
        stopReason: reason,
      };
      notify();
      return cloneAutoRun(autoRun)!;
    },

    recordAutoRunContinuation() {
      const timestamp = now();
      autoRun = {
        ...(autoRun ?? { startedAt: timestamp, continuationTurns: 0 }),
        status: "running",
        updatedAt: timestamp,
        lastContinuationAt: timestamp,
        continuationTurns: (autoRun?.continuationTurns ?? 0) + 1,
      };
      notify();
      return cloneAutoRun(autoRun)!;
    },

    clear() {
      goal = undefined;
      if (autoRun?.status === "running") {
        autoRun = {
          ...autoRun,
          status: "stopped",
          updatedAt: now(),
          stopReason: "goal_cleared",
        };
      } else {
        autoRun = undefined;
      }
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function parseUsage(value: unknown, createdAt: number): GoalUsage | undefined {
  if (value === undefined) return defaultUsage(createdAt, false);
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.activeElapsedMs !== "number" ||
    typeof candidate.totalTokens !== "number" ||
    typeof candidate.turns !== "number" ||
    typeof candidate.startedAt !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.activeSince !== undefined &&
    typeof candidate.activeSince !== "number"
  ) {
    return undefined;
  }
  return {
    activeElapsedMs: Math.max(0, candidate.activeElapsedMs),
    totalTokens: Math.max(0, candidate.totalTokens),
    turns: Math.max(0, candidate.turns),
    startedAt: candidate.startedAt,
    ...(typeof candidate.activeSince === "number"
      ? { activeSince: candidate.activeSince }
      : {}),
  };
}

function parseGoal(value: unknown): Goal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.objective !== "string" ||
    candidate.objective.trim().length === 0 ||
    !isGoalStatus(candidate.status) ||
    typeof candidate.createdAt !== "number" ||
    typeof candidate.updatedAt !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.completedAt !== undefined &&
    typeof candidate.completedAt !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.completionEvidence !== undefined &&
    typeof candidate.completionEvidence !== "string"
  ) {
    return undefined;
  }
  if (candidate.status === "complete" && !candidate.completionEvidence) {
    return undefined;
  }
  const usage = parseUsage(candidate.usage, candidate.createdAt);
  if (!usage) return undefined;
  return {
    id: candidate.id,
    objective: candidate.objective,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    usage,
    ...(typeof candidate.completedAt === "number"
      ? { completedAt: candidate.completedAt }
      : {}),
    ...(typeof candidate.completionEvidence === "string"
      ? { completionEvidence: candidate.completionEvidence }
      : {}),
  };
}

function parseAutoRun(value: unknown): GoalAutoRunState | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !isAutoRunStatus(candidate.status) ||
    typeof candidate.updatedAt !== "number" ||
    typeof candidate.continuationTurns !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.startedAt !== undefined &&
    typeof candidate.startedAt !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.lastContinuationAt !== undefined &&
    typeof candidate.lastContinuationAt !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.stopReason !== undefined &&
    !isAutoRunStopReason(candidate.stopReason)
  ) {
    return undefined;
  }
  return {
    status: candidate.status,
    updatedAt: candidate.updatedAt,
    continuationTurns: Math.max(0, candidate.continuationTurns),
    ...(typeof candidate.startedAt === "number"
      ? { startedAt: candidate.startedAt }
      : {}),
    ...(typeof candidate.lastContinuationAt === "number"
      ? { lastContinuationAt: candidate.lastContinuationAt }
      : {}),
    ...(isAutoRunStopReason(candidate.stopReason)
      ? { stopReason: candidate.stopReason }
      : {}),
  };
}

export function parsePersistedGoalState(value: unknown): GoalState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { goal?: unknown; autoRun?: unknown };
  const goal =
    candidate.goal === undefined ? undefined : parseGoal(candidate.goal);
  if (candidate.goal !== undefined && !goal) return undefined;
  const autoRun = parseAutoRun(candidate.autoRun);
  if (candidate.autoRun !== undefined && !autoRun) return undefined;
  return {
    ...(goal ? { goal } : {}),
    ...(autoRun ? { autoRun } : {}),
  };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000)
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatUsageLine(goal: Goal): string | undefined {
  if (!goal.usage) return undefined;
  const turnLabel = goal.usage.turns === 1 ? "turn" : "turns";
  return `Usage: ${formatDuration(goal.usage.activeElapsedMs)} active · ${formatTokenCount(goal.usage.totalTokens)} tokens · ${goal.usage.turns} ${turnLabel}`;
}

export function formatAutoRunLine(autoRun: GoalAutoRunState): string {
  if (autoRun.status === "running") {
    const turnLabel = autoRun.continuationTurns === 1 ? "turn" : "turns";
    return `Auto-run: running · ${autoRun.continuationTurns} continuation ${turnLabel}`;
  }
  if (autoRun.status === "stopped") {
    return `Auto-run: stopped${autoRun.stopReason ? ` · ${autoRun.stopReason}` : ""}`;
  }
  return "Auto-run: idle";
}

export function formatGoalState(
  state: GoalState,
  options: { showUsage?: boolean } = {},
): string {
  if (!state.goal) return "No goal is set.";
  const lines = [`Goal [${state.goal.status}] ${state.goal.objective}`];
  if (options.showUsage) {
    const usageLine = formatUsageLine(state.goal);
    if (usageLine) lines.push(usageLine);
  }
  if (state.autoRun && state.autoRun.status !== "idle") {
    lines.push(formatAutoRunLine(state.autoRun));
  }
  if (state.goal.status === "complete" && state.goal.completionEvidence) {
    lines.push(`Evidence: ${state.goal.completionEvidence}`);
  }
  return lines.join("\n");
}
