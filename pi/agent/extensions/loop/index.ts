import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import type {
  LoopController,
  LoopEvent,
  LoopEventType,
  StartLoopInput,
} from "./api.ts";
import {
  DEFAULT_LOOP_CONFIG,
  loadLoopConfig,
  type LoopConfig,
} from "./config.ts";
import { createLoopWidget } from "./render.ts";
import { bindLoopController } from "./runtime.ts";
import {
  createLoopStore,
  formatLoopState,
  parsePersistedLoopState,
  sanitizeDisplayText,
  type LoopLimitPatch,
  type LoopState,
} from "./state.ts";
import { registerLoopTool, STATE_ENTRY_TYPE } from "./tools.ts";

const WIDGET_KEY = "loop";
const WIDGET_PLACEMENT = "belowEditor";

const CONTINUATION_CONTROL =
  'The loop is still running. Use `loop` with `action: "yield"` if progress requires user input, `action: "stop"` when another automatic continuation would not be useful, or `action: "get"` to inspect its state and remaining limits.';

type LoopExtensionOptions = {
  loadConfig?: (
    cwd: string,
  ) => Promise<{ config: LoopConfig; warnings: string[] }>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

function waitForDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function setLoopWidget(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  content: ReturnType<typeof createLoopWidget> | undefined,
): void {
  const piAny = pi as any;
  if (piAny.hasUI && typeof piAny.setWidget === "function") {
    piAny.setWidget(WIDGET_KEY, content, { placement: WIDGET_PLACEMENT });
    return;
  }
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET_KEY, content as any, {
    placement: WIDGET_PLACEMENT,
  });
}

function appendState(pi: ExtensionAPI, state: unknown): void {
  const appendEntry = (pi as any).appendEntry;
  if (typeof appendEntry === "function") {
    appendEntry.call(pi, STATE_ENTRY_TYPE, state);
  }
}

function restoreFromBranch(
  store: ReturnType<typeof createLoopStore>,
  ctx: ExtensionContext,
  config: LoopConfig,
): void {
  let restored: ReturnType<typeof parsePersistedLoopState>;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "toolResult" && message.toolName === "loop") {
        restored =
          parsePersistedLoopState(message.details, config.reasonMaxChars) ??
          restored;
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
      restored =
        parsePersistedLoopState(entry.data, config.reasonMaxChars) ?? restored;
    }
  }
  if (restored?.loop) {
    restored.loop.limits.maxContinuations = Math.min(
      restored.loop.limits.maxContinuations,
      config.hardMaxContinuations,
    );
    restored.loop.limits.maxActiveMinutes = Math.min(
      restored.loop.limits.maxActiveMinutes,
      config.hardMaxActiveMinutes,
    );
    restored.loop.delaySeconds = Math.min(
      restored.loop.delaySeconds,
      config.hardMaxDelaySeconds,
    );
  }
  store.replaceState(restored ?? { generation: 0 });
}

function buildContinuationMessage(loop: LoopState): string {
  return `[Loop continuation]\n\n${loop.message}\n\n${CONTINUATION_CONTROL}`;
}

function getAssistantFailure(
  messages: unknown,
): { reason: "error" | "aborted"; message: string } | undefined {
  if (!Array.isArray(messages)) return undefined;
  const last = messages.at(-1) as
    | { role?: unknown; stopReason?: unknown; errorMessage?: unknown }
    | undefined;
  if (
    last?.role !== "assistant" ||
    (last.stopReason !== "error" && last.stopReason !== "aborted")
  ) {
    return undefined;
  }
  const fallback = `Assistant stopped with ${last.stopReason}.`;
  return {
    reason: last.stopReason,
    message:
      typeof last.errorMessage === "string" && last.errorMessage.trim()
        ? last.errorMessage.replace(/\s+/g, " ").trim().slice(0, 240)
        : fallback,
  };
}

function boundedFailureDetail(message: string, maxChars: number): string {
  const safe = sanitizeDisplayText(message);
  return (safe || "error").slice(0, maxChars).trimEnd();
}

