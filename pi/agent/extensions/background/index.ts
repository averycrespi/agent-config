import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  executionCounts,
  executionState,
  executionTokens,
  executionWarnings,
} from "./display.ts";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { createPersistentWidget } from "../_shared/widget.ts";
import { formatDuration } from "../_shared/render.ts";
import {
  notificationRenderer,
  executionType,
  type NotificationDisplay,
} from "../_shared/notification.ts";
import {
  SERVICE_EVENT,
  type BackgroundService,
  type Execution,
} from "./api.ts";
import { Service, label, visible } from "./service.ts";
import { fileStore } from "./store.ts";
import { registerConfigCommand } from "../_shared/config.ts";
import { DEFAULT_WIDGET_CONFIG, loadBackgroundConfig } from "./config.ts";
import { widgetVisible } from "./visibility.ts";

export const NOTIFICATION = "background:execution-outcome-v1";
export function widgetLines(
  records: Execution[],
  width: number,
  theme: Theme,
  now = Date.now(),
) {
  return records.filter(visible).map((r) => {
    const singleChild = r.owner === "subagents" && r.progress?.total === 1;
    const elapsed = formatDuration(
      Math.max(0, (r.endedAt ?? now) - r.createdAt),
    );
    const [state, color] = executionState(r.status);
    const primary = `${theme.fg("muted", executionType(r.owner, r.progress?.total))} ${theme.fg(color, r.status === "running" && r.cancelRequested ? "cancellation requested" : state)}`;
    const warnings = executionWarnings(r);
    const separator = theme.fg("dim", " · ");
    const narrow =
      visibleWidth([primary, ...warnings.map(([full]) => full)].join(" · ")) >
      width;
    const warning = warnings
      .map(([full, compact]) => theme.fg("warning", narrow ? compact : full))
      .join(theme.fg("dim", narrow ? "/" : " · "));
    const counts = singleChild ? undefined : executionCounts(r, theme);
    const tokens = executionTokens(r);
    const fields = [
      counts,
      tokens ? theme.fg("text", tokens) : undefined,
      theme.fg("text", elapsed),
    ].filter((value): value is string => Boolean(value));
    const name = theme.fg("text", label(r.label));
    const compose = (identity: string) =>
      primary +
      (identity ? ` ${identity}` : "") +
      [...fields, ...(warning ? [warning] : [])]
        .map((field) => separator + field)
        .join("");
    const w = Math.max(0, width);
    while (
      fields.length &&
      visibleWidth(compose(truncateToWidth(name, 8, "…"))) > w
    )
      fields.pop();
    const available = w - visibleWidth(compose("")) - 1;
    return truncateToWidth(
      compose(available >= 8 ? truncateToWidth(name, available, "…") : ""),
      w,
      "…",
    );
  });
}
export default function background(pi: ExtensionAPI) {
  pi.registerMessageRenderer(NOTIFICATION, notificationRenderer("background"));
  let service: Service | undefined;
  let ctx: ExtensionContext | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  registerConfigCommand(pi, {
    extensionName: "background",
    loadConfig: loadBackgroundConfig,
  });
  let widgetConfig = { ...DEFAULT_WIDGET_CONFIG };
  let generation = 0;
  let prompt = false;
  let candidateIds = new Set<string>();
  const widget = createPersistentWidget("background-executions");
  let widgetShown = false;
  const refresh = () => {
    if (!ctx || !service) return;
    const now = Date.now();
    const rows = service
      .all()
      .filter((r) => widgetVisible(r, widgetConfig, now));
    if (rows.length || widgetShown)
      widget.update(
        ctx,
        rows.length ? (w, t) => widgetLines(rows, w, t) : undefined,
      );
    widgetShown = rows.length > 0;
  };
  const close = () => {
    generation++;
    clearInterval(ticker);
    ticker = undefined;
    const old = service;
    service = undefined;
    candidateIds.clear();
    try {
      old?.close();
    } finally {
      if (ctx) widget.update(ctx);
      widgetShown = false;
      ctx = undefined;
    }
  };
  const initialize = async (context: ExtensionContext) => {
    close();
    const currentGeneration = generation;
    const warnings: string[] = [];
    const config = await loadBackgroundConfig(context.cwd, warnings);
    if (generation !== currentGeneration) return;
    widgetConfig = config.widgets;
    if (context.hasUI && warnings.length)
      context.ui.notify(warnings.join("\n"), "warning");
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
              content: `Background ${r.owner} execution ${r.id}: ${r.status}. Inspect with ${r.owner === "subagents" ? "subagent" : r.owner} action inspect and id ${r.id}. Effects may persist; reconcile unknown effects. This notification is not acceptance and never authorizes replay.`,
              display: true,
              details: {
                executionId: r.id,
                notificationId: r.notification.id,
                display: {
                  version: 1,
                  name: r.label,
                  owner: r.owner,
                  total: r.progress?.total,
                  status: r.status,
                  outcomeUnknown: r.outcomeUnknown,
                  effectsMayPersist: r.effectsMayPersist,
                } satisfies NotificationDisplay,
              },
            },
            { deliverAs: "followUp", triggerTurn: true },
          ),
      });
      refresh();
      // Delivery readiness only: no executor scheduling, retries or deadline renewal.
      ticker = setInterval(() => {
        try {
          service?.flush();
          // Refresh expiry even with no running work or notification consumption.
          refresh();
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
