import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type IdleConfig } from "./config.ts";
import {
  conversationId,
  restore,
  type Attempt,
  type Outcome,
  type RecordData,
} from "./state.ts";

export interface Clock {
  now(): number;
  wallTime(): number;
  set(callback: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}
export const clock: Clock = {
  now: () => performance.now(),
  wallTime: () => Date.now(),
  set: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return timer;
  },
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

type Flight = {
  attempt: Attempt;
  epoch: number;
  activity: number;
  session: string;
};

export class IdleController {
  private timer: unknown;
  private timerVersion = 0;
  private epoch = 0;
  private activityVersion = 0;
  private lastActivity = 0;
  private ctx?: ExtensionContext;
  private config?: IdleConfig;
  private state = restore([]);
  private promptOpen = false;
  private flight?: Flight;
  private fault = false;

  constructor(
    private readonly append: (data: RecordData) => void,
    private readonly time: Clock = clock,
  ) {}

  start(ctx: ExtensionContext, config: IdleConfig): void {
    this.stop();
    this.ctx = ctx;
    this.config = config;
    this.state = restore(ctx.sessionManager.getEntries());
    this.fault = !this.state.valid;
    if (this.fault)
      this.warn("idle-compaction disabled: invalid saved metadata.");
    this.activity();
  }

  stop(): void {
    this.epoch++;
    this.clearTimer();
    this.flight = undefined;
    this.ctx = undefined;
    this.promptOpen = false;
  }

  // Called before navigation as well as on the resulting branch: late native
  // callbacks must not append metadata to a different conversation.
  navigate(): void {
    this.epoch++;
    this.flight = undefined;
    this.activity();
  }

  activity(): void {
    this.activityVersion++;
    this.lastActivity = this.time.now();
    this.clearTimer();
    this.schedule();
  }

  prompt(open: boolean): void {
    this.promptOpen = open;
    this.activity();
  }

  setOverride(enabled: boolean): void {
    if (!this.ctx) return;
    if (!this.persist({ version: 1, kind: "override", enabled })) return;
    this.state.override = enabled;
    this.activity();
  }

  status(): string {
    const attempt = this.state.lastAttempt;
    const outcome =
      attempt?.outcome === "started"
        ? this.flight
          ? "in progress"
          : "interrupted/unknown (not retried)"
        : attempt?.outcome;
    return [
      `idle-compaction ${this.enabled() ? "on" : "off"}${this.ctx?.mode !== "tui" ? " (terminal only)" : ""}`,
      `Session override: ${this.state.override === undefined ? "none" : this.state.override ? "on" : "off"}`,
      `Threshold: ${this.config?.idleMinutes ?? DEFAULT_CONFIG.idleMinutes} idle minutes; context > ${this.config?.contextPercent ?? 40}%`,
      ...(this.fault || this.config?.valid === false
        ? ["Automatic action disabled by invalid configuration or metadata."]
        : []),
      attempt
        ? `Last attempt: ${new Date(attempt.at).toISOString()} (${outcome})`
        : "Last attempt: none",
      "Incomplete built-in dialog visibility and non-operation-scoped cancellation remain; see idle-compaction README.",
    ].join("\n");
  }

  private enabled(): boolean {
    return (
      !this.fault &&
      this.config?.valid === true &&
      (this.state.override ?? this.config.enabled)
    );
  }

