import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createPersistentWidget } from "../_shared/widget.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { subscribeBus, uuid } from "./events.ts";
import { WatchEngine, RequestError, label } from "./engine.ts";
import { Bridge, discover, transportRoot } from "./transport.ts";
import { RECEIPT_TYPE, restore } from "./receipts.ts";
import {
  PARAMETERS,
  notificationContent,
  renderers,
  widgetLines,
} from "./tool.ts";

export default function sessionWatch(
  pi: ExtensionAPI,
  rootPath = transportRoot,
) {
  let generation = 0;
  let context: ExtensionContext | undefined;
  let bridge: Bridge | undefined;
  let engine: WatchEngine | undefined;
  let ready: Promise<void> = Promise.resolve();
  let unsubscribe: (() => void) | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const widget = createPersistentWidget("session-watch");
  function refresh() {
    const ctx = context,
      owner = engine;
    if (!ctx || !owner || !owner.list().some((r) => r.state === "active")) {
      clearInterval(ticker);
      ticker = undefined;
      if (ctx) widget.update(ctx);
      return;
    }
    widget.update(ctx, (width, theme) =>
      widgetLines(owner.list(), Date.now(), width, theme),
    );
    if (ctx.hasUI && !ticker) {
      ticker = setInterval(refresh, 1000);
      ticker.unref();
    }
  }
  function close(persist: boolean) {
    engine?.close(persist);
    generation++;
    unsubscribe?.();
    unsubscribe = undefined;
    bridge?.close();
    bridge = undefined;
    clearInterval(ticker);
    ticker = undefined;
    if (context) widget.update(context);
  }
  function initialize(ctx: ExtensionContext) {
    close(false);
    context = ctx;
    engine = undefined;
    const token = generation;
    ready = (async () => {
      let next: Bridge | undefined;
      try {
        const root = rootPath();
        next = new Bridge(root, ctx.sessionManager.getSessionId());
        await next.start();
        if (token !== generation) {
          next.close();
          return;
        }
        bridge = next;
        const owner = new WatchEngine(root, next.target.incarnation, {
          persist: (receipt) => {
            if (token !== generation) throw new Error("stale context");
            pi.appendEntry(RECEIPT_TYPE, receipt);
          },
          handoff: (receipt, message) => {
            if (token !== generation) throw new Error("stale context");
            pi.sendMessage(
              {
                customType: "session-watch",
                content: notificationContent(receipt, message),
                display: true,
                details: receipt,
              },
              { deliverAs: "followUp", triggerTurn: true },
            );
          },
          changed: () => {
            if (token === generation) refresh();
          },
          event: (event) =>
            pi.events.emit(`session-watch:${event.type}`, event),
        });
        engine = owner;
        owner.restore(restore(ctx.sessionManager));
        unsubscribe = subscribeBus(pi, (name, metadata) =>
          bridge?.publish(name, metadata),
        );
      } catch {
        next?.close();
        if (token === generation && ctx.hasUI)
          ctx.ui.notify(
            "Session watching disabled: local transport unavailable or unsafe.",
            "warning",
          );
      }
    })();
    return ready;
  }
  pi.on("session_start", (_event, ctx) => initialize(ctx));
  // Conservative even when a later handler cancels navigation; never append here.
  pi.on("session_before_tree", () => close(false));
  pi.on("session_tree", (_event, ctx) => initialize(ctx));
  pi.on("agent_start", () => bridge?.publish("agent_start", {}));
  pi.on("agent_settled", () => bridge?.publish("agent_settled", {}));
  pi.on("session_shutdown", async () => {
    engine?.close(true);
    bridge?.publish("session_shutdown", {});
    // Let the best-effort final socket write reach the kernel before cleanup.
    await new Promise<void>((resolve) => setImmediate(resolve));
    close(true);
    context = undefined;
  });
  pi.on("tool_result", (event) => {
    if (
      event.toolName === "session_watch" &&
      (event.details as { watchError?: boolean } | undefined)?.watchError
    )
      return { isError: true };
    return undefined;
  });
  pi.registerTool({
    name: "session_watch",
    label: "Session Watch",
    parameters: PARAMETERS,
    description:
      "One-shot background observation of another participating local Pi session. start/list/get/cancel. list discovers exact incarnation UUIDs and retained receipts; start requires target, selected events, finite timeout_ms (1s–24h), and message (1–2000 chars); optional name is a nonsecret widget label. Four occupied watches; 32 recent receipts. Registration begins at target ACK boundary, not at tool invocation; pre-existing events are excluded. Pending observations use zero model turns/messages. Match, deadline, or disconnect failure gives at most one follow-up (never steering); admission is not consumption. No reconnect/replay. Cancel only this watch; Pi-queued messages cannot be retracted. Navigation/reload/shutdown invalidate watches. Same OS user/machine, trusted participating extensions, Unix sockets only.",
    promptSnippet:
      "Watch selected events from another participating Pi session without polling model turns",
    promptGuidelines: [
      "Use session_watch only for explicitly requested session watching; inspect list for exact target incarnation. Session settlement and monitor termination are not task completion or green CI. User-attention events do not authorize answering. Reconcile retained receipts before a new watch; never replay uncertain notifications.",
    ],
    ...renderers,
    async execute(_id, params, signal) {
      const token = generation;
      await ready;
      const owner = engine,
        current = bridge;
      const action = label(params.action, 16);
      try {
        if (token !== generation || !owner || !current || signal?.aborted)
          throw new RequestError("Session watch unavailable or cancelled.");
        const allowed =
          action === "start"
            ? ["action", "target", "name", "events", "timeout_ms", "message"]
            : action === "list"
              ? ["action"]
              : ["action", "id"];
        const errors: string[] = [];
        if (Object.keys(params).some((key) => !allowed.includes(key)))
          errors.push("Unexpected fields for action.");
        if (!["start", "list", "get", "cancel"].includes(action))
          errors.push("Unknown action.");
        if (["get", "cancel"].includes(action) && !uuid(params.id))
          errors.push("A watch UUID is required.");
        if (errors.length) throw new RequestError(errors.join("\n"));
        let value: unknown;
        if (action === "start") value = await owner.start(params, signal);
        else if (action === "list") {
          const targets = await discover(current.root);
          if (token !== generation)
            throw new RequestError("Session changed during discovery.");
          value = {
            self: current.target,
            targets: targets.filter(
              (t) => t.incarnation !== current.target.incarnation,
            ),
            receipts: owner
              .list()
              .map(({ id, target, name, state, notification, deadline }) => ({
                id,
                target,
                name,
                state,
                notification,
                deadline,
              })),
          };
        } else {
          const receipt =
            action === "get" ? owner.get(params.id!) : owner.cancel(params.id!);
          if (!receipt) throw new RequestError("Unknown watch ID.");
          value = {
            receipt,
            boundary:
              "Already Pi-queued follow-ups cannot be selectively retracted; admission is not consumption.",
          };
        }
        return {
          content: [
            {
              type: "text",
              text: wrapUntrustedContent(
                "session-watch result",
                JSON.stringify(value),
              ),
            },
          ],
          details: {
            status: action === "start" ? "registered" : "inspected",
            receipts: owner.list(),
            watchError: false,
          },
        };
      } catch (error) {
        // Only explicitly branded validation text can reach the model.
        const text =
          error instanceof RequestError
            ? label(error.message, 1000)
            : "Local transport unavailable or unsafe; no watch registered.";
        return {
          content: [{ type: "text", text }],
          details: {
            status: "invalid request or unavailable",
            receipts: [],
            watchError: true,
          },
        };
      }
    },
  });
}
