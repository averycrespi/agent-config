import type { Execution } from "./api.ts";
import type { WidgetConfig } from "./config.ts";
import { visible } from "./service.ts";

/** Presentation only: never reuse this predicate for attention or retention. */
export function widgetVisible(r: Execution, config: WidgetConfig, now: number) {
  return (
    visible(r) &&
    (r.status === "running" ||
      !config.autoHide ||
      r.endedAt === undefined ||
      now - r.endedAt < config.terminalHideAfterMs)
  );
}
