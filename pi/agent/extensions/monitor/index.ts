import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { executeCode, getCodeLimits } from "../code-mode/api.ts";
import { loadMonitorConfig } from "./config.ts";
import { MonitorEngine, active, label } from "./engine.ts";
import {
  RECEIPT_TYPE,
  readReceiptBranch,
  restoreReceipts,
} from "./receipts.ts";
import {
  PARAMETERS,
  renderers,
  summary,
  notificationContent,
  widgetLines,
  type ToolDetails,
} from "./tool.ts";

export default function (pi: ExtensionAPI) {
  let generation = 0;
  let engine: MonitorEngine | undefined;
  let ready: Promise<void> = Promise.resolve();
  let ticker: ReturnType<typeof setInterval> | undefined;
  let context: ExtensionContext | undefined;
  function clearWidget() {
    if (ticker) clearInterval(ticker);
    ticker = undefined;
    if (context?.hasUI)
      context.ui.setWidget("monitor", undefined, { placement: "belowEditor" });
  }
  function refresh() {
    const ctx = context;
    const owner = engine;
    if (!ctx?.hasUI || !owner) return;
    const receipts = owner.list();
    if (ctx.mode === "tui")
      ctx.ui.setWidget(
        "monitor",
        (_tui, theme) => ({
          render: (width) =>
            widgetLines(
              owner.list(),
              owner.config.terminalRows,
              Date.now(),
              width,
              theme,
            ),
          invalidate() {},
        }),
        { placement: "belowEditor" },
      );
    else
      ctx.ui.setWidget(
        "monitor",
        widgetLines(
          receipts,
          owner.config.terminalRows,
          Date.now(),
          100,
          ctx.ui.theme,
        ),
        { placement: "belowEditor" },
      );
    if (receipts.some(active) && !ticker) ticker = setInterval(refresh, 1000);
    if (!receipts.some(active) && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
  }
  function invalidate(persist: boolean) {
    generation++;
    engine?.close(persist);
    clearWidget();
  }
  function initialize(ctx: ExtensionContext) {
    invalidate(false);
    const token = generation;
    context = ctx;
    engine = undefined;
    ready = (async () => {
      const config = await loadMonitorConfig(ctx.cwd);
      if (token !== generation) return;
      const owner = new MonitorEngine(config, {
        execute: (source, limits, signal, deadline) =>
          executeCode(pi, ctx.cwd, source, limits, signal, deadline),
        persist: (receipt) => {
          if (token !== generation) throw new Error("stale_context");
          pi.appendEntry(RECEIPT_TYPE, receipt);
        },
        handoff: (receipt) => {
          if (token !== generation) throw new Error("stale_context");
          pi.sendMessage(
            {
              customType: "monitor",
              content: notificationContent(receipt),
              display: true,
              details: summary(receipt),
            },
            { deliverAs: "followUp", triggerTurn: true },
          );
        },
        changed: () => {
          if (token === generation) refresh();
        },
      });
      engine = owner;
      owner.restore(
        restoreReceipts(
          readReceiptBranch(ctx.sessionManager),
          config.receiptLimit,
        ),
      );
      refresh();
    })();
    return ready;
  }
  pi.on("session_start", (_event, ctx) => initialize(ctx));
  // Do not append history here: Pi already prepared the source leaf and summary.
  pi.on("session_before_tree", () => {
    invalidate(false);
  });
  pi.on("session_tree", (_event, ctx) => initialize(ctx));
  pi.on("session_shutdown", async () => {
    // Persist invalidation in the old branch before invalidating its callbacks.
    engine?.close();
    invalidate(false);
    await engine?.settled();
    context = undefined;
  });
  registerConfigCommand(pi, {
    extensionName: "monitor",
    loadConfig: loadMonitorConfig,
  });
  pi.on("tool_result", (event) => {
    if (
      event.toolName === "monitor" &&
      (event.details as ToolDetails | undefined)?.monitorError
    )
      return { isError: true };
    return undefined;
  });
  async function control(
    params: Record<string, unknown>,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ) {
    const token = generation;
    await ready;
    const owner = engine;
    const action = label(params.action, 16);
    const error = (messages: string[]) => ({
      content: [{ type: "text" as const, text: messages.join("\n") }],
      details: {
        action,
        status: "invalid request",
        monitorError: true,
      } as ToolDetails,
    });
    if (!owner || token !== generation || signal?.aborted)
      return error([
        "Monitor session context is inactive or registration was cancelled.",
      ]);
    const errors: string[] = [];
    const allowed =
      action === "start"
        ? [
            "action",
            "name",
            "description",
            "source",
            "message",
            "interval_ms",
            "timeout_ms",
            "poll_timeout_ms",
            "failure_limit",
          ]
        : action === "list"
          ? ["action"]
          : ["action", "id"];
    if (!["start", "list", "get", "cancel"].includes(action))
      errors.push("action must be start, list, get, or cancel.");
    if (Object.keys(params).some((k) => !allowed.includes(k)))
      errors.push("Unexpected fields for this action.");
    if (
      ["get", "cancel"].includes(action) &&
      (typeof params.id !== "string" ||
        !params.id.trim() ||
        params.id.length > 80)
    )
      errors.push("A monitor ID is required (cancel also accepts all).");
    if (errors.length) return error(errors);
    let value: unknown;
    let receipts = owner.list();
    if (action === "start") {
      let limits;
      try {
        limits = await getCodeLimits(pi, ctx.cwd);
      } catch {
        return error([
          "Code executor or active gateway unavailable; no monitor registered.",
        ]);
      }
      if (token !== generation || signal?.aborted)
        return error([
          "Session changed or registration cancelled; no monitor registered.",
        ]);
      const result = owner.start(params, limits);
      if (result.errors.length) return error(result.errors);
      value = result.receipt;
      receipts = [result.receipt!];
    } else if (action === "get") {
      const r = owner.get(params.id as string);
      if (!r) return error(["Unknown monitor ID."]);
      value = r;
      receipts = [r];
    } else if (action === "cancel") {
      const result = owner.cancel(params.id as string);
      if (!result) return error(["Unknown monitor ID."]);
      receipts = result;
      value = {
        receipts: result.map(summary),
        boundary:
          "Notifications already handed/queued to Pi cannot be selectively retracted; consumption is not acknowledged. Cancellation is not rollback.",
      };
    } else value = receipts.map(summary);
    return {
      content: [
        {
          type: "text" as const,
          text: wrapUntrustedContent("monitor receipt", JSON.stringify(value)),
        },
      ],
      details: {
        action,
        status:
          action === "start" ? "registered" : `${receipts.length} receipts`,
        receipts: receipts.map(summary),
      } as ToolDetails,
    };
  }
  pi.registerTool({
    name: "monitor",
    label: "Monitor",
    parameters: PARAMETERS,
    description:
      'Manage session-branch-bound observations: start, list, get, cancel. Explicit registration required. Start needs name, description, source, message. Each fresh code-mode child returns exactly {decision:"wait"|"notify",evidence:JSON}; wait uses zero model turns/messages. Defaults: interval 30s, lifetime 30m, poll timeout 30s, cumulative safe-failure limit 3. 4 active monitors, 2 concurrent polls; 8 calls and concurrency 2 per poll, tightened by code-mode settings. Any permitted gateway tool is allowed; obtain authority covering repeated mutations before registration. Discover schemas first. No automatic grants or uncertain replay. One terminal follow-up; cancel cannot retract a Pi-queued message. Evidence max 4096 characters; source max 256 KiB. Receipts omit source and are bounded.',
    promptSnippet: "Observe gateway conditions without polling model turns",
    promptGuidelines: [
      "Use monitor only for explicitly requested session-bound monitoring; Loop remains model continuation and code remains one short-lived execution.",
      "Monitor gateway permissions are not user approval. Obtain applicable authority covering repeated mutations before monitor start. Never automatically request grants or replay uncertain observations.",
    ],
    ...renderers,
    execute: (_id, params, signal, _update, ctx) =>
      control(params, ctx, signal),
  });
  for (const command of ["monitor", "monitor-cancel"] as const)
    pi.registerCommand(command, {
      description:
        command === "monitor"
          ? "List monitors or inspect a monitor ID without a model turn."
          : "Cancel a monitor ID or all; Pi-queued messages cannot be retracted.",
      handler: async (args, ctx) => {
        const id = args.trim();
        const result = await control(
          command === "monitor-cancel"
            ? { action: "cancel", id }
            : id
              ? { action: "get", id }
              : { action: "list" },
          ctx,
        );
        const text = result.content[0].text;
        if (ctx.hasUI)
          ctx.ui.notify(text, result.details.monitorError ? "error" : "info");
        else process.stderr.write(`${text}\n`);
      },
    });
}
