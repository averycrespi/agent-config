import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { DEFAULT_CONFIG, loadConfig, type IdleConfig } from "./config.ts";
import { clock, IdleController, type Clock } from "./controller.ts";
import { STATE_TYPE } from "./state.ts";

export function createIdleCompactionExtension(
  options: {
    clock?: Clock;
    loadConfig?: (warnings: string[]) => Promise<IdleConfig>;
  } = {},
) {
  return (pi: ExtensionAPI) => {
    const controller = new IdleController(
      (data) => pi.appendEntry(STATE_TYPE, data),
      options.clock ?? clock,
    );
    let config = { ...DEFAULT_CONFIG };
    let warnings: string[] = [];
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    let promptOpen = false;

    pi.on("session_start", async (_event, ctx) => {
      const current = ++generation;
      controller.stop();
      unsubscribe?.();
      unsubscribe = undefined;
      const loadedWarnings: string[] = [];
      const loaded = await (options.loadConfig ?? loadConfig)(loadedWarnings);
      if (current !== generation) return;
      config = loaded;
      warnings = loadedWarnings;
      controller.start(ctx, config);
      controller.prompt(promptOpen);
      if (ctx.mode === "tui") {
        unsubscribe = ctx.ui.onTerminalInput(() => {
          controller.activity();
          return undefined;
        });
        for (const warning of warnings) ctx.ui.notify(warning, "warning");
      }
    });
    pi.on("session_shutdown", () => {
      generation++;
      unsubscribe?.();
      unsubscribe = undefined;
      promptOpen = false;
      controller.stop();
    });
    pi.on("ui_prompt_start", () => {
      promptOpen = true;
      controller.prompt(true);
    });
    pi.on("ui_prompt_end", () => {
      promptOpen = false;
      controller.prompt(false);
    });
    pi.on("input", () => {
      controller.activity();
    });
    pi.on("agent_start", () => {
      controller.activity();
    });
    pi.on("agent_settled", () => {
      controller.activity();
    });
    pi.on("message_start", () => {
      controller.activity();
    });
    pi.on("message_end", () => {
      controller.activity();
    });
    pi.on("user_bash", () => {
      controller.activity();
    });
    pi.on("model_select", () => {
      controller.activity();
    });
    pi.on("session_before_switch", () => {
      controller.navigate();
    });
    pi.on("session_before_fork", () => {
      controller.navigate();
    });
    pi.on("session_before_tree", () => {
      controller.navigate();
    });
    pi.on("session_tree", () => {
      controller.navigate();
    });
    pi.on("session_before_compact", () => controller.beforeCompact());
    pi.on("session_compact", () => {
      controller.activity();
    });
    pi.on("session_compact_failed", () => {
      controller.activity();
    });

    pi.registerCommand("idle-compaction", {
      description:
        "Set a session idle-compaction override or inspect status: on|off|status",
      handler: async (args, ctx) => {
        const action = args.trim() || "status";
        if (!["on", "off", "status"].includes(action)) {
          ctx.ui.notify("Usage: /idle-compaction on|off|status", "warning");
          return;
        }
        if (action !== "status") controller.setOverride(action === "on");
        controller.activity();
        ctx.ui.notify(controller.status(), "info");
      },
    });
    registerConfigCommand(pi, {
      extensionName: "idle-compaction",
      loadConfig: (_cwd, outputWarnings = []) => {
        controller.activity();
        outputWarnings.push(...warnings);
        return { ...config };
      },
    });
  };
}

export default createIdleCompactionExtension();
