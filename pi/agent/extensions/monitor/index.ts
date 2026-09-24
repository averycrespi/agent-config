import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describeScriptProviders, snapshotScriptJson } from "../script/api.ts";
import { createPersistentWidget } from "../_shared/widget.ts";
import {
  notificationRenderer,
  type NotificationDisplay,
} from "../_shared/notification.ts";
import { registerConfigCommand } from "../_shared/config.ts";
import { loadMonitorConfig, CONFIG_WARNING } from "./config.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { MonitorEngine } from "./engine.ts";
import { evaluateMonitor } from "./execution.ts";
import { registration, RequestError, isId, type Receipt } from "./contract.ts";
import { subscribeProvider, describeEvents } from "./providers.ts";
import { restore, RECEIPT_TYPE } from "./receipts.ts";
import {
  parameters,
  renderers,
  widgetLines,
  visible,
  summary,
  notificationContent,
  pollingWarning,
} from "./tool.ts";

export default async function monitor(pi: ExtensionAPI) {
  pi.registerMessageRenderer("monitor-wake", notificationRenderer("monitor"));
  // Historical observer messages are display-only; no legacy engine or replay.
  pi.registerMessageRenderer(
    "background-wake",
    notificationRenderer("monitor"),
  );
  const configWarnings: string[] = [];
  const config = Object.freeze(await loadMonitorConfig(configWarnings));
  registerConfigCommand(pi, {
    extensionName: "monitor",
    sensitiveFields: [],
    loadConfig: (_cwd, warnings = []) => {
      warnings.push(...configWarnings);
      if (!config.valid) warnings.push(CONFIG_WARNING);
      return { ...config };
    },
  });
  let generation = 0;
  let context: ExtensionContext | undefined;
  let engine: MonitorEngine | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const widget = createPersistentWidget("monitor");
  const refresh = () => {
    if (!context) return;
    if (!engine?.list().some(visible)) {
      clearInterval(ticker);
      ticker = undefined;
      widget.update(context);
      return;
    }
    widget.update(context, (width, theme) =>
      widgetLines(engine!.list(), Date.now(), width, theme),
    );
    if (context.hasUI && !ticker) {
      ticker = setInterval(refresh, 1000);
      ticker.unref();
    }
  };
  const close = (persist: boolean) => {
    engine?.close(persist);
    generation++;
    clearInterval(ticker);
    ticker = undefined;
    if (context) widget.update(context);
  };
  const initialize = (ctx: ExtensionContext) => {
    close(false);
    context = ctx;
    if (ctx.hasUI) {
      for (const warning of configWarnings) ctx.ui.notify(warning, "warning");
      if (!config.valid) ctx.ui.notify(CONFIG_WARNING, "warning");
    }
    const token = generation;
    const current = () => {
      if (token !== generation) throw new Error("stale_context");
    };
    engine = new MonitorEngine({
      idle: () => {
        if (token !== generation || !ctx.isIdle()) return false;
        // Runtime idleness is not human idleness. Never disturb a visible draft.
        if (ctx.mode === "tui") {
          try {
            return ctx.ui.getEditorText().length === 0;
          } catch {
            return false;
          }
        }
        return true;
      },
      persist: (r) => {
        current();
        pi.appendEntry(RECEIPT_TYPE, r);
      },
      changed: refresh,
      event: (event) => pi.events.emit(`monitor:${event.type}`, event),
      handoff: (r, message) => {
        current();
        pi.sendMessage(
          {
            customType: "monitor-wake",
            content: notificationContent(r, message),
            display: true,
            details: {
              jobId: r.id,
              wakeId: r.lastAttention!.id,
              display: {
                version: 1,
                name: r.name,
                status: r.lastAttention?.reason,
                outcomeUnknown: r.outcomeUnknown,
                effectsMayPersist: r.effectsMayPersist,
                interrupted: r.interrupted,
                gap: r.gap,
              } satisfies NotificationDisplay,
            },
          },
          ctx.mode === "rpc"
            ? { deliverAs: "nextTurn", triggerTurn: false }
            : { deliverAs: "followUp", triggerTurn: true },
        );
      },
      evaluate: (reg, trigger, state, signal, deadlineMs) =>
        evaluateMonitor(pi, ctx.cwd, reg, trigger, state, signal, deadlineMs),
      subscribe: (selection, reg, signal, deadlineMs, emit, lost) =>
        subscribeProvider(pi, ctx.cwd, reg.providers, selection, {
          signal,
          deadlineMs,
          emit,
          lost,
        }),
    });
    engine.restore(restore(ctx.sessionManager));
    refresh();
  };
  pi.on("session_start", (_e, ctx) => initialize(ctx));
  pi.on("session_before_tree", () => close(false));
  pi.on("session_tree", (_e, ctx) => initialize(ctx));
  pi.on("session_shutdown", () => {
    close(true);
    context = undefined;
  });
  pi.on("agent_settled", () => {
    engine?.settled();
  });
  pi.on("message_start", ({ message }) => {
    if (message.role === "custom" && message.customType === "monitor-wake") {
      const details = message.details as { wakeId?: unknown } | undefined;
      if (isId(details?.wakeId)) engine?.admitted(details.wakeId);
    }
  });
  pi.on("tool_result", (event) => {
    if (
      event.toolName === "monitor" &&
      (event.details as { monitorError?: boolean } | undefined)?.monitorError
    )
      return { isError: true };
    return undefined;
  });
  pi.registerTool({
    name: "monitor",
    label: "Monitor",
    parameters: parameters(config),
    ...renderers,
    description: `Bounded session-branch observation/continuation: start/list/get/cancel. ${config.valid ? "" : "Starts disabled by invalid configuration. "}Start requires name, message, explicit providers, cycle_timeout_ms (1000–${config.maxCycleTimeoutMs} ms), lifetime_ms (1000–${config.maxLifetimeMs} ms), max_wakes (1–100); one-shot default requires 1 wake, recurring:true is explicit. Use interval_ms plus source for polling, delay_ms alone for settlement-based continuation, or typed events (provider/event/args). Combine polling/events. Polling clock example (when configured ceilings permit): interval_ms:30000, cycle_timeout_ms:600000, lifetime_ms:900000, max_wakes:1 (plus required name/message/providers/source) checks initially then 30s after each evaluation settles, for up to a 10m observation cycle, NOT a 10m API call. A longer lifetime does not prevent one-shot cycle expiry. Fresh Script evaluator receives trigger and state; return {decision:'wait'|'wake', evidence:JSON, state?:JSON}. State/evidence commit only on full success. No retries or evaluator stop. Pending wakes are held until settlement; handoff is not consumption. list exposes permitted event schemas, get bounded receipts, never source. Cancel cannot retract Pi-owned messages. 4 jobs, 2 evaluations, 32 queued events/receipts; overflow/failure requests attention. Shutdown/navigation invalidate, restore receipts only.`,
    promptSnippet:
      "Observe typed events or poll in fresh Script evaluations; continue only within explicit finite bounds",
    promptGuidelines: [
      "Use monitor only with explicit monitoring/continuation authority. Provider permission is not user approval; obtain authority covering repeated mutations. Discover Script and Monitor event schemas before use. Keep one owner per job; reconcile historical observers before replacement. No automatic retries, grants, approval polling or replay. Timeout and settlement do not prove condition or task success; cancel recurring jobs when no further authorized work is useful. Cancel and reconcile continuation for input-blocked work before requesting input. Explicitly authorized read-only shared observation of independent workers may continue under a nonblocking correlated-message contract, never modal-wait bypass or approval polling; immutable replacements preserve caller-owned cumulative time and wake allowances, including uncertain handoffs.",
    ],
    async execute(_id, params, signal) {
      const token = generation;
      const owner = engine,
        ctx = context;
      try {
        if (!owner || !ctx || token !== generation || signal?.aborted)
          throw new RequestError("Monitor unavailable or cancelled.");
        let value: unknown;
        let selected: Receipt | undefined;
        let cancelChanged = false;
        if (params.action === "start") {
          const reg = registration(params, config);
          await describeScriptProviders(
            pi,
            ctx.cwd,
            reg.providers,
            reg.providers,
            signal,
          );
          if (token !== generation || signal?.aborted)
            throw new RequestError(
              "Context changed or registration cancelled.",
            );
          selected = await owner.start(reg, signal);
          value = selected;
        } else {
          const allowed =
            params.action === "list"
              ? ["action", "providers"]
              : ["action", "id"];
          if (Object.keys(params).some((k) => !allowed.includes(k)))
            throw new RequestError("Unexpected fields for action.");
          if (params.action === "list")
            value = {
              receipts: owner.list().map(summary),
              eventProviders: await describeEvents(
                pi,
                ctx.cwd,
                params.providers ?? [],
                signal,
              ),
            };
          else if (params.action === "get" || params.action === "cancel") {
            if (!isId(params.id))
              throw new RequestError("A job UUID is required.");
            const before = owner.get(params.id);
            selected =
              params.action === "cancel" ? owner.cancel(params.id) : before;
            if (!selected) throw new RequestError("Unknown Monitor job.");
            cancelChanged =
              params.action === "cancel" &&
              !!before &&
              (before.status === "active" ||
                before.attention?.disposition === "pending");
            value = selected;
          } else throw new RequestError("Unknown action.");
        }
        if (token !== generation)
          throw new RequestError(
            "Session changed; inspect destination receipts.",
          );
        const warning =
          params.action === "start" && selected
            ? pollingWarning(summary(selected))
            : undefined;
        return {
          content: [
            {
              type: "text",
              text:
                (configWarnings.length
                  ? `${configWarnings.join("\n")}\n`
                  : "") +
                (warning ? `${warning}\n` : "") +
                wrapUntrustedContent(
                  "MONITOR RESULT",
                  snapshotScriptJson(
                    JSON.parse(JSON.stringify(value)),
                    48000 - Buffer.byteLength(warning ?? ""),
                  ),
                ),
            },
          ],
          details: {
            monitorError: false,
            action: params.action,
            receipt: selected && summary(selected),
            cancelChanged,
            receipts: params.action === "list" ? owner.list().map(summary) : [],
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text:
                error instanceof RequestError
                  ? error.message
                  : "Monitor operation failed: invalid policy, unavailable provider, subscription or bounded output. No automatic retry; inspect receipts before a new registration.",
            },
          ],
          details: {
            monitorError: true,
            action: params.action,
            status: "failed",
            receipts: [],
          },
        };
      }
    },
  });
}
