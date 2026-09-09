import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  firstLine,
  getResultText,
  getTruncatedText,
} from "../_shared/render.ts";
import type { LoopConfig } from "./config.ts";
import {
  formatLoopState,
  getLoopActiveElapsedMs,
  normalizeBoundedText,
  sanitizeDisplayText,
  type LoopLimitPatch,
  type LoopState,
  type LoopStopReason,
  type LoopStore,
  type PersistedLoopState,
} from "./state.ts";

export const STATE_ENTRY_TYPE = "loop-state";

const LOOP_ACTIONS = [
  "get",
  "start",
  "yield",
  "stop",
  "resume",
  "extend",
  "clear",
] as const;
type LoopAction = (typeof LOOP_ACTIONS)[number];
type MutationType =
  | "started"
  | "yielded"
  | "stopped"
  | "resumed"
  | "extended"
  | "cleared";

type LoopParams = {
  action?: unknown;
  message?: unknown;
  reason?: unknown;
  max_continuations?: unknown;
  max_active_minutes?: unknown;
  delay_seconds?: unknown;
};

function schema() {
  return Type.Object({
    action: Type.String({
      enum: [...LOOP_ACTIONS],
      description: "Loop lifecycle action to perform.",
    }),
    message: Type.Optional(
      Type.String({
        description:
          "Required only for start. Broadcast on every continuation.",
      }),
    ),
    reason: Type.Optional(
      Type.String({
        description: "Required only for yield; optional for stop.",
      }),
    ),
    max_continuations: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Absolute continuation limit for start or extend.",
      }),
    ),
    max_active_minutes: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Absolute running-time limit for start or extend.",
      }),
    ),
    delay_seconds: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Delay before each automatic continuation. Accepted only for start.",
      }),
    ),
  });
}

function appendState(pi: ExtensionAPI, store: LoopStore): void {
  const appendEntry = (pi as any).appendEntry;
  if (typeof appendEntry === "function") {
    appendEntry.call(pi, STATE_ENTRY_TYPE, store.getState());
  }
}

function result(text: string, store: LoopStore) {
  return {
    content: [{ type: "text" as const, text }],
    details: store.getState(),
  };
}

function errorResult(errors: string[], store: LoopStore) {
  return result(`Error: ${errors.join(" ")}`, store);
}

function formatContinuationLimit(count: number): string {
  return `${count} continuation${count === 1 ? "" : "s"}`;
}

function boundedDisplay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = sanitizeDisplayText(value);
  return safe ? safe.slice(0, 160) : undefined;
}

function summarizeCall(
  params: LoopParams,
  config: {
    defaultMaxContinuations: number;
    defaultMaxActiveMinutes: number;
    defaultDelaySeconds: number;
  },
): string {
  const action = LOOP_ACTIONS.includes(params.action as LoopAction)
    ? (params.action as LoopAction)
    : "get";
  if (action === "start") {
    const continuations = Number.isInteger(params.max_continuations)
      ? (params.max_continuations as number)
      : config.defaultMaxContinuations;
    const minutes = Number.isInteger(params.max_active_minutes)
      ? (params.max_active_minutes as number)
      : config.defaultMaxActiveMinutes;
    const delaySeconds = Number.isInteger(params.delay_seconds)
      ? (params.delay_seconds as number)
      : config.defaultDelaySeconds;
    return `start · ${formatContinuationLimit(continuations)} · ${minutes}m${delaySeconds > 0 ? ` · ${delaySeconds}s delay` : ""}`;
  }
  if (action === "yield" || action === "stop") {
    const reason = boundedDisplay(params.reason);
    return reason ? `${action} · ${reason}` : action;
  }
  if (action === "extend") {
    const details = [
      Number.isInteger(params.max_continuations)
        ? formatContinuationLimit(params.max_continuations as number)
        : undefined,
      Number.isInteger(params.max_active_minutes)
        ? `${params.max_active_minutes as number}m`
        : undefined,
    ].filter((value): value is string => value !== undefined);
    return details.length > 0 ? `extend · ${details.join(" · ")}` : "extend";
  }
  return action;
}

function partialLabel(action: unknown): string {
  switch (action) {
    case "start":
      return "Starting loop...";
    case "yield":
      return "Yielding loop...";
    case "stop":
      return "Stopping loop...";
    case "resume":
      return "Resuming loop...";
    case "extend":
      return "Extending loop...";
    case "clear":
      return "Clearing loop...";
    default:
      return "Inspecting loop...";
  }
}

