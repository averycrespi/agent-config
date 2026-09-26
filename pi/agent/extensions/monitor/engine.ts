import type { JsonValue, RunResult } from "../script/api.ts";
import type { MonitorEvent } from "./api.ts";
import type { Subscription, Selection } from "./providers.ts";
import {
  LIMITS,
  uuid,
  observation,
  RequestError,
  type Registration,
  type Receipt,
  type Trigger,
  type Reason,
} from "./contract.ts";
export interface Clock {
  now(): number;
  set(fn: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}
const defaultClock: Clock = {
  now: Date.now,
  set(fn, delay) {
    const t = setTimeout(fn, delay);
    t.unref();
    return t;
  },
  clear(t) {
    clearTimeout(t as ReturnType<typeof setTimeout>);
  },
};
export interface Host {
  idle(): boolean;
  persist(receipt: Receipt): void;
  changed(): void;
  event?(event: MonitorEvent): void;
  handoff(receipt: Receipt, message: string): void;
  evaluate(
    reg: Registration,
    trigger: Trigger,
    state: JsonValue,
    signal: AbortSignal,
    deadline: number,
  ): Promise<RunResult>;
  subscribe(
    selection: Selection,
    reg: Registration,
    signal: AbortSignal,
    deadline: number,
    emit: (payload: JsonValue) => void,
    lost: () => void,
  ): Promise<Subscription>;
}
interface Job {
  reg: Registration;
  r: Receipt;
  queue: Trigger[];
  subs: Subscription[];
  controller: AbortController;
  execution?: AbortController;
  cycleOpen: boolean;
  waiting?: string;
}
export class MonitorEngine {
  private jobs = new Map<string, Job>();
  private reservations = new Set<AbortController>();
  private running = 0;
  private timer?: unknown;
  private closed = false;
  constructor(
    private host: Host,
    private clock: Clock = defaultClock,
  ) {}
  list() {
    return [...this.jobs.values()].map((j) => structuredClone(j.r));
  }
  get(id: string) {
    const r = this.jobs.get(id)?.r;
    return r && structuredClone(r);
  }
  inspect(id: string, source: string) {
    const j = this.jobs.get(id);
    return (
      j && {
        receipt: structuredClone(j.r),
        sourceMatches: j.reg.source?.trim() === source.trim(),
      }
    );
  }
  private publish(type: MonitorEvent["type"], j: Job) {
    try {
      this.host.event?.(
        Object.freeze({
          type,
          id: j.r.id,
          status: j.r.status,
          notification:
            j.r.attention?.disposition ??
            j.r.lastAttention?.disposition ??
            "none",
        }),
      );
    } catch {
      /* observational */
    }
  }
  private occupied(j: Job) {
    return (
      j.r.status === "active" ||
      j.r.inFlight ||
      j.r.attention?.disposition === "pending"
    );
  }
  private save(j: Job) {
    if (this.closed) return;
    try {
      this.host.persist(structuredClone(j.r));
    } catch {
      this.close(false);
      return;
    }
    this.host.changed();
  }
  async start(reg: Registration, signal?: AbortSignal) {
    reg = structuredClone(reg);
    if (this.closed || signal?.aborted)
      throw new RequestError("Monitor unavailable or registration cancelled.");
    if (
      [...this.jobs.values()].filter((j) => this.occupied(j)).length +
        this.reservations.size >=
      LIMITS.active
    )
      throw new RequestError("Monitor capacity exhausted.");
    const controller = new AbortController();
    this.reservations.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const now = this.clock.now();
    const r: Receipt = {
      id: uuid(),
      name: reg.name,
      createdAt: now,
      deadline: now + reg.lifetimeMs,
      cycleDeadline: now + reg.cycleMs,
      status: "active",
      recurring: reg.recurring,
      cycleMs: reg.cycleMs,
      ...(reg.intervalMs !== undefined ? { intervalMs: reg.intervalMs } : {}),
      ...(reg.delayMs !== undefined ? { delayMs: reg.delayMs } : {}),
      eventCount: reg.events.length,
      maxWakes: reg.maxWakes,
      wakes: 0,
      evaluations: 0,
      calls: 0,
      inFlight: false,
      awaitingSettlement: false,
      state: reg.state,
      evidence: null,
      coverage: [],
      gap: false,
      interrupted: false,
      effectsMayPersist: false,
      outcomeUnknown: false,
    };
    const j: Job = { reg, r, queue: [], subs: [], controller, cycleOpen: true };
    let admitted = false,
      setupLost = false;
    const enqueue = (trigger: Trigger) => {
      if (controller.signal.aborted || r.status !== "active") return;
      if (j.queue.length >= LIMITS.queue) {
        r.gap = true;
        if (admitted)
          this.finish(j, "coverage_failure", "event_queue_overflow");
        else {
          setupLost = true;
          controller.abort();
        }
        return;
      }
      j.queue.push(trigger);
      if (admitted) this.schedule();
    };
    try {
      for (const [i, selection] of reg.events.entries()) {
        const sub = await this.host.subscribe(
          selection,
          reg,
          controller.signal,
          r.deadline,
          (payload) =>
            enqueue({
              kind: "event",
              at: this.clock.now(),
              subscription: i,
              payload,
            }),
          () => {
            if (admitted) {
              r.gap = true;
              this.finish(j, "coverage_failure", "coverage_lost");
            } else {
              setupLost = true;
              controller.abort();
            }
          },
        );
        j.subs.push(sub);
        r.coverage.push(sub.coverage);
        if (setupLost || controller.signal.aborted) throw new Error();
      }
      if (
        this.closed ||
        signal?.aborted ||
        controller.signal.aborted ||
        this.clock.now() >= Math.min(r.deadline, r.cycleDeadline)
      )
        throw new Error();
      if (reg.source) enqueue({ kind: "initial", at: this.clock.now() });
      else if (reg.delayMs !== undefined)
        r.nextAt = this.clock.now() + reg.delayMs;
      // Commit admission only after all coverage is established. Queued setup events precede initial evaluation.
      admitted = true;
      this.jobs.set(r.id, j);
      this.publish("registered", j);
      this.trim();
      this.save(j);
      this.schedule();
      return structuredClone(r);
    } catch {
      controller.abort();
      j.subs.forEach((s) => s.close());
      throw new RequestError(
        "Monitor registration failed or cancelled; no job admitted and no coverage claimed.",
      );
    } finally {
      signal?.removeEventListener("abort", abort);
      this.reservations.delete(controller);
    }
  }
  private trim() {
    for (const [id, j] of this.jobs) {
      if (this.jobs.size <= LIMITS.receipts) break;
      if (!this.occupied(j)) this.jobs.delete(id);
    }
  }
  private stopObservation(j: Job) {
    j.r.endedAt ??= this.clock.now();
    j.controller.abort();
    j.execution?.abort();
    j.subs.forEach((s) => {
      try {
        s.close();
      } catch {
        /* no replay */
      }
    });
    j.subs = [];
    j.queue = [];
    delete j.r.nextAt;
    delete j.reg.source;
  }
  private attention(j: Job, reason: Reason) {
    j.cycleOpen = false;
    if (j.reg.delayMs !== undefined) delete j.r.nextAt;
    const existing = j.r.attention;
    const before = existing?.reason;
    if (existing?.disposition === "pending") {
      // Failure/budget outrank a condition. Timeout must never masquerade as condition success.
      const rank = {
        condition: 0,
        timeout: 1,
        budget_exhausted: 2,
        evaluation_failure: 3,
        coverage_failure: 4,
      };
      if (rank[reason] > rank[existing.reason]) existing.reason = reason;
    } else {
      j.r.attention = {
        id: uuid(),
        reason,
        at: this.clock.now(),
        disposition: j.r.wakes < j.r.maxWakes ? "pending" : "suppressed",
        admitted: false,
      };
    }
    if (!j.reg.recurring) {
      if (reason === "timeout" && (j.r.inFlight || j.queue.length))
        j.r.interrupted = true;
      j.r.status = "finished";
      this.stopObservation(j);
    }
    if (!existing || before !== j.r.attention?.reason)
      this.publish("attention", j);
    if (!j.reg.recurring) this.publish("terminated", j);
    this.save(j);
  }
  private finish(j: Job, reason: Reason, code?: string) {
    if (j.r.status !== "active") return;
    j.r.status = "finished";
    if (code) j.r.failureCode = code;
    if (j.r.inFlight) j.r.interrupted = true;
    this.stopObservation(j);
    if (j.reg.recurring) this.publish("terminated", j);
    this.attention(j, reason);
    this.schedule();
  }
  cancel(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new RequestError("Unknown Monitor job.");
    if (j.r.status === "active" || j.r.attention?.disposition === "pending") {
      j.r.status = "cancelled";
      if (j.r.attention?.disposition === "pending")
        j.r.attention.disposition = "suppressed";
      if (j.r.inFlight) j.r.interrupted = true;
      this.stopObservation(j);
      this.publish("terminated", j);
      this.save(j);
      this.schedule();
    }
    return this.get(id)!;
  }
  admitted(wakeId: string) {
    for (const j of this.jobs.values()) {
      if (j.waiting === wakeId && j.r.lastAttention?.id === wakeId) {
        j.r.lastAttention.admitted = true;
        this.save(j);
      }
    }
  }
  settled() {
    if (this.closed) return;
    for (const j of this.jobs.values()) {
      if (
        j.waiting &&
        j.r.lastAttention?.id === j.waiting &&
        j.r.lastAttention.admitted
      ) {
        j.waiting = undefined;
        j.r.awaitingSettlement = false;
        if (j.r.status !== "active") {
          this.save(j);
          continue;
        }
        if (j.r.wakes >= j.r.maxWakes) {
          this.finish(j, "budget_exhausted", "wake_limit");
          continue;
        }
        j.cycleOpen = true;
        j.r.cycleDeadline = this.clock.now() + j.reg.cycleMs;
        if (j.reg.delayMs !== undefined)
          j.r.nextAt = this.clock.now() + j.reg.delayMs;
        this.save(j);
      }
    }
    this.schedule();
  }
  private schedule() {
    if (this.closed) return;
    if (this.timer !== undefined) this.clock.clear(this.timer);
    const now = this.clock.now();
    let next = Infinity;
    for (const j of this.jobs.values()) {
      if (j.r.status === "active") {
        next = Math.min(
          next,
          j.r.deadline,
          j.cycleOpen ? j.r.cycleDeadline : Infinity,
        );
        if (!j.r.inFlight && this.running < LIMITS.concurrent) {
          if (j.queue.length) next = Math.min(next, now);
          if (j.r.nextAt !== undefined) next = Math.min(next, j.r.nextAt);
        }
      }
      if (
        j.r.attention?.disposition === "pending" &&
        !j.r.inFlight &&
        !j.waiting &&
        this.host.idle()
      )
        next = Math.min(next, now);
    }
    this.timer = Number.isFinite(next)
      ? this.clock.set(
          () => {
            this.timer = undefined;
            this.tick();
          },
          Math.max(0, next - now),
        )
      : undefined;
  }
  private tick() {
    if (this.closed) return;
    const now = this.clock.now();
    for (const j of this.jobs.values()) {
      if (j.r.status === "active") {
        if (now >= j.r.deadline) {
          this.finish(j, "budget_exhausted", "lifetime_limit");
        } else if (j.cycleOpen && now >= j.r.cycleDeadline) {
          this.attention(j, "timeout");
        }
      }
      if (
        j.r.status === "active" &&
        !j.r.inFlight &&
        this.running < LIMITS.concurrent
      ) {
        const trigger =
          j.queue.shift() ??
          (j.r.nextAt !== undefined && now >= j.r.nextAt
            ? { kind: "timer" as const, at: now }
            : undefined);
        if (trigger) {
          if (trigger.kind === "timer") delete j.r.nextAt;
          if (j.reg.source) this.evaluate(j, trigger);
          else {
            j.r.evidence = trigger.payload ?? null;
            j.r.evidenceAt = now;
            this.attention(j, "condition");
          }
        }
      }
      if (
        j.r.attention?.disposition === "pending" &&
        !j.r.inFlight &&
        !j.waiting &&
        this.host.idle()
      )
        this.deliver(j);
    }
    this.schedule();
  }
  private deliver(j: Job) {
    const a = j.r.attention!;
    if (j.r.wakes >= j.r.maxWakes) {
      a.disposition = "suppressed";
      this.save(j);
      return;
    }
    a.disposition = "handoff_unknown";
    j.r.wakes++;
    j.cycleOpen = false;
    j.r.awaitingSettlement = true;
    j.r.lastAttention = a;
    delete j.r.attention;
    j.waiting = a.id;
    this.save(j);
    if (this.closed) return;
    this.publish("notification", j);
    try {
      this.host.handoff(structuredClone(j.r), j.reg.message);
      a.disposition = "handed_to_pi";
      this.publish("notification", j);
      this.save(j);
    } catch {
      // No resend, even if the synchronous API appears to have failed before admission.
      j.r.status = "finished";
      j.r.failureCode = "handoff_unknown";
      this.stopObservation(j);
      this.publish("terminated", j);
      this.save(j);
    }
  }
  private evaluate(j: Job, trigger: Trigger) {
    if (j.r.evaluations >= LIMITS.evaluations) {
      this.finish(j, "budget_exhausted", "evaluation_limit");
      return;
    }
    j.r.evaluations++;
    j.r.inFlight = true;
    this.running++;
    const controller = (j.execution = new AbortController());
    this.save(j);
    if (this.closed) {
      this.running--;
      j.r.inFlight = false;
      return;
    }
    const deadline = Math.min(j.r.deadline, this.clock.now() + 30000);
    void Promise.resolve()
      .then(() =>
        this.host.evaluate(
          j.reg,
          trigger,
          structuredClone(j.r.state),
          controller.signal,
          deadline,
        ),
      )
      .then(
        (result) => {
          const { json: _json, code, ...accounting } = result;
          j.r.accounting = {
            ...accounting,
            ...(code !== undefined ? { code } : {}),
          };
          j.r.calls += result.traces.length;
          j.r.effectsMayPersist ||= result.effectsMayPersist;
          j.r.outcomeUnknown ||= result.outcomeUnknown;
          if (this.closed || j.r.status !== "active") return;
          // A result processed after lifetime cannot commit state or satisfy a condition.
          if (this.clock.now() >= j.r.deadline) {
            this.finish(j, "budget_exhausted", "lifetime_limit");
            return;
          }
          if (j.cycleOpen && this.clock.now() >= j.r.cycleDeadline) {
            this.attention(j, "timeout");
            if (j.r.status !== "active") return;
          }
          try {
            const value = observation(result);
            if (Object.hasOwn(value, "state")) j.r.state = value.state!;
            j.r.evidence = value.evidence;
            j.r.evidenceAt = this.clock.now();
            if (value.decision === "wake") this.attention(j, "condition");
          } catch {
            this.finish(
              j,
              "evaluation_failure",
              result.code ?? "invalid_observation",
            );
          }
        },
        () => {
          if (!this.closed && j.r.status === "active")
            this.finish(j, "evaluation_failure", "executor_failed");
        },
      )
      .finally(() => {
        this.running--;
        j.r.inFlight = false;
        j.execution = undefined;
        if (this.closed) return;
        if (j.r.status === "active" && j.reg.intervalMs !== undefined)
          j.r.nextAt = this.clock.now() + j.reg.intervalMs;
        this.save(j);
        this.schedule();
      });
  }
  close(persist: boolean) {
    if (this.closed) return;
    if (this.timer !== undefined) this.clock.clear(this.timer);
    this.timer = undefined;
    this.reservations.forEach((c) => c.abort());
    for (const j of this.jobs.values()) {
      if (this.occupied(j)) {
        j.r.status = "invalidated";
        if (j.r.attention?.disposition === "pending")
          j.r.attention.disposition = "suppressed";
        if (j.r.inFlight) j.r.interrupted = true;
        this.stopObservation(j);
        this.publish("terminated", j);
        if (persist) {
          try {
            this.host.persist(structuredClone(j.r));
          } catch {
            /* suppress, no retry */
          }
        }
      }
    }
    this.closed = true;
    this.host.changed();
  }
  restore(receipts: Receipt[]) {
    if (this.jobs.size || this.reservations.size)
      throw new Error("restore_requires_empty_engine");
    for (const r of receipts.slice(-LIMITS.receipts)) {
      if (r.status === "active") r.status = "invalidated";
      if (r.attention?.disposition === "pending")
        r.attention.disposition = "suppressed";
      r.interrupted ||= r.inFlight;
      // Restored inFlight is historical accounting only, never an occupied execution.
      r.inFlight = false;
      r.awaitingSettlement = false;
      this.jobs.set(r.id, {
        r,
        reg: {} as Registration,
        queue: [],
        subs: [],
        controller: new AbortController(),
        cycleOpen: false,
      });
    }
  }
}
