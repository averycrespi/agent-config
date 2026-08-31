export type LoopStatus = "running" | "yielded" | "stopped";

export type LoopStopReason =
  | "agent_stop"
  | "user_stop"
  | "extension_stop"
  | "continuation_limit"
  | "time_limit"
  | "provider_error"
  | "aborted"
  | "session_restored";

export type LoopLimits = {
  maxContinuations: number;
  maxActiveMinutes: number;
};

export type LoopLimitPatch = Partial<LoopLimits>;

export type LoopState = {
  id: string;
  generation: number;
  status: LoopStatus;
  message: string;
  limits: LoopLimits;
  delaySeconds: number;
  continuationCount: number;
  activeElapsedMs: number;
  runningSince?: number;
  createdAt: number;
  updatedAt: number;
  stopReason?: LoopStopReason;
  detail?: string;
};

export type PersistedLoopState = {
  generation: number;
  loop?: LoopState;
};

export type LoopStore = ReturnType<typeof createLoopStore>;

type Listener = (state: PersistedLoopState) => void;

const STOP_REASONS = new Set<LoopStopReason>([
  "agent_stop",
  "user_stop",
  "extension_stop",
  "continuation_limit",
  "time_limit",
  "provider_error",
  "aborted",
  "session_restored",
]);

function cloneLoop(loop: LoopState | undefined): LoopState | undefined {
  return loop ? { ...loop, limits: { ...loop.limits } } : undefined;
}

function cloneState(state: PersistedLoopState): PersistedLoopState {
  return { generation: state.generation, loop: cloneLoop(state.loop) };
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value as number;
}

function validateDelaySeconds(value: unknown, ceiling: number): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("delaySeconds must be a non-negative integer.");
  }
  if ((value as number) > ceiling) {
    throw new Error(
      `delaySeconds exceeds the configured ceiling of ${ceiling}.`,
    );
  }
  return value as number;
}

function validateLimits(limits: LoopLimits, ceilings: LoopLimits): LoopLimits {
  const maxContinuations = positiveInteger(
    limits.maxContinuations,
    "maxContinuations",
  );
  const maxActiveMinutes = positiveInteger(
    limits.maxActiveMinutes,
    "maxActiveMinutes",
  );
  if (maxContinuations > ceilings.maxContinuations) {
    throw new Error(
      `maxContinuations exceeds the configured ceiling of ${ceilings.maxContinuations}.`,
    );
  }
  if (maxActiveMinutes > ceilings.maxActiveMinutes) {
    throw new Error(
      `maxActiveMinutes exceeds the configured ceiling of ${ceilings.maxActiveMinutes}.`,
    );
  }
  return { maxContinuations, maxActiveMinutes };
}

export function normalizeBoundedText(
  value: unknown,
  maxChars: number,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxChars) {
    throw new Error(`${label} must be at most ${maxChars} characters.`);
  }
  return normalized;
}

export function sanitizeDisplayText(value: string): string {
  return value
    .replace(
      /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)?)/g,
      "",
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getLoopActiveElapsedMs(
  loop: LoopState,
  now: number = Date.now(),
): number {
  return (
    loop.activeElapsedMs +
    (loop.status === "running" && loop.runningSince !== undefined
      ? Math.max(0, now - loop.runningSince)
      : 0)
  );
}

function currentBudgetStopReason(
  loop: LoopState,
  now: number,
): "continuation_limit" | "time_limit" | undefined {
  if (loop.continuationCount >= loop.limits.maxContinuations) {
    return "continuation_limit";
  }
  if (
    getLoopActiveElapsedMs(loop, now) >=
    loop.limits.maxActiveMinutes * 60_000
  ) {
    return "time_limit";
  }
  return undefined;
}