function stopReasonLabel(reason: LoopStopReason | undefined): string {
  switch (reason) {
    case "agent_stop":
      return "stopped by agent";
    case "user_stop":
      return "stopped by user";
    case "extension_stop":
      return "stopped by extension";
    case "continuation_limit":
      return "continuation limit reached";
    case "time_limit":
      return "time limit reached";
    case "provider_error":
      return "provider error";
    case "aborted":
      return "aborted";
    case "session_restored":
      return "session restored";
    default:
      return "stopped";
  }
}

function summarizeLoopResult(loop: LoopState): string {
  if (loop.status === "yielded") return "✓ yielded · waiting for user input";
  if (loop.status === "stopped") {
    return `✓ stopped · ${stopReasonLabel(loop.stopReason)}`;
  }
  const activeMinutes = Math.max(
    0,
    Math.floor(getLoopActiveElapsedMs(loop) / 60_000),
  );
  return `✓ running · ${loop.continuationCount}/${loop.limits.maxContinuations} continuations · ${activeMinutes}m/${loop.limits.maxActiveMinutes}m active`;
}

function transitionLabel(action: unknown): string | undefined {
  switch (action) {
    case "start":
      return "absent → running";
    case "yield":
      return "running → yielded";
    case "stop":
      return "active → stopped";
    case "resume":
      return "yielded/stopped → running";
    case "extend":
      return "limits updated";
    case "clear":
      return "existing → absent";
    default:
      return undefined;
  }
}

function integerField(
  value: unknown,
  field: string,
  ceiling: number,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    errors.push(`${field} must be a positive integer.`);
    return undefined;
  }
  if ((value as number) > ceiling) {
    errors.push(`${field} exceeds the configured ceiling of ${ceiling}.`);
    return undefined;
  }
  return value as number;
}

function nonNegativeIntegerField(
  value: unknown,
  field: string,
  ceiling: number,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    errors.push(`${field} must be a non-negative integer.`);
    return undefined;
  }
  if ((value as number) > ceiling) {
    errors.push(`${field} exceeds the configured ceiling of ${ceiling}.`);
    return undefined;
  }
  return value as number;
}

