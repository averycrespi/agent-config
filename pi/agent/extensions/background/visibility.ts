import type { Execution } from "./api.ts";
import type { WidgetConfig } from "./config.ts";
import { visible } from "./service.ts";

/** Presentation only: never reuse this predicate for attention or retention. */
export function widgetVisible(
  r: Execution,
  config: WidgetConfig,
  now: number,
  queued = false,
) {
  return (
    visible(r) &&
    (queued ||
      r.status === "running" ||
      !config.autoHide ||
      r.notification.handoff !== "handed_to_pi" ||
      r.notification.handedAt === undefined ||
      now - r.notification.handedAt < config.terminalHideAfterMs)
  );
}
