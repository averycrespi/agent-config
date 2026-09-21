import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describeScriptProviders, snapshotScriptJson } from "../script/api.ts";
import { createPersistentWidget } from "../_shared/widget.ts";
import { registerConfigCommand } from "../_shared/config.ts";
import { loadBackgroundConfig, CONFIG_WARNING } from "./config.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { retainDeliveryArtifact } from "../_shared/delivery-artifacts.ts";
import { BackgroundEngine } from "./engine.ts";
import { evaluateBackground } from "./execution.ts";
import { registration, RequestError, isId, type Receipt } from "./contract.ts";
import { subscribeProvider, describeEvents } from "./providers.ts";
import { SessionProvider, sessionRoot } from "./sessions.ts";
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

export default async function background(
  pi: ExtensionAPI,
  rootPath = sessionRoot,
) {
  const config = Object.freeze(await loadBackgroundConfig());
  registerConfigCommand(pi, {
    extensionName: "background",
    sensitiveFields: [],
    loadConfig: (_cwd, warnings = []) => {
      if (!config.valid) warnings.push(CONFIG_WARNING);
      return { ...config };
    },
  });
  let generation = 0;
  let context: ExtensionContext | undefined;
  let engine: BackgroundEngine | undefined;
  let sessions: SessionProvider | undefined;
  let ready: Promise<void> = Promise.resolve();
  let ticker: ReturnType<typeof setInterval> | undefined;
  const widget = createPersistentWidget("background");
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
    sessions?.close();
    sessions = undefined;
    clearInterval(ticker);
    ticker = undefined;
    if (context) widget.update(context);
  };
  const initialize = (ctx: ExtensionContext) => {
    close(false);
    context = ctx;
    if (!config.valid && ctx.hasUI) ctx.ui.notify(CONFIG_WARNING, "warning");
    const token = generation;
    const current = () => {
      if (token !== generation) throw new Error("stale_context");
    };
    engine = new BackgroundEngine({
      idle: () => token === generation && ctx.isIdle(),
      persist: (r) => {
        current();
        pi.appendEntry(RECEIPT_TYPE, r);
      },
      changed: refresh,
      event: (event) => pi.events.emit(`background:${event.type}`, event),
      handoff: (r, message) => {
        current();
        pi.sendMessage(
          {
            customType: "background-wake",
            content: notificationContent(r, message),
            display: true,
            details: { jobId: r.id, wakeId: r.lastAttention!.id },
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      },
      evaluate: (reg, trigger, state, signal, deadlineMs) =>
        evaluateBackground(
          pi,
          ctx.cwd,
          reg,
          trigger,
          state,
          signal,
          deadlineMs,
        ),
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
    ready = (async () => {
      let next: SessionProvider | undefined;
      try {
        next = new SessionProvider(
          pi,
          ctx.sessionManager.getSessionId(),
          rootPath(),
        );
        await next.start();
        if (token !== generation) next.close();
        else sessions = next;
      } catch {
        next?.close();
        if (token === generation && ctx.hasUI)
          ctx.ui.notify(
            "Background session events unavailable; timer jobs remain available. No automatic retry.",
            "warning",
          );
      }
    })();
    return ready;
  };
  pi.on("session_start", (_e, ctx) => initialize(ctx));
  pi.on("session_before_tree", () => close(false));
  pi.on("session_tree", (_e, ctx) => initialize(ctx));
  pi.on("session_shutdown", () => {
    sessions?.publish("session_shutdown");
    close(true);
    context = undefined;
  });
  pi.on("agent_start", () => sessions?.publish("agent_start"));
  pi.on("agent_settled", () => {
    sessions?.publish("agent_settled");
    engine?.settled();
  });
  pi.on("message_start", ({ message }) => {
    if (message.role === "custom" && message.customType === "background-wake") {
      const details = message.details as { wakeId?: unknown } | undefined;
      if (isId(details?.wakeId)) engine?.admitted(details.wakeId);
    }
  });
  pi.on("tool_result", (event) => {
    if (
      event.toolName === "background" &&
      (event.details as { backgroundError?: boolean } | undefined)
        ?.backgroundError
    )
      return { isError: true };
    return undefined;
  });
  pi.registerTool({
    name: "background",
    label: "Background",
    parameters: parameters(config),
    ...renderers,
    description: `Bounded session-branch observation/continuation: start/list/get/cancel. ${config.valid ? "" : "Starts disabled by invalid configuration. "}Start requires name, message, explicit providers, cycle_timeout_ms (1000–${config.maxCycleTimeoutMs} ms), lifetime_ms (1000–${config.maxLifetimeMs} ms), max_wakes (1–100); one-shot default requires 1 wake, recurring:true is explicit. Use interval_ms plus source for polling, delay_ms alone for settlement-based continuation, or typed events (provider/event/args). Combine polling/events. Polling clock example (when configured ceilings permit): interval_ms:30000, cycle_timeout_ms:600000, lifetime_ms:900000, max_wakes:1 (plus required name/message/providers/source) checks initially then 30s after each evaluation settles, for up to a 10m observation cycle, NOT a 10m API call. A longer lifetime does not prevent one-shot cycle expiry. Fresh Script evaluator receives trigger and state; return {decision:'wait'|'wake', evidence:JSON, state?:JSON}. State/evidence commit only on full success. No retries or evaluator stop. Pending wakes are held until settlement; handoff is not consumption. list exposes permitted event schemas, get bounded receipts, never source. Cancel cannot retract Pi-owned messages. 4 jobs, 2 evaluations, 32 queued events/receipts; overflow/failure requests attention. Shutdown/navigation invalidate, restore receipts only.`,
    promptSnippet:
      "Observe typed events or poll in fresh Script evaluations; continue only within explicit finite bounds",
    promptGuidelines: [
      "Use background only with explicit monitoring/continuation authority. Provider permission is not user approval; obtain authority covering repeated mutations. Discover Script and Background event schemas before use. Keep one owner per job; reconcile historical observers before replacement. No automatic retries, grants, approval polling or replay. Timeout and settlement do not prove condition or task success; cancel recurring jobs when no further authorized work is useful. Cancel and reconcile continuation before requesting input; immutable replacements preserve caller-owned cumulative time and wake allowances, including uncertain handoffs.",
    ],
    async execute(_id, params, signal) {
      const token = generation;
      await ready;
      const owner = engine,
        ctx = context;
      try {
        if (!owner || !ctx || token !== generation || signal?.aborted)
          throw new RequestError("Background unavailable or cancelled.");
        let value: unknown;
        let selected: Receipt | undefined;
        let cancelChanged = false;
        let registrationArtifact:
          | ReturnType<typeof retainDeliveryArtifact>
          | undefined;
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
          if (params.retain)
            registrationArtifact = retainDeliveryArtifact(
              ctx.cwd,
              "background",
              {
                schemaVersion: 1,
                toolCallId: _id,
                registration: params,
              },
            );
          selected = await owner.start(reg, signal);
          value = selected;
        } else {
          const allowed =
            params.action === "list"
              ? ["action", "providers"]
              : ["action", "id", "retain"];
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
            if (!selected) throw new RequestError("Unknown Background job.");
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
        let artifact: ReturnType<typeof retainDeliveryArtifact> | undefined;
        let retentionWarning: string | undefined;
        if (params.retain && selected) {
          try {
            artifact = retainDeliveryArtifact(ctx.cwd, "background", {
              schemaVersion: 1,
              toolCallId: _id,
              action: params.action,
              ...(registrationArtifact ? { registrationArtifact } : {}),
              receipt: selected,
            });
          } catch {
            retentionWarning =
              "Host receipt retention failed; reconcile this exact receipt, never replay the operation.";
          }
        }
        const warning = [
          ...(params.action === "start" && selected
            ? [pollingWarning(summary(selected))]
            : []),
          retentionWarning,
          ...(artifact
            ? [
                `Host receipt artifact: ${artifact.path} (sha256 ${artifact.sha256})`,
              ]
            : []),
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                (warning ? `${warning}\n` : "") +
                wrapUntrustedContent(
                  "BACKGROUND RESULT",
                  snapshotScriptJson(
                    JSON.parse(JSON.stringify(value)),
                    48000 - Buffer.byteLength(warning ?? ""),
                  ),
                ),
            },
          ],
          details: {
            backgroundError: false,
            ...(artifact ? { artifact } : {}),
            ...(retentionWarning ? { retentionWarning } : {}),
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
                  : "Background operation failed: invalid policy, unavailable provider, subscription or bounded output. No automatic retry; inspect receipts before a new registration.",
            },
          ],
          details: {
            backgroundError: true,
            action: params.action,
            status: "failed",
            receipts: [],
          },
        };
      }
    },
  });
}
