import { randomUUID } from "node:crypto";
import {
  isRepeatSafeFailure,
  MAX_LIMITS,
  type CodeLimits,
  type RunResult,
} from "../code-mode/api.ts";
import { sanitizeGatewayText, redactCredentials } from "../mcp-gateway/api.ts";
import { DEFAULT_CONFIG, inRange, type MonitorConfig } from "./config.ts";

export const MAX_SOURCE_BYTES = 256 * 1024;
export const MAX_EVIDENCE_CHARS = 4096;
export type StartInput = {
  name?: string;
  description?: string;
  source?: string;
  message?: string;
  interval_ms?: number;
  timeout_ms?: number;
  poll_timeout_ms?: number;
  failure_limit?: number;
};
export type State =
  | "waiting"
  | "observing"
  | "condition"
  | "deadline"
  | "failure_limit"
  | "unsafe_failure"
  | "cancelled"
  | "invalidated";
export type Notification =
  | "none"
  | "pending"
  | "handed_to_pi"
  | "handoff_unknown"
  | "suppressed";
export type Receipt = {
  id: string;
  name: string;
  description: string;
  message: string;
  state: State;
  notification: Notification;
  createdAt: number;
  deadline: number;
  nextAt: number;
  endedAt?: number;
  intervalMs: number;
  pollTimeoutMs: number;
  failureLimit: number;
  limits: CodeLimits;
  polls: number;
  calls: number;
  failures: number;
  inFlight: boolean;
  evidence?: string;
  evidencePoll?: number;
  failure?: {
    code: string;
    codes: string[];
    partialExecution: boolean;
    effectsMayPersist: boolean;
    outcomeUnknown: boolean;
  };
};
type Monitor = {
  receipt: Receipt;
  source: string;
  controller?: AbortController;
};
export interface Clock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realClock: Clock = {
  now: Date.now,
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
export const active = (r: Receipt) =>
  r.state === "waiting" || r.state === "observing";
export const label = (value: unknown, max = 200) =>
  typeof value === "string"
    ? sanitizeGatewayText(value).replace(/\s+/g, " ").trim().slice(0, max)
    : "";
export interface Host {
  execute(
    source: string,
    limits: CodeLimits,
    signal: AbortSignal,
    deadline: number,
  ): Promise<RunResult>;
  persist(receipt: Receipt): void;
  handoff(receipt: Receipt): void;
  changed(): void;
}

export class MonitorEngine {
  private monitors = new Map<string, Monitor>();
  private timer?: unknown;
  private deliveryTimer?: unknown;
  private running = new Set<Promise<void>>();
  private closed = false;
  constructor(
    readonly config: MonitorConfig,
    private host: Host,
    private clock: Clock = realClock,
  ) {}

