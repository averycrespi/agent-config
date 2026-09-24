import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { createPersistentWidget, fitWidgetRow } from "../_shared/widget.ts";
import {
  SERVICE_EVENT,
  type BackgroundService,
  type Execution,
} from "./api.ts";
import { Service, label, visible } from "./service.ts";
import { fileStore } from "./store.ts";

export const NOTIFICATION = "background:execution-outcome-v1";
export function widgetLines(records: Execution[], width: number, theme: Theme) {
  return records
    .filter(visible)
    .map((r) =>
      fitWidgetRow(
        `${theme.fg("muted", "background")} ${theme.fg(r.status === "running" ? "accent" : ["failed", "timeout", "interrupted"].includes(r.status) ? "error" : "warning", r.status)}`,
        [
          ...(r.outcomeUnknown ? [theme.fg("warning", "effects unknown")] : []),
          ...(r.progress
            ? [
                theme.fg(
                  r.progress.failed ? "warning" : "text",
                  `${r.progress.completed}/${r.progress.total} settled${r.progress.failed ? ` · ${r.progress.failed} failed` : ""}`,
                ),
              ]
            : []),
          theme.fg("muted", r.id.slice(0, 8)),
        ],
        width,
        theme.fg("dim", " · "),
        theme.fg("text", label(r.label)),
      ),
    );
}
export default function background(pi: ExtensionAPI) {
  let service: Service | undefined;
  let ctx: ExtensionContext | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let prompt = false;
  let candidateIds = new Set<string>();
  const widget = createPersistentWidget("background-executions");
  const refresh = () => {
    if (!ctx || !service) return;
    const rows = service.all();
    widget.update(
      ctx,
      rows.some(visible) ? (w, t) => widgetLines(rows, w, t) : undefined,
    );
  };
  const close = () => {
    clearInterval(ticker);
    ticker = undefined;
    const old = service;
    service = undefined;
    candidateIds.clear();
    try {
      old?.close();
    } finally {
      if (ctx) widget.update(ctx);
      ctx = undefined;
    }
  };
  const initialize = (context: ExtensionContext) => {
    close();
    ctx = context;
    const file = context.sessionManager.getSessionFile();
    if (!file) return; // Persisted admission is impossible in ephemeral sessions.
    try {
      service = new Service(fileStore(file), {
        anchor: () => context.sessionManager.getLeafId() ?? "",
        inBranch: (anchor) =>
          context.sessionManager.getBranch().some((e) => e.id === anchor),
        idle: () =>
          !prompt &&
          context.isIdle() &&
          !context.hasPendingMessages() &&
          (context.mode !== "tui" || context.ui.getEditorText().length === 0),
        changed: refresh,
        event: (type, r) =>
          pi.events.emit(`background:${type}`, {
            id: r.id,
            owner: r.owner,
            status: r.status,
            notificationId: r.notification.id,
            handoff: r.notification.handoff,
            consumed: r.notification.consumed,
          }),
        handoff: (r) =>
          pi.sendMessage(
            {
              customType: NOTIFICATION,
              content: `Background ${r.owner} execution ${r.id}: ${r.status}. Inspect with ${r.owner} action inspect and id ${r.id}. Effects may persist; reconcile unknown effects. This notification is not acceptance and never authorizes replay.`,
              display: true,
              details: { executionId: r.id, notificationId: r.notification.id },
            },
            { deliverAs: "followUp", triggerTurn: true },
          ),
      });
      refresh();
      // Delivery readiness only: no executor scheduling, retries or deadline renewal.
      ticker = setInterval(() => {
        try {
          service?.flush();
        } catch {
          refresh();
        }
      }, 1000);
      ticker.unref();
      service.flush();
    } catch {
      if (context.hasUI)
        context.ui.notify(
          "Background storage unavailable; no execution or notification replay. Inspect retained session sidecar.",
          "error",
        );
    }
  };
  pi.events.on(SERVICE_EVENT, (request: unknown) => {
    const accept = (request as { accept?: (s: BackgroundService) => void })
      ?.accept;
    if (service && typeof accept === "function") accept(service);
  });
  pi.on("session_start", (_e, context) => initialize(context));
  pi.on("session_tree", (_e, context) => initialize(context));
  pi.on("session_shutdown", close);
  pi.on("ui_prompt_start", () => {
    prompt = true;
  });
  pi.on("ui_prompt_end", () => {
    prompt = false;
  });
  pi.on("agent_settled", () => {
    service?.flush();
  });
  pi.on("context", (event) => {
    candidateIds = new Set(
      event.messages.flatMap((m) => {
        if (m.role !== "custom" || m.customType !== NOTIFICATION) return [];
        const id = (m.details as { notificationId?: unknown } | undefined)
          ?.notificationId;
        return typeof id === "string" ? [id] : [];
      }),
    );
  });
  pi.on("after_provider_response", (event) => {
    if (event.status >= 200 && event.status < 300)
      service?.consumed(candidateIds);
    candidateIds.clear();
  });
}
