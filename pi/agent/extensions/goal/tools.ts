import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  formatGoalState,
  normalizeBoundedText,
  type GoalStore,
} from "./state.ts";

export const STATE_ENTRY_TYPE = "goal-state";

const GOAL_ACTIONS = ["get", "complete", "yield"] as const;
type GoalAction = (typeof GOAL_ACTIONS)[number];
type GoalParams = {
  action?: unknown;
  evidence?: unknown;
  reason?: unknown;
};

function createGoalParamsSchema() {
  return Type.Object({
    action: Type.String({
      enum: [...GOAL_ACTIONS],
      description:
        "Action to perform: get state, complete with evidence, or yield autonomous control without completing.",
    }),
    evidence: Type.Optional(
      Type.String({
        description:
          "Required only for complete. Concise concrete evidence covering every explicit goal requirement within the effective configured limit.",
      }),
    ),
    reason: Type.Optional(
      Type.String({
        description:
          "Required only for yield. Concise reason autonomous progress must stop within the effective configured limit.",
      }),
    ),
  });
}

function textResult(text: string, store: GoalStore) {
  return {
    content: [{ type: "text" as const, text }],
    details: store.getState(),
  };
}

function errorResult(messages: string[], store: GoalStore) {
  return textResult(`Error: ${messages.join(" ")}`, store);
}

function appendState(pi: ExtensionAPI, store: GoalStore): void {
  const appendEntry = (pi as any).appendEntry;
  if (typeof appendEntry === "function") {
    appendEntry.call(pi, STATE_ENTRY_TYPE, store.getState());
  }
}

function normalizeField(
  value: unknown,
  maxChars: number,
  label: string,
  errors: string[],
): string | undefined {
  try {
    return normalizeBoundedText(value, maxChars, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function validateParams(
  params: GoalParams,
  maxChars: number,
): {
  action?: GoalAction;
  evidence?: string;
  reason?: string;
  errors: string[];
} {
  const errors: string[] = [];
  const action = GOAL_ACTIONS.includes(params.action as GoalAction)
    ? (params.action as GoalAction)
    : undefined;
  if (!action) {
    errors.push(`action must be one of: ${GOAL_ACTIONS.join(", ")}.`);
    return { errors };
  }

  if (action === "get") {
    if (params.evidence !== undefined)
      errors.push("evidence is not accepted for get.");
    if (params.reason !== undefined)
      errors.push("reason is not accepted for get.");
    return { action, errors };
  }

  if (action === "complete") {
    const evidence = normalizeField(
      params.evidence,
      maxChars,
      "evidence",
      errors,
    );
    if (params.reason !== undefined)
      errors.push("reason is not accepted for complete.");
    return { action, evidence, errors };
  }

  const reason = normalizeField(params.reason, maxChars, "reason", errors);
  if (params.evidence !== undefined)
    errors.push("evidence is not accepted for yield.");
  return { action, reason, errors };
}

export function registerGoalTools(
  pi: ExtensionAPI,
  store: GoalStore,
  options: {
    evidenceMaxChars: number;
    showUsage?: boolean;
  },
): void {
  pi.registerTool({
    name: "goal",
    label: "Goal",
    description:
      "Read the active goal, complete it with audited evidence, or yield autonomous control without completing it.",
    promptSnippet:
      "Use goal to inspect the durable objective, complete it with concrete evidence, or yield when autonomous progress cannot safely continue.",
    promptGuidelines: [
      "Use action=get when you need to inspect the current durable objective or auto-run state.",
      "Use action=complete only after auditing concrete artifacts, files, command output, tests, UI state, or other real evidence.",
      "Map every explicit goal requirement to concrete evidence before completing it.",
      "Keep completion evidence and yield reasons concise and within the effective configured limit; summarize commands/results instead of pasting full logs.",
      "Use action=yield when autonomous progress is blocked, unsafe, or requires user intervention. Yielding stops auto-run but leaves the goal active for /goal-renew.",
      "Do not complete merely because TODOs are done, tests pass, effort was substantial, context is low, or you are stopping.",
    ],
    parameters: createGoalParamsSchema(),
    async execute(_toolCallId, rawParams) {
      const params =
        rawParams && typeof rawParams === "object"
          ? (rawParams as GoalParams)
          : {};
      const validated = validateParams(params, options.evidenceMaxChars);
      if (validated.errors.length > 0) {
        return errorResult(validated.errors, store);
      }

      if (validated.action === "get") {
        return textResult(
          formatGoalState(store.getState(), { showUsage: options.showUsage }),
          store,
        );
      }

      const goal = store.getGoal();
      if (!goal) return errorResult(["no goal is set."], store);

      if (validated.action === "complete") {
        if (goal.status === "paused") {
          return errorResult(
            ["goal is paused; resume it before completing."],
            store,
          );
        }
        if (goal.status === "complete") {
          return textResult(
            formatGoalState(store.getState(), { showUsage: options.showUsage }),
            store,
          );
        }
        store.complete(validated.evidence!, options.evidenceMaxChars);
        appendState(pi, store);
        return textResult(
          formatGoalState(store.getState(), { showUsage: options.showUsage }),
          store,
        );
      }

      if (goal.status !== "active") {
        return errorResult(
          [`goal is ${goal.status}; only an active goal can yield.`],
          store,
        );
      }
      if (store.getAutoRun()?.status !== "running") {
        return textResult(
          `Auto-run is already stopped.\n${formatGoalState(store.getState(), { showUsage: options.showUsage })}`,
          store,
        );
      }

      store.stopAutoRun("agent_yield", validated.reason!);
      appendState(pi, store);
      return textResult(
        formatGoalState(store.getState(), { showUsage: options.showUsage }),
        store,
      );
    },
  });
}
