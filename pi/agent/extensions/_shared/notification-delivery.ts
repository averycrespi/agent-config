import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type NotificationHold = "input" | "dialog" | "draft" | "unavailable";

/** Safety is independent of agent idleness. Never inspect or mutate headless UI. */
export function notificationHold(
  ctx: ExtensionContext,
  dialogs: number,
): NotificationHold | undefined {
  try {
    if (dialogs > 0) return "dialog";
    if (ctx.hasPendingMessages()) return "input";
    if (ctx.mode === "tui" && ctx.ui.getEditorText().length) return "draft";
    return undefined;
  } catch {
    return "unavailable";
  }
}