  private clearTimer(): void {
    this.timerVersion++;
    if (this.timer !== undefined) this.time.clear(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (
      !this.ctx ||
      this.ctx.mode !== "tui" ||
      !this.enabled() ||
      this.flight ||
      this.promptOpen
    )
      return;
    const version = this.timerVersion;
    const delay = Math.max(
      0,
      this.lastActivity + this.config!.idleMinutes * 60_000 - this.time.now(),
    );
    this.timer = this.time.set(() => {
      if (version !== this.timerVersion) return;
      this.timer = undefined;
      this.wake();
    }, delay);
  }

  private eligible(): string | undefined {
    const ctx = this.ctx;
    if (
      !ctx ||
      ctx.mode !== "tui" ||
      !this.enabled() ||
      this.flight ||
      this.promptOpen ||
      !ctx.isIdle() ||
      ctx.hasPendingMessages()
    )
      return;
    if (this.time.now() - this.lastActivity < this.config!.idleMinutes * 60_000)
      return;
    const usage = ctx.getContextUsage();
    if (
      usage?.tokens == null ||
      usage.percent == null ||
      !Number.isFinite(usage.tokens) ||
      !Number.isFinite(usage.percent) ||
      usage.percent <= this.config!.contextPercent
    )
      return;
    const id = conversationId(ctx.sessionManager.getBranch());
    return id && !this.state.attempted.has(id) ? id : undefined;
  }

  private wake(): void {
    try {
      const id = this.eligible();
      if (!id) return; // No polling/retries: subsequent activity may schedule a new check.
      const ctx = this.ctx!;
      const epoch = this.epoch;
      const activity = this.activityVersion;
      // No await between the final eligibility check, durable attempt record and
      // native invocation. This is not an atomic lock on Pi's asynchronous pipeline.
      if (
        this.eligible() !== id ||
        epoch !== this.epoch ||
        activity !== this.activityVersion
      )
        return;
      const attempt: Attempt = {
        version: 1,
        kind: "attempt",
        conversationId: id,
        at: this.time.wallTime(),
        outcome: "started",
      };
      if (!this.persist(attempt)) return;
      this.state.attempted.add(id);
      this.state.lastAttempt = attempt;
      const flight: Flight = {
        attempt,
        epoch,
        activity,
        session: ctx.sessionManager.getSessionId(),
      };
      this.flight = flight;
      try {
        ctx.compact({
          onComplete: () => this.finish(flight, "completed"),
          onError: (error) =>
            this.finish(
              flight,
              error.name === "AbortError" ||
                error.message === "Compaction cancelled"
                ? "cancelled"
                : "failed",
            ),
        });
      } catch {
        this.finish(flight, "failed");
      }
    } catch {
      this.fault = true;
      this.clearTimer();
      this.warn("idle-compaction disabled: eligibility check failed.");
    }
  }

  // Veto a stale owned request if activity arrived during native admission.
  // This hook cannot cancel work after it has already passed the hook chain.
  beforeCompact(): { cancel: true } | undefined {
    const flight = this.flight;
    if (!flight) {
      this.activity();
      return;
    }
    if (
      flight.activity !== this.activityVersion ||
      flight.epoch !== this.epoch ||
      this.promptOpen ||
      !this.enabled() ||
      this.ctx?.hasPendingMessages() ||
      conversationId(this.ctx?.sessionManager.getBranch() ?? []) !==
        flight.attempt.conversationId
    )
      return { cancel: true };
  }

  private finish(flight: Flight, outcome: Outcome): void {
    if (this.flight !== flight || this.epoch !== flight.epoch || !this.ctx)
      return;
    this.flight = undefined;
    try {
      if (
        this.ctx.sessionManager.getSessionId() !== flight.session ||
        conversationId(this.ctx.sessionManager.getBranch()) !==
          flight.attempt.conversationId
      )
        return;
      const attempt = { ...flight.attempt, outcome };
      this.state.lastAttempt = attempt;
      this.persist(attempt);
    } catch {
      this.fault = true;
      this.warn(
        "idle-compaction disabled: attempt outcome could not be recorded.",
      );
    }
    // Deliberately no rearm after any outcome.
  }

  private persist(data: RecordData): boolean {
    try {
      this.append(data);
      return true;
    } catch {
      this.fault = true;
      this.clearTimer();
      this.warn(
        "idle-compaction disabled: session metadata could not be saved.",
      );
      return false;
    }
  }

  private warn(message: string): void {
    this.ctx?.ui.notify(message, "warning");
  }
}
