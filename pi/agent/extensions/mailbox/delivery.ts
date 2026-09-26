import { MailboxStore, MailboxBusy, eligible, type Message } from "./store.ts";
import type { DeliveryConfig } from "./config.ts";
export type Hold = "idle" | "draft" | "dialog" | "unavailable" | null;
export interface DeliveryStatus {
  pending: number;
  limited: number;
  uncertain: number;
  wakeAt?: number;
  redeliveryAt?: number;
  hold: Hold;
  unavailable: boolean;
}
export class Delivery {
  private wakeAt?: number;
  private failed = false;
  constructor(
    readonly store: MailboxStore,
    readonly mailbox: string,
    readonly config: DeliveryConfig,
    readonly handoff: (messages: Message[], now: number) => void,
    readonly warning: (count: number) => void,
    readonly now = Date.now,
  ) {}
  clear() {
    const removed = this.store.clear(this.mailbox);
    this.wakeAt = undefined;
    return removed;
  }
  tick(hold: Hold): DeliveryStatus {
    if (this.failed)
      return { pending: 0, limited: 0, uncertain: 0, hold, unavailable: true };
    try {
      let rows = this.store.snapshot(this.mailbox);
      const now = this.now();
      const ready = rows.some((r) =>
        eligible(r, this.config.maxDeliveryAttempts, now),
      );
      if (!ready) this.wakeAt = undefined;
      else this.wakeAt ??= now + this.config.batchWindowMs;
      if (this.wakeAt !== undefined && this.wakeAt <= now && !hold) {
        try {
          const result = this.store.deliver(
            this.mailbox,
            this.config.maxDeliveryAttempts,
            this.config.visibilityTimeoutMs,
            this.handoff,
            this.now,
          );
          this.wakeAt = undefined;
          if (result.limited) this.warning(result.limited);
          rows = this.store.snapshot(this.mailbox);
        } catch (error) {
          // Writer-lock contention precedes any delivery effect. Keep the batch;
          // a later observation rechecks current rows rather than replaying a send.
          if (!(error instanceof MailboxBusy)) throw error;
          hold = "idle";
        }
      }
      const future = rows
        .filter(
          (r) =>
            r.attempts < this.config.maxDeliveryAttempts &&
            !r.uncertain &&
            r.visibleUntil !== null &&
            r.visibleUntil > now,
        )
        .map((r) => r.visibleUntil!);
      return {
        pending: rows.length,
        limited: rows.filter(
          (r) => r.attempts >= this.config.maxDeliveryAttempts,
        ).length,
        uncertain: rows.filter((r) => r.uncertain).length,
        wakeAt: this.wakeAt,
        redeliveryAt: future.length ? Math.min(...future) : undefined,
        hold,
        unavailable: false,
      };
    } catch {
      this.failed = true;
      return { pending: 0, limited: 0, uncertain: 0, hold, unavailable: true };
    }
  }
}