  list(): Receipt[] {
    return [...this.monitors.values()].map((m) => structuredClone(m.receipt));
  }
  get(id: string): Receipt | undefined {
    const r = this.monitors.get(id)?.receipt;
    return r && structuredClone(r);
  }
  private occupied(m: Monitor) {
    return (
      active(m.receipt) ||
      !!m.controller ||
      m.receipt.notification === "pending"
    );
  }
  start(
    input: StartInput,
    codeLimits: CodeLimits,
  ): { receipt?: Receipt; errors: string[] } {
    const errors: string[] = [];
    if (this.closed) errors.push("Session context is inactive.");
    if (
      !this.config.valid ||
      (Object.keys(DEFAULT_CONFIG) as Array<keyof typeof DEFAULT_CONFIG>).some(
        (k) => !inRange(k, this.config[k]),
      )
    )
      errors.push("Monitor configuration is invalid.");
    if (
      (Object.keys(MAX_LIMITS) as Array<keyof CodeLimits>).some(
        (k) =>
          !Number.isSafeInteger(codeLimits[k]) ||
          codeLimits[k] < 1 ||
          codeLimits[k] > MAX_LIMITS[k],
      )
    )
      errors.push("Code limits are invalid.");
    const fields = { name: 80, description: 200, message: 2000 };
    for (const [key, max] of Object.entries(fields)) {
      const value = input[key as keyof typeof fields];
      if (typeof value !== "string" || !label(value, max) || value.length > max)
        errors.push(`${key} must be nonblank and at most ${max} characters.`);
    }
    if (
      typeof input.source !== "string" ||
      !input.source.trim() ||
      Buffer.byteLength(input.source) > MAX_SOURCE_BYTES
    )
      errors.push("source must be nonblank and at most 256 KiB.");
    const intervalMs =
      input.interval_ms === undefined
        ? this.config.intervalMs
        : input.interval_ms;
    const timeoutMs =
      input.timeout_ms === undefined ? this.config.timeoutMs : input.timeout_ms;
    const pollTimeoutMs =
      input.poll_timeout_ms === undefined
        ? this.config.pollTimeoutMs
        : input.poll_timeout_ms;
    const failureLimit =
      input.failure_limit === undefined
        ? this.config.failureLimit
        : input.failure_limit;
    for (const [key, value] of Object.entries({
      intervalMs,
      timeoutMs,
      pollTimeoutMs,
      failureLimit,
    }))
      if (!inRange(key as keyof typeof DEFAULT_CONFIG, value))
        errors.push(`${key} is outside its finite range.`);
    const name = label(input.name, 80);
    if (
      [...this.monitors.values()].some(
        (m) => this.occupied(m) && m.receipt.name === name,
      )
    )
      errors.push("An active monitor already has this name.");
    if (
      [...this.monitors.values()].filter((m) => this.occupied(m)).length >=
      this.config.maxActive
    )
      errors.push("Active monitor limit reached.");
    if (errors.length) return { errors };
    const now = this.clock.now();
    const limits = {
      maxCalls: Math.min(codeLimits.maxCalls, this.config.maxCalls),
      maxConcurrency: Math.min(
        codeLimits.maxConcurrency,
        this.config.maxCallConcurrency,
      ),
      timeoutMs: Math.min(codeLimits.timeoutMs, pollTimeoutMs),
    };
    const receipt: Receipt = {
      id: randomUUID(),
      name,
      description: label(input.description),
      message: redactCredentials(input.message!).slice(0, 2000),
      state: "waiting",
      notification: "none",
      createdAt: now,
      deadline: now + timeoutMs,
      nextAt: now,
      intervalMs,
      pollTimeoutMs: limits.timeoutMs,
      failureLimit,
      limits,
      polls: 0,
      calls: 0,
      failures: 0,
      inFlight: false,
    };
    const m = { receipt, source: input.source! };
    this.monitors.set(receipt.id, m);
    this.save(m);
    this.schedule();
    return { errors, receipt: structuredClone(receipt) };
  }
  private save(m: Monitor, persist = true) {
    this.trim();
    if (persist) {
      try {
        this.host.persist(structuredClone(m.receipt));
      } catch {
        this.close(false);
        return;
      }
    }
    this.host.changed();
  }
  private trim() {
    const removable = [...this.monitors.values()].filter(
      (m) => !this.occupied(m),
    );
    for (const m of removable) {
      if (this.monitors.size <= this.config.receiptLimit) break;
      this.monitors.delete(m.receipt.id);
    }
  }
  private schedule() {
    if (this.timer !== undefined) this.clock.clear(this.timer);
    this.timer = undefined;
    if (this.closed) return;
    let at = Infinity;
    for (const m of this.monitors.values())
      if (active(m.receipt)) {
        at = Math.min(at, m.receipt.deadline);
        if (!m.controller && this.running.size < this.config.maxConcurrentPolls)
          at = Math.min(at, m.receipt.nextAt);
      }
    if (Number.isFinite(at))
      this.timer = this.clock.set(
        () => {
          this.timer = undefined;
          this.tick();
        },
        Math.max(0, at - this.clock.now()),
      );
  }
  private tick() {
    if (this.closed) return;
    const now = this.clock.now();
    for (const m of this.monitors.values())
      if (active(m.receipt) && now >= m.receipt.deadline)
        this.finish(m, "deadline");
    for (const m of this.monitors.values()) {
      if (this.running.size >= this.config.maxConcurrentPolls) break;
      if (!active(m.receipt) || m.controller || now < m.receipt.nextAt)
        continue;
      m.controller = new AbortController();
      m.receipt.state = "observing";
      m.receipt.polls++;
      m.receipt.inFlight = true;
      this.save(m);
      if (this.closed) break;
      const task = this.poll(m);
      this.running.add(task);
      void task.finally(() => {
        this.running.delete(task);
        this.schedule();
      });
    }
    this.schedule();
  }
  private async poll(m: Monitor) {
    let result: RunResult;
    try {
      result = await this.host.execute(
        m.source,
        m.receipt.limits,
        m.controller!.signal,
        m.receipt.deadline,
      );
    } catch {
      result = {
        status: "failed",
        code: "executor_error",
        traces: [],
        partialExecution: false,
        effectsMayPersist: true,
        outcomeUnknown: true,
      };
    }
    m.controller = undefined;
    if (this.closed) return;
    const r = m.receipt;
    r.inFlight = false;
    r.calls += result.traces.length;
    let decision:
      | { decision: "wait" | "notify"; evidence: unknown }
      | undefined;
    try {
      if (result.json && result.json.length <= MAX_EVIDENCE_CHARS + 100) {
        const value = JSON.parse(result.json);
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).sort().join() === "decision,evidence" &&
          ["wait", "notify"].includes(value.decision) &&
          JSON.stringify(value.evidence).length <= MAX_EVIDENCE_CHARS
        )
          decision = value;
      }
    } catch {
      /* Guest protocol failure is handled independently of host failures. */
    }
    if (decision) {
      r.evidence = redactCredentials(JSON.stringify(decision.evidence)).slice(
        0,
        MAX_EVIDENCE_CHARS,
      );
      r.evidencePoll = r.polls;
    }
    if (result.status !== "success")
      r.failure = {
        code: label(result.code ?? "observation_failed", 160),
        codes: result.traces
          .filter((t) => t.code)
          .map((t) => label(t.code, 160))
          .slice(0, 128),
        partialExecution: result.partialExecution,
        effectsMayPersist: result.effectsMayPersist,
        outcomeUnknown: result.outcomeUnknown,
      };
    if (!active(r)) {
      this.save(m);
      this.enqueue();
      return;
    }
    if (this.clock.now() >= r.deadline) {
      this.finish(m, "deadline");
      return;
    }
    if (result.status !== "success") {
      if (!isRepeatSafeFailure(result)) {
        this.finish(m, "unsafe_failure");
        return;
      }
      r.failures++;
      if (r.failures >= r.failureLimit) {
        this.finish(m, "failure_limit");
        return;
      }
    } else {
      if (!decision) {
        r.failure = {
          code: "invalid_observation",
          codes: [],
          partialExecution: result.effectsMayPersist,
          effectsMayPersist: result.effectsMayPersist,
          outcomeUnknown: result.outcomeUnknown,
        };
        this.finish(m, "unsafe_failure");
        return;
      }
      if (decision.decision === "notify") {
        this.finish(m, "condition");
        return;
      }
    }
    r.state = "waiting";
    r.nextAt = this.clock.now() + r.intervalMs;
    this.save(m);
  }
  private finish(m: Monitor, state: State) {
    const r = m.receipt;
    r.state = state;
    r.endedAt = this.clock.now();
    r.notification =
      state === "cancelled" || state === "invalidated"
        ? "suppressed"
        : "pending";
    m.source = "";
    m.controller?.abort();
    this.save(m);
    this.enqueue();
  }
  private enqueue() {
    if (
      this.closed ||
      this.deliveryTimer !== undefined ||
      ![...this.monitors.values()].some(
        (m) => m.receipt.notification === "pending" && !m.controller,
      )
    )
      return;
    this.deliveryTimer = this.clock.set(() => {
      this.deliveryTimer = undefined;
      if (this.closed) return;
      const m = [...this.monitors.values()].find(
        (m) => m.receipt.notification === "pending" && !m.controller,
      );
      if (!m) return;
      // Persist before crossing Pi's irreversible, unacknowledged handoff boundary.
      m.receipt.notification = "handoff_unknown";
      this.save(m);
      if (this.closed) return;
      try {
        this.host.handoff(structuredClone(m.receipt));
        m.receipt.notification = "handed_to_pi";
      } catch {
        /* The attempted handoff must never be replayed. */
      }
      this.save(m);
      this.enqueue();
    }, 0);
  }
  cancel(id: string): Receipt[] | undefined {
    const items =
      id === "all"
        ? [...this.monitors.values()]
        : [this.monitors.get(id)].filter((m): m is Monitor => !!m);
    if (!items.length && id !== "all") return undefined;
    for (const m of items) {
      if (active(m.receipt) || m.receipt.notification === "pending")
        this.finish(m, "cancelled");
    }
    this.schedule();
    return items.map((m) => structuredClone(m.receipt));
  }
  close(persist = true): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) this.clock.clear(this.timer);
    if (this.deliveryTimer !== undefined) this.clock.clear(this.deliveryTimer);
    this.timer = this.deliveryTimer = undefined;
    for (const m of this.monitors.values())
      if (active(m.receipt) || m.receipt.notification === "pending") {
        m.receipt.state = "invalidated";
        m.receipt.notification = "suppressed";
        m.receipt.endedAt = this.clock.now();
        m.source = "";
        m.controller?.abort();
        this.save(m, persist);
      }
  }
  async settled(): Promise<void> {
    await Promise.allSettled(this.running);
  }
  restore(receipts: Receipt[]) {
    if (this.monitors.size || this.closed) return;
    for (const raw of receipts.slice(-this.config.receiptLimit)) {
      const r = structuredClone(raw);
      if (active(r) || r.notification === "pending") {
        r.state = "invalidated";
        r.notification = "suppressed";
      }
      this.monitors.set(r.id, { receipt: r, source: "" });
    }
    this.host.changed();
  }
}
