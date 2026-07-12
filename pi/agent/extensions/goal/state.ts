export type GoalStatus = "active" | "paused" | "complete";

export interface GoalUsage {
  activeElapsedMs: number;
  totalTokens: number;
  turns: number;
  startedAt: number;
  activeSince?: number;
}

export type GoalReviewStatus =
  | "reviewing"
  | "fix_required"
  | "passed"
  | "exhausted"
  | "unavailable"
  | "overridden";

export type GoalReviewSeverity = "blocker" | "important" | "suggestion";

export interface GoalReviewFinding {
  severity: GoalReviewSeverity;
  confidence: number;
  description: string;
  evidence: string;
  location?: string;
  suggestedFix?: string;
}

export interface GoalReviewFailure {
  kind: string;
  message: string;
  logFile?: string;
}

export interface GoalReviewState {
  status: GoalReviewStatus;
  attemptToken?: string;
  attemptCount: number;
  fixRoundsUsed: number;
  claimEvidence: string;
  summary?: string;
  findings?: GoalReviewFinding[];
  failure?: GoalReviewFailure;
  startedAt: number;
  updatedAt: number;
  overrideReason?: string;
  overriddenAt?: number;
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
  review?: GoalReviewState;
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
  | "provider_error"
  | "aborted"
  | "review_exhausted"
  | "review_unavailable";

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
  beginReview(
    evidence: string,
    maxChars: number,
  ): (Goal & { review: GoalReviewState }) | undefined;
  applyReviewPass(
    goalId: string,
    attemptToken: string,
    summary: string,
    findings: GoalReviewFinding[],
  ): "applied" | "stale";
  applyReviewBlock(
    goalId: string,
    attemptToken: string,
    summary: string,
    findings: GoalReviewFinding[],
    maxFixRounds: number,
  ): "applied" | "stale";
  applyReviewFailure(
    goalId: string,
    attemptToken: string,
    kind: string,
    message: string,
    logFile?: string,
  ): "applied" | "stale";
  approveReview(reason: string, maxChars: number): "applied" | "ineligible";
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

function cloneReview(
  review: GoalReviewState | undefined,
): GoalReviewState | undefined {
  if (!review) return undefined;
  return {
    ...review,
    ...(review.findings
      ? { findings: review.findings.map((finding) => ({ ...finding })) }
      : {}),
    ...(review.failure ? { failure: { ...review.failure } } : {}),
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
  return {
    ...goal,
    ...(usage ? { usage } : {}),
    ...(goal.review ? { review: cloneReview(goal.review) } : {}),
  };
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
    value === "provider_error" ||
    value === "aborted" ||
    value === "review_exhausted" ||
    value === "review_unavailable"
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

function matchesReview(
  goal: Goal | undefined,
  goalId: string,
  attemptToken: string,
): goal is Goal & { review: GoalReviewState } {
  return (
    goal?.id === goalId &&
    goal.status === "active" &&
    goal.review?.status === "reviewing" &&
    goal.review.attemptToken === attemptToken
  );
}

export function createGoalStore(
  now: () => number = () => Date.now(),
): GoalStore {
  let goal: Goal | undefined;
  let autoRun: GoalAutoRunState | undefined;
  let nextId = 1;
  let nextReviewToken = 1;
  const listeners = new Set<(state: GoalState) => void>();

  const notify = () => {
    const state = cloneState(goal, autoRun, now);
    for (const listener of listeners) listener(state);
  };

  const stopRunningAutoRun = (reason: AutoRunStopReason, timestamp: number) => {
    if (autoRun?.status !== "running") return;
    autoRun = {
      ...autoRun,
      status: "stopped",
      stopReason: reason,
      updatedAt: timestamp,
    };
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
      if (goal?.review?.status === "reviewing") {
        const timestamp = now();
        goal = {
          ...accrueActiveTime(goal, timestamp),
          status: "paused",
          updatedAt: timestamp,
          review: {
            ...goal.review,
            status: "unavailable",
            attemptToken: undefined,
            failure: {
              kind: "interrupted",
              message: "Completion review was interrupted before it settled.",
            },
            updatedAt: timestamp,
          },
        };
        if (autoRun?.status === "running") {
          autoRun = {
            ...autoRun,
            status: "stopped",
            stopReason: "review_unavailable",
            updatedAt: timestamp,
          };
        }
      }
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
        ...(goal.review?.status === "reviewing" ? { review: undefined } : {}),
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
        review: undefined,
        completedAt: undefined,
        completionEvidence: undefined,
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

    beginReview(evidence, maxChars) {
      if (!goal || goal.status !== "active") return undefined;
      const timestamp = now();
      const previous = goal.review;
      const fixRoundsUsed = previous?.fixRoundsUsed ?? 0;
      const attemptCount = (previous?.attemptCount ?? 0) + 1;
      const attemptToken = `${goal.id}-review-${timestamp}-${nextReviewToken++}`;
      goal = {
        ...goal,
        updatedAt: timestamp,
        review: {
          status: "reviewing",
          attemptToken,
          attemptCount,
          fixRoundsUsed,
          claimEvidence: normalizeBoundedText(evidence, maxChars, "Evidence"),
          startedAt: timestamp,
          updatedAt: timestamp,
        },
      };
      notify();
      return cloneGoal(goal, now) as Goal & { review: GoalReviewState };
    },

    applyReviewPass(goalId, attemptToken, summary, findings) {
      if (!matchesReview(goal, goalId, attemptToken)) return "stale";
      const timestamp = now();
      const review = goal.review!;
      goal = {
        ...accrueActiveTime(goal, timestamp),
        status: "complete",
        updatedAt: timestamp,
        completedAt: timestamp,
        completionEvidence: review.claimEvidence,
        review: {
          ...review,
          status: "passed",
          attemptToken: undefined,
          fixRoundsUsed:
            review.attemptCount > 1
              ? review.fixRoundsUsed + 1
              : review.fixRoundsUsed,
          summary,
          findings: findings.map((finding) => ({ ...finding })),
          updatedAt: timestamp,
        },
      };
      stopRunningAutoRun("goal_complete", timestamp);
      notify();
      return "applied";
    },

    applyReviewBlock(goalId, attemptToken, summary, findings, maxFixRounds) {
      if (!matchesReview(goal, goalId, attemptToken)) return "stale";
      const timestamp = now();
      const review = goal.review!;
      const fixRoundsUsed =
        review.attemptCount > 1
          ? review.fixRoundsUsed + 1
          : review.fixRoundsUsed;
      const exhausted =
        review.attemptCount === 1
          ? maxFixRounds === 0
          : fixRoundsUsed >= maxFixRounds;
      goal = {
        ...(exhausted ? accrueActiveTime(goal, timestamp) : goal),
        status: exhausted ? "paused" : "active",
        updatedAt: timestamp,
        review: {
          ...review,
          status: exhausted ? "exhausted" : "fix_required",
          attemptToken: undefined,
          fixRoundsUsed,
          summary,
          findings: findings.map((finding) => ({ ...finding })),
          updatedAt: timestamp,
        },
      };
      if (exhausted) stopRunningAutoRun("review_exhausted", timestamp);
      notify();
      return "applied";
    },

    applyReviewFailure(goalId, attemptToken, kind, message, logFile) {
      if (!matchesReview(goal, goalId, attemptToken)) return "stale";
      const timestamp = now();
      const review = goal.review!;
      goal = {
        ...accrueActiveTime(goal, timestamp),
        status: "paused",
        updatedAt: timestamp,
        review: {
          ...review,
          status: "unavailable",
          attemptToken: undefined,
          failure: { kind, message, ...(logFile ? { logFile } : {}) },
          updatedAt: timestamp,
        },
      };
      stopRunningAutoRun("review_unavailable", timestamp);
      notify();
      return "applied";
    },

    approveReview(reason, maxChars) {
      if (
        !goal ||
        goal.status !== "paused" ||
        (goal.review?.status !== "exhausted" &&
          goal.review?.status !== "unavailable")
      ) {
        return "ineligible";
      }
      const timestamp = now();
      const review = goal.review;
      goal = {
        ...goal,
        status: "complete",
        updatedAt: timestamp,
        completedAt: timestamp,
        completionEvidence: review.claimEvidence,
        review: {
          ...review,
          status: "overridden",
          overrideReason: normalizeBoundedText(reason, maxChars, "Reason"),
          overriddenAt: timestamp,
          updatedAt: timestamp,
        },
      };
      notify();
      return "applied";
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

function parseFinding(value: unknown): GoalReviewFinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.severity !== "blocker" &&
      candidate.severity !== "important" &&
      candidate.severity !== "suggestion") ||
    !Number.isInteger(candidate.confidence) ||
    (candidate.confidence as number) < 0 ||
    (candidate.confidence as number) > 100 ||
    typeof candidate.description !== "string" ||
    !candidate.description.trim() ||
    candidate.description.length > 800 ||
    typeof candidate.evidence !== "string" ||
    !candidate.evidence.trim() ||
    candidate.evidence.length > 500 ||
    (candidate.location !== undefined &&
      (typeof candidate.location !== "string" ||
        candidate.location.length > 200)) ||
    (candidate.suggestedFix !== undefined &&
      (typeof candidate.suggestedFix !== "string" ||
        candidate.suggestedFix.length > 500))
  )
    return undefined;
  return {
    severity: candidate.severity,
    confidence: candidate.confidence as number,
    description: candidate.description,
    evidence: candidate.evidence,
    ...(typeof candidate.location === "string"
      ? { location: candidate.location }
      : {}),
    ...(typeof candidate.suggestedFix === "string"
      ? { suggestedFix: candidate.suggestedFix }
      : {}),
  };
}

function parseReview(value: unknown): GoalReviewState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.status !== "reviewing" &&
    candidate.status !== "fix_required" &&
    candidate.status !== "passed" &&
    candidate.status !== "exhausted" &&
    candidate.status !== "unavailable" &&
    candidate.status !== "overridden"
  )
    return undefined;
  if (
    !Number.isInteger(candidate.attemptCount) ||
    (candidate.attemptCount as number) < 0 ||
    !Number.isInteger(candidate.fixRoundsUsed) ||
    (candidate.fixRoundsUsed as number) < 0 ||
    typeof candidate.claimEvidence !== "string" ||
    !candidate.claimEvidence.trim() ||
    typeof candidate.startedAt !== "number" ||
    typeof candidate.updatedAt !== "number" ||
    (candidate.attemptToken !== undefined &&
      (typeof candidate.attemptToken !== "string" ||
        candidate.attemptToken.length > 200)) ||
    (candidate.summary !== undefined &&
      (typeof candidate.summary !== "string" ||
        !candidate.summary.trim() ||
        candidate.summary.length > 1_000)) ||
    (candidate.overrideReason !== undefined &&
      (typeof candidate.overrideReason !== "string" ||
        !candidate.overrideReason.trim())) ||
    (candidate.overriddenAt !== undefined &&
      typeof candidate.overriddenAt !== "number")
  )
    return undefined;
  const findings =
    candidate.findings === undefined
      ? undefined
      : Array.isArray(candidate.findings) && candidate.findings.length <= 10
        ? candidate.findings.map(parseFinding)
        : undefined;
  if (
    candidate.findings !== undefined &&
    (!findings || findings.some((finding) => !finding))
  )
    return undefined;
  let failure: GoalReviewFailure | undefined;
  if (candidate.failure !== undefined) {
    if (
      !candidate.failure ||
      typeof candidate.failure !== "object" ||
      Array.isArray(candidate.failure)
    )
      return undefined;
    const raw = candidate.failure as Record<string, unknown>;
    if (
      typeof raw.kind !== "string" ||
      !raw.kind.trim() ||
      raw.kind.length > 100 ||
      typeof raw.message !== "string" ||
      !raw.message.trim() ||
      raw.message.length > 500 ||
      (raw.logFile !== undefined &&
        (typeof raw.logFile !== "string" || raw.logFile.length > 1_000))
    )
      return undefined;
    failure = {
      kind: raw.kind,
      message: raw.message,
      ...(typeof raw.logFile === "string" ? { logFile: raw.logFile } : {}),
    };
  }
  return {
    status: candidate.status,
    attemptCount: candidate.attemptCount as number,
    fixRoundsUsed: candidate.fixRoundsUsed as number,
    claimEvidence: candidate.claimEvidence,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    ...(typeof candidate.attemptToken === "string"
      ? { attemptToken: candidate.attemptToken }
      : {}),
    ...(typeof candidate.summary === "string"
      ? { summary: candidate.summary }
      : {}),
    ...(findings ? { findings: findings as GoalReviewFinding[] } : {}),
    ...(failure ? { failure } : {}),
    ...(typeof candidate.overrideReason === "string"
      ? { overrideReason: candidate.overrideReason }
      : {}),
    ...(typeof candidate.overriddenAt === "number"
      ? { overriddenAt: candidate.overriddenAt }
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
  const review =
    candidate.review === undefined ? undefined : parseReview(candidate.review);
  return {
    id: candidate.id,
    objective: candidate.objective,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    usage,
    ...(review ? { review } : {}),
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

export function getAutoRunElapsedMs(
  autoRun: GoalAutoRunState,
  now: () => number = () => Date.now(),
): number {
  return autoRun.startedAt === undefined
    ? 0
    : Math.max(0, now() - autoRun.startedAt);
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
  const review = state.goal.review;
  if (review) {
    lines.push(
      `Review: ${review.status} · attempt ${review.attemptCount} · fix rounds ${review.fixRoundsUsed}`,
    );
    if (review.summary) lines.push(`Review summary: ${review.summary}`);
    for (const finding of review.findings ?? []) {
      lines.push(
        `- ${finding.severity} (${finding.confidence}): ${finding.description} — ${finding.evidence}${finding.location ? ` [${finding.location}]` : ""}`,
      );
    }
    if (review.failure)
      lines.push(
        `Review unavailable (${review.failure.kind}): ${review.failure.message}`,
      );
    if (review.overrideReason)
      lines.push(`Human approval: ${review.overrideReason}`);
  }
  if (state.goal.status === "complete" && state.goal.completionEvidence) {
    lines.push(`Evidence: ${state.goal.completionEvidence}`);
  }
  return lines.join("\n");
}