export function registerLoopTool(
  pi: ExtensionAPI,
  store: LoopStore,
  getConfig: () => Pick<
    LoopConfig,
    | "defaultMaxContinuations"
    | "defaultMaxActiveMinutes"
    | "hardMaxContinuations"
    | "hardMaxActiveMinutes"
    | "defaultDelaySeconds"
    | "hardMaxDelaySeconds"
    | "messageMaxChars"
    | "reasonMaxChars"
  >,
  options: { onMutation?: (type: MutationType) => void } = {},
): void {
  function mutated(type: MutationType): void {
    if (options.onMutation) options.onMutation(type);
    else appendState(pi, store);
  }

  pi.registerTool({
    name: "loop",
    label: "Loop",
    description:
      "Control one bounded loop for the active session branch, scheduling further owning-agent turns with a caller-specified message after Pi settles.",
    promptSnippet:
      "Start, inspect, yield, stop, resume, extend, or clear the shared session continuation loop.",
    promptGuidelines: [
      "Use loop only when the user, a loaded skill, or an established workflow explicitly requests a loop. Ordinary multi-step work does not require it.",
      "For explicitly requested waiting on a gateway condition expressible as a deterministic check, prefer monitor when available. Use polling loops only when continued model reasoning or tools unavailable to monitor are needed, within the existing loop authorization rule.",
      "Use loop action=yield when progress requires user input; the next real user message wakes the loop.",
      "Use loop action=stop when another automatic continuation would not be useful.",
      "For polling loops, set delay_seconds and perform at most one polling batch per continuation.",
      "Do not extend a loop merely to avoid reporting a blocker or final result.",
    ],
    parameters: schema(),
    renderCall(args, theme, context) {
      const summary = summarizeCall(args as LoopParams, getConfig());
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("loop"))} ${theme.fg("muted", summary)}`,
      ]);
    },
    renderResult(result, { isPartial, expanded }, theme, context) {
      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("warning", partialLabel(context.args.action)),
        ]);
      }

      const message = firstLine(getResultText(result));
      if (context.isError || message.startsWith("Error:")) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", boundedDisplay(message) || "loop error"),
        ]);
      }

      const state = result.details as PersistedLoopState | undefined;
      const loop = state?.loop;
      const action = context.args.action;
      const summary = loop
        ? summarizeLoopResult(loop)
        : action === "clear"
          ? "✓ cleared"
          : "✓ no loop";
      const lines = [theme.fg("success", summary)];
      const transition = expanded ? transitionLabel(action) : undefined;
      if (transition) lines.push(theme.fg("dim", transition));
      return getTruncatedText(context.lastComponent, lines);
    },
    async execute(_toolCallId, rawParams) {
      const params =
        rawParams && typeof rawParams === "object"
          ? (rawParams as LoopParams)
          : {};
      const config = getConfig();
      const errors: string[] = [];
      const action = LOOP_ACTIONS.includes(params.action as LoopAction)
        ? (params.action as LoopAction)
        : undefined;
      if (!action) {
        return errorResult(
          [`action must be one of: ${LOOP_ACTIONS.join(", ")}.`],
          store,
        );
      }

      let message: string | undefined;
      let reason: string | undefined;
      let maxContinuations: number | undefined;
      let maxActiveMinutes: number | undefined;
      let delaySeconds: number | undefined;

      const acceptsLimits = action === "start" || action === "extend";
      const acceptsReason = action === "yield" || action === "stop";
      if (action === "start") {
        try {
          message = normalizeBoundedText(
            params.message,
            config.messageMaxChars,
            "message",
          );
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } else if (params.message !== undefined) {
        errors.push(`message is not accepted for ${action}.`);
      }

      if (acceptsReason) {
        if (action === "yield" || params.reason !== undefined) {
          try {
            reason = normalizeBoundedText(
              params.reason,
              config.reasonMaxChars,
              "reason",
            );
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      } else if (params.reason !== undefined) {
        errors.push(`reason is not accepted for ${action}.`);
      }

      if (acceptsLimits) {
        maxContinuations = integerField(
          params.max_continuations,
          "max_continuations",
          config.hardMaxContinuations,
          errors,
        );
        maxActiveMinutes = integerField(
          params.max_active_minutes,
          "max_active_minutes",
          config.hardMaxActiveMinutes,
          errors,
        );
        if (
          action === "extend" &&
          params.max_continuations === undefined &&
          params.max_active_minutes === undefined
        ) {
          errors.push("extend requires at least one new loop limit.");
        }
      } else {
        if (params.max_continuations !== undefined) {
          errors.push(`max_continuations is not accepted for ${action}.`);
        }
        if (params.max_active_minutes !== undefined) {
          errors.push(`max_active_minutes is not accepted for ${action}.`);
        }
      }

      if (action === "start") {
        delaySeconds = nonNegativeIntegerField(
          params.delay_seconds,
          "delay_seconds",
          config.hardMaxDelaySeconds,
          errors,
        );
      } else if (params.delay_seconds !== undefined) {
        errors.push(`delay_seconds is not accepted for ${action}.`);
      }

      if (errors.length > 0) return errorResult(errors, store);
      if (action === "get")
        return result(formatLoopState(store.getState()), store);

      try {
        if (action === "start") {
          store.start(
            message!,
            {
              maxContinuations:
                maxContinuations ?? config.defaultMaxContinuations,
              maxActiveMinutes:
                maxActiveMinutes ?? config.defaultMaxActiveMinutes,
            },
            {
              maxContinuations: config.hardMaxContinuations,
              maxActiveMinutes: config.hardMaxActiveMinutes,
            },
            config.messageMaxChars,
            delaySeconds ?? config.defaultDelaySeconds,
            config.hardMaxDelaySeconds,
          );
          mutated("started");
        } else if (action === "yield") {
          if (!store.getLoop()) return errorResult(["no loop exists."], store);
          if (store.yield(reason!, config.reasonMaxChars)) mutated("yielded");
        } else if (action === "stop") {
          if (!store.getLoop()) return errorResult(["no loop exists."], store);
          if (store.stop("agent_stop", reason, config.reasonMaxChars)) {
            mutated("stopped");
          }
        } else if (action === "resume") {
          if (!store.getLoop()) return errorResult(["no loop exists."], store);
          if (store.resume()) mutated("resumed");
        } else if (action === "extend") {
          if (!store.getLoop()) return errorResult(["no loop exists."], store);
          const patch: LoopLimitPatch = {
            ...(maxContinuations !== undefined ? { maxContinuations } : {}),
            ...(maxActiveMinutes !== undefined ? { maxActiveMinutes } : {}),
          };
          if (
            store.extend(patch, {
              maxContinuations: config.hardMaxContinuations,
              maxActiveMinutes: config.hardMaxActiveMinutes,
            })
          ) {
            mutated("extended");
          }
        } else if (action === "clear") {
          if (!store.getLoop()) return result("No loop exists.", store);
          if (store.clear()) mutated("cleared");
        }
      } catch (error) {
        return errorResult(
          [error instanceof Error ? error.message : String(error)],
          store,
        );
      }

      return result(formatLoopState(store.getState()), store);
    },
  });
}