export function createLoopStore(now: () => number = Date.now) {
  let state: PersistedLoopState = { generation: 0 };
  const listeners = new Set<Listener>();

  function notify(): void {
    const snapshot = cloneState(state);
    for (const listener of listeners) listener(cloneState(snapshot));
  }

  function pauseRunning(loop: LoopState, timestamp: number): void {
    loop.activeElapsedMs = getLoopActiveElapsedMs(loop, timestamp);
    delete loop.runningSince;
  }

  function transitionStopped(
    reason: LoopStopReason,
    detail?: string,
    detailMaxChars = 4_000,
  ): boolean {
    const loop = state.loop;
    if (!loop) return false;
    const normalizedDetail =
      detail !== undefined
        ? normalizeBoundedText(detail, detailMaxChars, "reason")
        : undefined;
    const timestamp = now();
    if (loop.status === "running") pauseRunning(loop, timestamp);
    loop.status = "stopped";
    loop.stopReason = reason;
    if (normalizedDetail !== undefined) {
      loop.detail = normalizedDetail;
    } else {
      delete loop.detail;
    }
    loop.updatedAt = timestamp;
    notify();
    return true;
  }

  return {
    getState(): PersistedLoopState {
      return cloneState(state);
    },

    getLoop(): LoopState | undefined {
      return cloneLoop(state.loop);
    },

    replaceState(next: PersistedLoopState): void {
      state = cloneState(next);
      notify();
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(
      message: unknown,
      limits: LoopLimits,
      ceilings: LoopLimits,
      messageMaxChars: number,
      delaySeconds = 0,
      hardMaxDelaySeconds = 3_600,
    ): LoopState {
      if (state.loop) throw new Error("A loop already exists; clear it first.");
      const normalizedMessage = normalizeBoundedText(
        message,
        messageMaxChars,
        "message",
      );
      const validatedLimits = validateLimits(limits, ceilings);
      const validatedDelaySeconds = validateDelaySeconds(
        delaySeconds,
        hardMaxDelaySeconds,
      );
      const timestamp = now();
      const generation = state.generation + 1;
      state = {
        generation,
        loop: {
          id: `loop-${generation}-${timestamp}`,
          generation,
          status: "running",
          message: normalizedMessage,
          limits: validatedLimits,
          delaySeconds: validatedDelaySeconds,
          continuationCount: 0,
          activeElapsedMs: 0,
          runningSince: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
      notify();
      return cloneLoop(state.loop)!;
    },

    yield(reason: unknown, reasonMaxChars: number): boolean {
      const loop = state.loop;
      if (!loop) return false;
      const detail = normalizeBoundedText(reason, reasonMaxChars, "reason");
      if (loop.status === "yielded") return false;
      if (loop.status === "stopped") {
        throw new Error(
          "A stopped loop cannot yield; resume it explicitly first.",
        );
      }
      const timestamp = now();
      if (loop.status === "running") pauseRunning(loop, timestamp);
      loop.status = "yielded";
      delete loop.stopReason;
      loop.detail = detail;
      loop.updatedAt = timestamp;
      notify();
      return true;
    },

    stop(
      reason: LoopStopReason,
      detail?: string,
      detailMaxChars = 4_000,
    ): boolean {
      return transitionStopped(reason, detail, detailMaxChars);
    },

    wake(): boolean {
      const loop = state.loop;
      if (!loop || loop.status !== "yielded") return false;
      const timestamp = now();
      const exhausted = currentBudgetStopReason(loop, timestamp);
      if (exhausted) {
        transitionStopped(exhausted);
        return false;
      }
      loop.status = "running";
      loop.runningSince = timestamp;
      delete loop.stopReason;
      delete loop.detail;
      loop.updatedAt = timestamp;
      notify();
      return true;
    },

    resume(): boolean {
      const loop = state.loop;
      if (!loop) return false;
      if (loop.status === "running") return false;
      const timestamp = now();
      const exhausted = currentBudgetStopReason(loop, timestamp);
      if (exhausted) {
        throw new Error(
          `Loop has exhausted its ${exhausted === "continuation_limit" ? "continuation" : "time"} limit; extend it before resuming.`,
        );
      }
      loop.status = "running";
      loop.runningSince = timestamp;
      delete loop.stopReason;
      delete loop.detail;
      loop.updatedAt = timestamp;
      notify();
      return true;
    },

    extend(patch: LoopLimitPatch, ceilings: LoopLimits): boolean {
      const loop = state.loop;
      if (!loop) return false;
      if (
        patch.maxContinuations === undefined &&
        patch.maxActiveMinutes === undefined
      ) {
        throw new Error("At least one new loop limit is required.");
      }
      const next: LoopLimits = {
        maxContinuations:
          patch.maxContinuations ?? loop.limits.maxContinuations,
        maxActiveMinutes:
          patch.maxActiveMinutes ?? loop.limits.maxActiveMinutes,
      };
      if (next.maxContinuations < loop.limits.maxContinuations) {
        throw new Error("extend cannot reduce maxContinuations.");
      }
      if (next.maxActiveMinutes < loop.limits.maxActiveMinutes) {
        throw new Error("extend cannot reduce maxActiveMinutes.");
      }
      loop.limits = validateLimits(next, ceilings);
      loop.updatedAt = now();
      notify();
      return true;
    },

    claimContinuation(expectedGeneration?: number): {
      claimed: boolean;
      stopReason?: "continuation_limit" | "time_limit";
    } {
      const loop = state.loop;
      if (
        !loop ||
        loop.status !== "running" ||
        (expectedGeneration !== undefined &&
          loop.generation !== expectedGeneration)
      ) {
        return { claimed: false };
      }
      const timestamp = now();
      const stopReason = currentBudgetStopReason(loop, timestamp);
      if (stopReason) {
        transitionStopped(stopReason);
        return { claimed: false, stopReason };
      }
      loop.continuationCount += 1;
      loop.updatedAt = timestamp;
      notify();
      return { claimed: true };
    },

    clear(): boolean {
      if (!state.loop) return false;
      state = { generation: state.generation + 1 };
      notify();
      return true;
    },
  };
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parsePersistedLoopState(
  value: unknown,
  reasonMaxChars = 4_000,
): PersistedLoopState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const loopValue = record.loop;
  const topGeneration = record.generation;
  if (loopValue === undefined) {
    return Number.isInteger(topGeneration) && (topGeneration as number) >= 0
      ? { generation: topGeneration as number }
      : undefined;
  }
  if (!loopValue || typeof loopValue !== "object") return undefined;
  const loop = loopValue as Record<string, unknown>;
  const limits = loop.limits as Record<string, unknown> | undefined;
  if (
    typeof loop.id !== "string" ||
    !Number.isInteger(loop.generation) ||
    (loop.generation as number) < 1 ||
    !["running", "yielded", "stopped"].includes(String(loop.status)) ||
    typeof loop.message !== "string" ||
    loop.message.trim().length === 0 ||
    !limits ||
    !Number.isInteger(limits.maxContinuations) ||
    (limits.maxContinuations as number) <= 0 ||
    !Number.isInteger(limits.maxActiveMinutes) ||
    (limits.maxActiveMinutes as number) <= 0 ||
    (loop.delaySeconds !== undefined &&
      (!Number.isInteger(loop.delaySeconds) ||
        (loop.delaySeconds as number) < 0)) ||
    !Number.isInteger(loop.continuationCount) ||
    (loop.continuationCount as number) < 0 ||
    !isFiniteNonNegative(loop.activeElapsedMs) ||
    !isFiniteNonNegative(loop.createdAt) ||
    !isFiniteNonNegative(loop.updatedAt)
  ) {
    return undefined;
  }

  const status = loop.status as LoopStatus;
  if (status === "running" && !isFiniteNonNegative(loop.runningSince)) {
    return undefined;
  }
  if (
    loop.stopReason !== undefined &&
    !STOP_REASONS.has(loop.stopReason as LoopStopReason)
  ) {
    return undefined;
  }

  let detail: string | undefined;
  if (loop.detail !== undefined) {
    try {
      detail = normalizeBoundedText(loop.detail, reasonMaxChars, "reason");
    } catch {
      return undefined;
    }
  }

  const generation = loop.generation as number;
  const parsed: LoopState = {
    id: loop.id,
    generation,
    status,
    message: loop.message.trim(),
    limits: {
      maxContinuations: limits.maxContinuations as number,
      maxActiveMinutes: limits.maxActiveMinutes as number,
    },
    delaySeconds: (loop.delaySeconds as number | undefined) ?? 0,
    continuationCount: loop.continuationCount as number,
    activeElapsedMs: loop.activeElapsedMs,
    createdAt: loop.createdAt,
    updatedAt: loop.updatedAt,
    ...(status === "running"
      ? { runningSince: loop.runningSince as number }
      : {}),
    ...(loop.stopReason !== undefined
      ? { stopReason: loop.stopReason as LoopStopReason }
      : {}),
    ...(detail !== undefined ? { detail } : {}),
  };

  if (parsed.status === "running") {
    parsed.activeElapsedMs = getLoopActiveElapsedMs(parsed, parsed.updatedAt);
    parsed.status = "stopped";
    parsed.stopReason = "session_restored";
    delete parsed.runningSince;
  }

  return {
    generation: Math.max(generation, Number(topGeneration) || 0),
    loop: parsed,
  };
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatLoopState(state: PersistedLoopState): string {
  const loop = state.loop;
  if (!loop) return "No loop exists.";
  const elapsed = getLoopActiveElapsedMs(loop);
  const lines = [
    `Loop [${loop.status}] ${sanitizeDisplayText(loop.message)}`,
    `${loop.continuationCount}/${loop.limits.maxContinuations} continuations · ${formatDuration(elapsed)}/${formatDuration(loop.limits.maxActiveMinutes * 60_000)} limit${loop.delaySeconds > 0 ? ` · ${loop.delaySeconds}s delay` : ""}`,
  ];
  if (loop.detail) lines.push(sanitizeDisplayText(loop.detail));
  return lines.join("\n");
}