function parseExtendCommand(args: string): LoopLimitPatch {
  const [continuations, minutes, ...extra] = args.trim().split(/\s+/);
  if (!continuations || !minutes || extra.length > 0) {
    throw new Error(
      "Usage: /loop-extend <max-continuations|-> <max-active-minutes|->",
    );
  }
  const parse = (value: string, label: string): number | undefined => {
    if (value === "-") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive integer or -.`);
    }
    return parsed;
  };
  const patch = {
    maxContinuations: parse(continuations, "max-continuations"),
    maxActiveMinutes: parse(minutes, "max-active-minutes"),
  };
  if (
    patch.maxContinuations === undefined &&
    patch.maxActiveMinutes === undefined
  ) {
    throw new Error("At least one loop limit must change.");
  }
  return patch;
}

export function createLoopExtension(options: LoopExtensionOptions = {}) {
  const loadConfig = options.loadConfig ?? loadLoopConfig;
  const wait = options.wait ?? waitForDelay;

  return function loopExtension(pi: ExtensionAPI) {
    const store = createLoopStore();
    const apiListeners = new Set<(event: LoopEvent) => void>();
    const eventQueue: LoopEvent[] = [];
    let publishingEvents = false;
    let config = DEFAULT_LOOP_CONFIG;
    let currentCtx: ExtensionContext | undefined;
    let unsubscribeWidget: (() => void) | undefined;
    let unbindApi: (() => void) | undefined;
    let runSerial = 0;
    let scheduledSerial = -1;
    let pendingSchedule: AbortController | undefined;
    let pendingFailure:
      | {
          reason: "error" | "aborted";
          message: string;
          loopGeneration?: number;
        }
      | undefined;

    const ceilings = () => ({
      maxContinuations: config.hardMaxContinuations,
      maxActiveMinutes: config.hardMaxActiveMinutes,
    });

    function renderWidget(ctx: ExtensionContext): void {
      const loop = store.getLoop();
      setLoopWidget(
        pi,
        ctx,
        config.showWidget && loop ? createLoopWidget(loop) : undefined,
      );
    }

    function cancelPendingSchedule(): void {
      pendingSchedule?.abort();
      pendingSchedule = undefined;
    }

    function publish(type: LoopEventType): void {
      if (
        [
          "started",
          "yielded",
          "stopped",
          "resumed",
          "cleared",
          "exhausted",
        ].includes(type)
      ) {
        cancelPendingSchedule();
      }
      appendState(pi, store.getState());
      eventQueue.push({ type, loop: store.getLoop() });
      if (publishingEvents) return;
      publishingEvents = true;
      try {
        let event: LoopEvent | undefined;
        while ((event = eventQueue.shift())) {
          for (const listener of apiListeners) listener(event);
          pi.events.emit(`loop:${event.type}`, event);
        }
      } finally {
        publishingEvents = false;
      }
    }

    function requireLoop(): LoopState {
      const loop = store.getLoop();
      if (!loop) throw new Error("No loop exists.");
      return loop;
    }

    async function scheduleContinuation(
      ctx: ExtensionContext,
      lifecycleSerial?: number,
    ): Promise<void> {
      if (lifecycleSerial !== undefined) {
        if (scheduledSerial === lifecycleSerial) return;
        scheduledSerial = lifecycleSerial;
      }
      cancelPendingSchedule();
      const schedule = new AbortController();
      pendingSchedule = schedule;
      try {
        const loop = store.getLoop();
        if (!loop || loop.status !== "running") return;
        if (typeof (ctx as any).hasPendingMessages === "function") {
          if (await (ctx as any).hasPendingMessages()) return;
          if (schedule.signal.aborted) return;
        }
        if (loop.delaySeconds > 0) {
          await wait(loop.delaySeconds * 1_000, schedule.signal);
          if (schedule.signal.aborted) return;
        }
        const currentLoop = store.getLoop();
        if (
          !currentLoop ||
          currentLoop.status !== "running" ||
          currentLoop.generation !== loop.generation
        ) {
          return;
        }
        if (
          typeof (ctx as any).isIdle === "function" &&
          !(ctx as any).isIdle()
        ) {
          return;
        }
        if (typeof (ctx as any).hasPendingMessages === "function") {
          if (await (ctx as any).hasPendingMessages()) return;
          if (schedule.signal.aborted) return;
        }
        const claim = store.claimContinuation(loop.generation);
        if (!claim.claimed) {
          if (claim.stopReason) publish("exhausted");
          return;
        }
        publish("continued");
        const claimedLoop = store.getLoop();
        if (
          schedule.signal.aborted ||
          !claimedLoop ||
          claimedLoop.status !== "running" ||
          claimedLoop.generation !== loop.generation
        ) {
          return;
        }
        const sender = (pi as any).sendMessage;
        if (typeof sender !== "function") return;
        sender.call(
          pi,
          {
            customType: "loop-continuation",
            content: buildContinuationMessage(claimedLoop),
            display: true,
            details: {
              loopId: claimedLoop.id,
              generation: claimedLoop.generation,
              continuation: claimedLoop.continuationCount,
            },
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      } finally {
        if (pendingSchedule === schedule) pendingSchedule = undefined;
      }
    }

    const controller: LoopController = {
      get: () => store.getLoop(),
      start(input: StartLoopInput) {
        const loop = store.start(
          input.message,
          {
            maxContinuations:
              input.maxContinuations ?? config.defaultMaxContinuations,
            maxActiveMinutes:
              input.maxActiveMinutes ?? config.defaultMaxActiveMinutes,
          },
          ceilings(),
          config.messageMaxChars,
          input.delaySeconds ?? config.defaultDelaySeconds,
          config.hardMaxDelaySeconds,
        );
        publish("started");
        if (
          currentCtx &&
          typeof (currentCtx as any).isIdle === "function" &&
          (currentCtx as any).isIdle()
        ) {
          void scheduleContinuation(currentCtx);
        }
        return loop;
      },
      yield(reason: string) {
        requireLoop();
        if (store.yield(reason, config.reasonMaxChars)) publish("yielded");
        return requireLoop();
      },
      stop(reason?: string) {
        requireLoop();
        if (store.stop("extension_stop", reason, config.reasonMaxChars)) {
          publish("stopped");
        }
        return requireLoop();
      },
      resume() {
        requireLoop();
        if (store.resume()) {
          publish("resumed");
          if (
            currentCtx &&
            typeof (currentCtx as any).isIdle === "function" &&
            (currentCtx as any).isIdle()
          ) {
            void scheduleContinuation(currentCtx);
          }
        }
        return requireLoop();
      },
      extend(limits: LoopLimitPatch) {
        requireLoop();
        if (store.extend(limits, ceilings())) publish("extended");
        return requireLoop();
      },
      clear() {
        requireLoop();
        store.clear();
        publish("cleared");
      },
      subscribe(listener) {
        apiListeners.add(listener);
        return () => apiListeners.delete(listener);
      },
    };

    registerLoopTool(pi, store, () => config, {
      onMutation: (type) => publish(type),
    });
    registerConfigCommand(pi, {
      extensionName: "loop",
      loadConfig: async (cwd) => (await loadConfig(cwd)).config,
    });

    async function loadRuntimeConfig(ctx: ExtensionContext): Promise<void> {
      const loaded = await loadConfig(ctx.cwd);
      config = loaded.config;
      for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");
    }

    function notifyState(ctx: ExtensionCommandContext): void {
      ctx.ui.notify(formatLoopState(store.getState()), "info");
    }

    pi.registerCommand("loop", {
      description: "Show the shared session loop.",
      handler: async (_args, ctx) => notifyState(ctx),
    });

    pi.registerCommand("loop-start", {
      description:
        "Start a loop with default limits and the given continuation message.",
      handler: async (args, ctx) => {
        try {
          store.start(
            args,
            {
              maxContinuations: config.defaultMaxContinuations,
              maxActiveMinutes: config.defaultMaxActiveMinutes,
            },
            ceilings(),
            config.messageMaxChars,
            config.defaultDelaySeconds,
            config.hardMaxDelaySeconds,
          );
          publish("started");
          notifyState(ctx);
          await scheduleContinuation(ctx as unknown as ExtensionContext);
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        }
      },
    });

    pi.registerCommand("loop-yield", {
      description: "Yield until the next real user message.",
      handler: async (args, ctx) => {
        try {
          requireLoop();
          if (store.yield(args, config.reasonMaxChars)) publish("yielded");
          notifyState(ctx);
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        }
      },
    });

    pi.registerCommand("loop-stop", {
      description: "Stop automatic continuation until explicit resume.",
      handler: async (args, ctx) => {
        if (!store.getLoop()) {
          ctx.ui.notify("No loop exists.", "info");
          return;
        }
        try {
          const reason = args.trim() || undefined;
          store.stop("user_stop", reason, config.reasonMaxChars);
          publish("stopped");
          notifyState(ctx);
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        }
      },
    });

    pi.registerCommand("loop-resume", {
      description:
        "Explicitly resume a yielded or stopped loop without resetting usage.",
      handler: async (_args, ctx) => {
        try {
          requireLoop();
          const resumed = store.resume();
          if (resumed) {
            publish("resumed");
            notifyState(ctx);
            await scheduleContinuation(ctx as unknown as ExtensionContext);
          } else {
            notifyState(ctx);
          }
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        }
      },
    });

    pi.registerCommand("loop-extend", {
      description: "Loosen absolute loop limits without resuming it.",
      handler: async (args, ctx) => {
        try {
          requireLoop();
          store.extend(parseExtendCommand(args), ceilings());
          publish("extended");
          notifyState(ctx);
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        }
      },
    });

    pi.registerCommand("loop-clear", {
      description: "Clear the shared session loop.",
      handler: async (_args, ctx) => {
        if (!store.clear()) {
          ctx.ui.notify("No loop exists.", "info");
          return;
        }
        publish("cleared");
        ctx.ui.notify("Loop cleared.", "info");
      },
    });

    pi.on("session_start", async (_event, ctx) => {
      unsubscribeWidget?.();
      unbindApi?.();
      currentCtx = ctx;
      runSerial = 0;
      scheduledSerial = -1;
      pendingFailure = undefined;
      cancelPendingSchedule();
      await loadRuntimeConfig(ctx);
      restoreFromBranch(store, ctx, config);
      unsubscribeWidget = store.subscribe(() => renderWidget(ctx));
      unbindApi = bindLoopController(controller);
      renderWidget(ctx);
    });

    pi.on("session_tree", async (_event, ctx) => {
      currentCtx = ctx;
      pendingFailure = undefined;
      cancelPendingSchedule();
      await loadRuntimeConfig(ctx);
      restoreFromBranch(store, ctx, config);
      renderWidget(ctx);
    });

    pi.on("input", async (event: { source?: string }) => {
      if (event.source === "extension") return { action: "continue" };
      const before = store.getLoop();
      if (store.wake()) {
        publish("resumed");
      } else {
        const after = store.getLoop();
        if (
          before?.status === "yielded" &&
          after?.status === "stopped" &&
          (after.stopReason === "continuation_limit" ||
            after.stopReason === "time_limit")
        ) {
          publish("exhausted");
        }
      }
      return { action: "continue" };
    });

    pi.on("agent_end", async (event: { messages?: unknown }, ctx) => {
      runSerial += 1;
      const failure = getAssistantFailure(event.messages);
      pendingFailure = failure
        ? { ...failure, loopGeneration: store.getLoop()?.generation }
        : undefined;
      if (
        pendingFailure?.reason === "aborted" &&
        store.getLoop()?.status === "running"
      ) {
        store.stop(
          "aborted",
          boundedFailureDetail(pendingFailure.message, config.reasonMaxChars),
          config.reasonMaxChars,
        );
        publish("stopped");
      }
      currentCtx = ctx;
      return undefined;
    });

    (pi as any).on(
      "agent_settled",
      async (_event: unknown, ctx: ExtensionContext) => {
        if (pendingFailure) {
          const failure = pendingFailure;
          pendingFailure = undefined;
          const currentLoop = store.getLoop();
          const appliesToCurrentLoop =
            currentLoop !== undefined &&
            currentLoop.generation === failure.loopGeneration;
          if (failure.reason === "error" && appliesToCurrentLoop) {
            if (currentLoop.status === "running") {
              store.stop(
                "provider_error",
                boundedFailureDetail(failure.message, config.reasonMaxChars),
                config.reasonMaxChars,
              );
              publish("stopped");
            }
            return undefined;
          }
          if (failure.reason === "aborted" && appliesToCurrentLoop) {
            return undefined;
          }
        }
        await scheduleContinuation(ctx, runSerial);
        return undefined;
      },
    );

    pi.on("session_shutdown", async (_event, ctx) => {
      unsubscribeWidget?.();
      unsubscribeWidget = undefined;
      unbindApi?.();
      unbindApi = undefined;
      currentCtx = undefined;
      cancelPendingSchedule();
      apiListeners.clear();
      store.replaceState({ generation: 0 });
      setLoopWidget(pi, ctx, undefined);
    });
  };
}

export default createLoopExtension();
