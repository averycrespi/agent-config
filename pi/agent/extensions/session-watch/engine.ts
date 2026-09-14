import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { filters, uuid, type EventName, type Notice } from "./events.ts";
import {
  finiteTimeout,
  observe,
  type Observation,
  type Target,
} from "./transport.ts";
import type { WatchEvent } from "./api.ts";

export class RequestError extends Error {}

export type State =
  | "active"
  | "match"
  | "deadline"
  | "failure"
  | "cancelled"
  | "invalidated";
export type Notification =
  | "none"
  | "pending"
  | "handoff_unknown"
  | "handed_to_pi"
  | "suppressed";
export interface Receipt {
  id: string;
  target: Target;
  name: string;
  events: EventName[];
  createdAt: number;
  startedAt: number;
  deadline: number;
  endedAt?: number;
  state: State;
  notification: Notification;
  event?: Notice;
}
interface Watch {
  receipt: Receipt;
  message?: string;
  observation?: Observation;
  timer?: ReturnType<typeof setTimeout>;
  delivery?: ReturnType<typeof setTimeout>;
}
interface Host {
  persist(receipt: Receipt): void;
  handoff(receipt: Receipt, message: string): void;
  changed(): void;
  event(event: WatchEvent): void;
  observe?: typeof observe;
}
export const label = (text: unknown, length = 80) =>
  typeof text === "string"
    ? stripVTControlCharacters(text)
        .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, length)
    : "";

export class WatchEngine {
  private watches = new Map<string, Watch>();
  private registrations = new Set<AbortController>();
  private closed = false;
  constructor(
    private root: string,
    private self: string,
    private host: Host,
  ) {}
  list() {
    return [...this.watches.values()].map((w) => structuredClone(w.receipt));
  }
  get(id: string) {
    const w = this.watches.get(id);
    return w && structuredClone(w.receipt);
  }
  private emit(type: WatchEvent["type"], receipt: Receipt) {
    try {
      this.host.event(
        Object.freeze({
          type,
          id: receipt.id,
          state: receipt.state,
          notification: receipt.notification,
        }),
      );
    } catch {
      /* observational */
    }
  }
  private save(w: Watch) {
    try {
      this.host.persist(structuredClone(w.receipt));
    } catch {
      this.close(false);
      return false;
    }
    this.host.changed();
    return true;
  }
  private occupied(w: Watch) {
    return w.receipt.state === "active" || w.receipt.notification === "pending";
  }
  async start(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Receipt> {
    const errors: string[] = [];
    if (!uuid(params.target) || params.target === this.self)
      errors.push("target must be another exact incarnation UUID from list.");
    if (!filters(params.events))
      errors.push("events must contain 1–8 distinct supported event names.");
    if (!finiteTimeout(params.timeout_ms))
      errors.push("timeout_ms must be an integer from 1000 to 86400000.");
    if (
      typeof params.message !== "string" ||
      params.message.length > 2000 ||
      !label(params.message)
    )
      errors.push("message must contain 1–2000 nonblank characters.");
    if (
      params.name !== undefined &&
      (typeof params.name !== "string" ||
        params.name.length > 80 ||
        !label(params.name))
    )
      errors.push("name must contain 1–80 nonblank characters.");
    if (this.closed || signal?.aborted)
      errors.push("Session context inactive or registration cancelled.");
    if (
      this.registrations.size +
        [...this.watches.values()].filter((w) => this.occupied(w)).length >=
      4
    )
      errors.push("Four occupied watches already registered.");
    if (errors.length) throw new RequestError(errors.join("\n"));
    const controller = new AbortController();
    this.registrations.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const createdAt = Date.now();
    const deadline = createdAt + (params.timeout_ms as number);
    let observation: Observation | undefined;
    try {
      observation = await (this.host.observe ?? observe)(
        this.root,
        params.target as string,
        params.events as EventName[],
        params.timeout_ms as number,
        controller.signal,
      );
      if (this.closed || controller.signal.aborted || Date.now() >= deadline)
        throw new RequestError(
          "Registration cancelled, expired, or session changed; no watch registered.",
        );
      const w: Watch = {
        receipt: {
          id: randomUUID(),
          target: observation.target,
          name: label(params.name) || (params.target as string),
          events: [...(params.events as EventName[])],
          createdAt,
          startedAt: observation.startedAt,
          deadline,
          state: "active",
          notification: "none",
        },
        message: params.message as string,
        observation,
      };
      if (this.watches.size >= 32) {
        const oldest = [...this.watches.values()].find(
          (item) => !this.occupied(item),
        );
        if (oldest) this.watches.delete(oldest.receipt.id);
      }
      this.watches.set(w.receipt.id, w);
      this.emit("registered", w.receipt);
      if (!this.save(w))
        throw new RequestError(
          "Receipt persistence failed; observation invalidated.",
        );
      w.timer = setTimeout(
        () => this.finish(w, "deadline"),
        Math.max(0, deadline - Date.now()),
      );
      w.timer.unref();
      void observation.result.then((event) => {
        if (this.closed || w.receipt.state !== "active") return;
        const endedAt = Date.now();
        this.finish(
          w,
          endedAt >= deadline ? "deadline" : event ? "match" : "failure",
          endedAt >= deadline ? undefined : event,
          true,
          endedAt,
        );
      });
      return structuredClone(w.receipt);
    } catch (error) {
      observation?.close();
      throw error;
    } finally {
      this.registrations.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  }
  private finish(
    w: Watch,
    state: Exclude<State, "active">,
    event?: Notice,
    persist = true,
    endedAt = Date.now(),
  ) {
    if (w.receipt.state !== "active" && w.receipt.notification !== "pending")
      return;
    clearTimeout(w.timer);
    clearTimeout(w.delivery);
    w.observation?.close();
    w.observation = undefined;
    const attention = ["match", "deadline", "failure"].includes(state);
    if (w.receipt.state === "active") {
      w.receipt.state = state;
      w.receipt.endedAt = endedAt;
      if (event) w.receipt.event = event;
    }
    w.receipt.notification = attention ? "pending" : "suppressed";
    this.emit("terminated", w.receipt);
    if (persist && !this.save(w)) return;
    if (!attention) {
      w.message = undefined;
      return;
    }
    w.delivery = setTimeout(() => {
      if (this.closed || w.receipt.notification !== "pending") return;
      w.receipt.notification = "handoff_unknown";
      if (!this.save(w)) return;
      this.emit("notification", w.receipt);
      try {
        this.host.handoff(structuredClone(w.receipt), w.message!);
        w.receipt.notification = "handed_to_pi";
        this.emit("notification", w.receipt);
        this.save(w);
      } catch {
        /* uncertain admission is never retried */
      }
      w.message = undefined;
    }, 0);
    w.delivery.unref();
  }
  cancel(id: string) {
    const w = this.watches.get(id);
    if (!w) return undefined;
    this.finish(w, "cancelled");
    return structuredClone(w.receipt);
  }
  close(persist = true) {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.registrations) c.abort();
    for (const w of this.watches.values())
      this.finish(w, "invalidated", undefined, persist);
    this.host.changed();
  }
  restore(receipts: Receipt[]) {
    for (const receipt of receipts.slice(-32)) {
      const r = structuredClone(receipt);
      if (r.state === "active") {
        r.state = "invalidated";
        r.endedAt = Date.now();
      }
      if (r.notification === "none" || r.notification === "pending")
        r.notification = "suppressed";
      this.watches.set(r.id, { receipt: r });
    }
  }
}
