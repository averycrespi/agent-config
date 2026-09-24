import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { snapshotScriptJson } from "../script/api.ts";
import type {
  Admission,
  BackgroundService,
  Execution,
  Outcome,
} from "./api.ts";
import { LIMITS, validateProgress, type Store } from "./store.ts";

export const label = (value: string) =>
  stripVTControlCharacters(value)
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
export const visible = (r: Execution) =>
  r.status === "running" || (!r.dismissed && !r.notification.consumed);
export type Hooks = {
  anchor(): string;
  inBranch(anchor: string): boolean;
  idle(): boolean;
  changed(): void;
  handoff(record: Execution): void;
  event(
    type: "admitted" | "terminal" | "notification" | "dismissed",
    record: Execution,
  ): void;
};
export class Service implements BackgroundService {
  private records: Execution[];
  private active = new Map<string, AbortController>();
  private open = true;
  private broken = false;
  constructor(
    private store: Store,
    private hooks: Hooks,
  ) {
    this.records = store.read();
    let interrupted = false;
    this.records = this.records.map((r) => {
      if (r.status !== "running") return r;
      interrupted = true;
      return {
        ...r,
        status: "interrupted",
        endedAt: Date.now(),
        effectsMayPersist: true,
        outcomeUnknown: true,
        notification: { ...r.notification, intent: true },
      };
    });
    if (interrupted) this.save(this.records);
  }
  private save(next: Execution[]) {
    try {
      this.store.write(next);
    } catch {
      this.broken = true;
      for (const controller of this.active.values()) controller.abort();
      this.records = this.records.map((r) => ({
        ...r,
        persistenceFailed: true,
        ...(r.status === "running"
          ? {
              status: "interrupted" as const,
              endedAt: Date.now(),
              effectsMayPersist: true,
              outcomeUnknown: true,
            }
          : {}),
      }));
      this.refresh();
      throw new Error("background_storage_failed_no_replay");
    }
    this.records = next;
  }
  private change(r: Execution, type?: Parameters<Hooks["event"]>[0]) {
    this.save(this.records.map((old) => (old.id === r.id ? r : old)));
    this.refresh();
    if (type) {
      try {
        this.hooks.event(type, structuredClone(r));
      } catch {
        /* Observational only. */
      }
    }
  }
  private refresh() {
    try {
      this.hooks.changed();
    } catch {
      /* Display cannot change admission. */
    }
  }
  private ready() {
    if (!this.open || this.broken) throw new Error("background_unavailable");
  }
  list(owner: string) {
    return structuredClone(
      this.records.filter(
        (r) => r.owner === owner && this.hooks.inBranch(r.anchor),
      ),
    );
  }
  all() {
    return structuredClone(
      this.records.filter((r) => this.hooks.inBranch(r.anchor)),
    );
  }
  inspect(owner: string, id: string) {
    const r = this.list(owner).find((r) => r.id === id);
    if (!r) throw new Error("background_unknown_execution");
    return r;
  }
  admit(request: Admission) {
    this.ready();
    const now = Date.now();
    if (
      !request ||
      !/^[a-z][a-z0-9_-]{0,47}$/.test(request.owner) ||
      typeof request.label !== "string" ||
      !label(request.label) ||
      request.label.length > 200 ||
      !Number.isSafeInteger(request.deadlineMs) ||
      request.deadlineMs <= now ||
      typeof request.run !== "function"
    )
      throw new Error("background_invalid_admission");
    if (
      this.active.size >= LIMITS.active ||
      this.records.length >= LIMITS.retained ||
      this.records.filter((r) => !r.dismissed && !r.notification.consumed)
        .length >= LIMITS.notifications
    )
      throw new Error("background_capacity");
    const anchor = this.hooks.anchor();
    if (!anchor) throw new Error("background_persistence_required");
    const record: Execution = {
      id: randomUUID(),
      owner: request.owner,
      label: label(request.label),
      anchor,
      createdAt: now,
      deadlineMs: request.deadlineMs,
      status: "running",
      cancelRequested: false,
      dismissed: false,
      effectsMayPersist: false,
      outcomeUnknown: false,
      notification: {
        id: randomUUID(),
        intent: false,
        handoff: "none",
        consumed: false,
      },
    };
    this.save([...this.records, record]);
    const controller = new AbortController();
    this.active.set(record.id, controller);
    this.refresh();
    try {
      this.hooks.event("admitted", structuredClone(record));
    } catch {
      /* Observational only. */
    }
    // No work before durable admission; rejection is handled even on shutdown.
    void Promise.resolve()
      .then(async () => {
        if (!this.open || this.broken) return;
        let outcome: Outcome;
        try {
          outcome = await request.run(controller.signal, (update) => {
            if (!this.open || this.broken) return;
            validateProgress(update.progress);
            const current = this.records.find((r) => r.id === record.id)!;
            if (current.status !== "running") return;
            if (
              current.progress &&
              (update.progress.total !== current.progress.total ||
                update.progress.completed < current.progress.completed ||
                update.progress.failed < current.progress.failed)
            )
              throw new Error("background_invalid_progress");
            const result =
              update.result === undefined
                ? current.result
                : JSON.parse(
                    snapshotScriptJson(update.result, LIMITS.resultBytes),
                  );
            this.change({
              ...current,
              progress: { ...update.progress },
              ...(result === undefined ? {} : { result }),
            });
          });
        } catch {
          outcome = {
            status: "failed",
            effectsMayPersist: true,
            outcomeUnknown: true,
          };
        }
        if (!this.open || this.broken) return;
        const current = this.records.find((r) => r.id === record.id)!;
        try {
          const result =
            outcome.result === undefined
              ? undefined
              : JSON.parse(
                  snapshotScriptJson(outcome.result, LIMITS.resultBytes),
                );
          if (
            ![
              "success",
              "failed",
              "cancelled",
              "timeout",
              "interrupted",
            ].includes(outcome.status) ||
            typeof outcome.effectsMayPersist !== "boolean" ||
            typeof outcome.outcomeUnknown !== "boolean"
          )
            throw new Error("invalid_outcome");
          this.change(
            {
              ...current,
              ...outcome,
              ...(result === undefined ? {} : { result }),
              endedAt: Date.now(),
              notification: { ...current.notification, intent: true },
            },
            "terminal",
          );
        } catch {
          if (!this.broken)
            this.change(
              {
                ...current,
                status: "failed",
                effectsMayPersist: true,
                outcomeUnknown: true,
                endedAt: Date.now(),
                notification: { ...current.notification, intent: true },
              },
              "terminal",
            );
        }
        this.active.delete(record.id);
        this.flush();
      })
      .catch(() => {
        this.refresh();
      });
    return structuredClone(record);
  }
  cancel(owner: string, id: string) {
    this.ready();
    const r = this.inspect(owner, id);
    if (r.status === "running" && !r.cancelRequested) {
      r.cancelRequested = true;
      this.change(r);
      this.active.get(id)?.abort();
    }
    return r;
  }
  dismiss(owner: string, id: string) {
    this.ready();
    const r = this.inspect(owner, id);
    if (r.status === "running") throw new Error("background_active_execution");
    if (!r.dismissed) {
      r.dismissed = true;
      this.change(r, "dismissed");
    }
    return r;
  }
  flush() {
    if (!this.open || this.broken || !this.hooks.idle()) return;
    for (const r of this.all()) {
      if (!this.hooks.idle()) break;
      if (
        !r.notification.intent ||
        r.dismissed ||
        r.notification.consumed ||
        r.notification.handoff !== "none"
      )
        continue;
      // Persist uncertain handoff BEFORE the effect. Never replay even if send throws.
      const next = {
        ...r,
        notification: { ...r.notification, handoff: "unknown" as const },
      };
      this.change(next, "notification");
      try {
        this.hooks.handoff(structuredClone(next));
      } catch {
        continue;
      }
      const current = this.records.find((x) => x.id === r.id)!;
      this.change(
        {
          ...current,
          notification: { ...current.notification, handoff: "handed_to_pi" },
        },
        "notification",
      );
    }
  }
  consumed(ids: Set<string>) {
    if (!this.open || this.broken) return;
    for (const r of this.all())
      if (
        ids.has(r.notification.id) &&
        r.notification.handoff !== "none" &&
        !r.notification.consumed
      )
        this.change(
          { ...r, notification: { ...r.notification, consumed: true } },
          "notification",
        );
  }
  close() {
    if (!this.open) return;
    this.open = false;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    const next = this.records.map((r) =>
      r.status === "running"
        ? {
            ...r,
            status: "interrupted" as const,
            endedAt: Date.now(),
            effectsMayPersist: true,
            outcomeUnknown: true,
            notification: { ...r.notification, intent: true },
          }
        : r,
    );
    if (!this.broken) this.save(next);
  }
}
