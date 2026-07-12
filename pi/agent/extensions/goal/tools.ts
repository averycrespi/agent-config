import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  formatGoalState,
  normalizeBoundedText,
  type GoalStore,
} from "./state.ts";
import {
  runGoalReview,
  type GoalReviewRequest,
  type GoalReviewResult,
} from "./review.ts";

export const STATE_ENTRY_TYPE = "goal-state";

function createGoalUpdateParamsSchema(evidenceMaxChars: number) {
  return Type.Object({
    status: Type.String({
      enum: ["complete"],
      description: "Only 'complete' is accepted.",
    }),
    evidence: Type.String({
      maxLength: evidenceMaxChars,
      description: `Concise concrete evidence that every explicit goal requirement is satisfied. Must be at most ${evidenceMaxChars} characters; summarize logs/results instead of pasting raw output.`,
    }),
  });
}

type GoalUpdateParams = { status: string; evidence: string };

function textResult(text: string, store: GoalStore) {
  return {
    content: [{ type: "text" as const, text }],
    details: store.getState(),
  };
}

function errorResult(message: string, store: GoalStore) {
  return textResult(`Error: ${message}`, store);
}

function appendState(pi: ExtensionAPI, store: GoalStore): void {
  const appendEntry = (pi as any).appendEntry;
  if (typeof appendEntry === "function") {
    appendEntry.call(pi, STATE_ENTRY_TYPE, store.getState());
  }
}

export function registerGoalTools(
  pi: ExtensionAPI,
  store: GoalStore,
  options: {
    evidenceMaxChars: number;
    showUsage?: boolean;
    reviewEnabled?: boolean;
    reviewMaxFixRounds?: number;
    reviewTimeoutSeconds?: number;
    reviewRunner?: (request: GoalReviewRequest) => Promise<GoalReviewResult>;
  },
): void {
  pi.registerTool({
    name: "goal_get",
    label: "Goal: get",
    description: "Read the current session-scoped goal state.",
    promptSnippet: "Read the current durable goal, if any.",
    promptGuidelines: [
      "Use goal_get when you need to check the current durable objective.",
      "Do not treat TODO completion as proof that the goal is complete.",
    ],
    parameters: Type.Object({}),
    async execute() {
      return textResult(
        formatGoalState(store.getState(), { showUsage: options.showUsage }),
        store,
      );
    },
  });

  pi.registerTool({
    name: "goal_update",
    label: "Goal: update",
    description: `Mark the current goal complete with concise evidence, up to ${options.evidenceMaxChars} characters.`,
    promptSnippet: `Mark the current goal complete only after auditing concise concrete evidence. Keep evidence at most ${options.evidenceMaxChars} characters.`,
    promptGuidelines: [
      "Use goal_update only after auditing concrete artifacts, files, command output, tests, UI state, or other real evidence.",
      "Map every explicit goal requirement to concrete evidence before marking complete.",
      `Keep evidence concise and at most ${options.evidenceMaxChars} characters; summarize commands/results and cite artifacts instead of pasting full logs.`,
      "Do not mark complete merely because TODOs are done, tests pass, effort was substantial, context is low, or you are stopping.",
      "If evidence is incomplete, continue working or report the blocker instead.",
    ],
    parameters: createGoalUpdateParamsSchema(options.evidenceMaxChars),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as GoalUpdateParams;
      if (params.status !== "complete") {
        return errorResult('status must be "complete".', store);
      }
      const goal = store.getGoal();
      if (!goal) return errorResult("no goal is set.", store);
      if (goal.status === "paused") {
        return errorResult(
          "goal is paused; resume it before completing.",
          store,
        );
      }
      if (goal.status === "complete") {
        return textResult(
          formatGoalState(store.getState(), { showUsage: options.showUsage }),
          store,
        );
      }
      if (goal.review?.status === "reviewing") {
        return errorResult("completion review is already in progress.", store);
      }
      let evidence: string;
      try {
        evidence = normalizeBoundedText(
          params.evidence,
          options.evidenceMaxChars,
          "evidence",
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
          store,
        );
      }
      if (!options.reviewEnabled) {
        store.complete(evidence, options.evidenceMaxChars);
        appendState(pi, store);
        return textResult(
          formatGoalState(store.getState(), { showUsage: options.showUsage }),
          store,
        );
      }

      const priorFindings = goal.review?.findings;
      const reviewing = store.beginReview(evidence, options.evidenceMaxChars);
      if (!reviewing?.review.attemptToken) {
        return errorResult("could not begin completion review.", store);
      }
      appendState(pi, store);
      const request: GoalReviewRequest = {
        goalId: reviewing.id,
        objective: reviewing.objective,
        evidence,
        ...(priorFindings?.length ? { priorFindings } : {}),
        cwd: ctx?.cwd ?? process.cwd(),
        timeoutSeconds: options.reviewTimeoutSeconds ?? 600,
        signal,
      };
      let result: GoalReviewResult;
      try {
        result = await (options.reviewRunner ?? runGoalReview)(request);
      } catch (error) {
        result = {
          kind: "failure",
          code: "spawn",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const token = reviewing.review.attemptToken;
      const applied =
        result.kind === "pass"
          ? store.applyReviewPass(
              reviewing.id,
              token,
              result.summary,
              result.findings,
            )
          : result.kind === "block"
            ? store.applyReviewBlock(
                reviewing.id,
                token,
                result.summary,
                result.findings,
                options.reviewMaxFixRounds ?? 1,
              )
            : store.applyReviewFailure(
                reviewing.id,
                token,
                result.code,
                result.message,
                result.logFile,
              );
      if (applied === "stale") {
        return textResult(
          "Completion review became stale because the goal changed; no review result was applied.",
          store,
        );
      }
      appendState(pi, store);
      const stateText = formatGoalState(store.getState(), {
        showUsage: options.showUsage,
      });
      if (
        result.kind === "block" &&
        store.getGoal()?.review?.status === "fix_required"
      ) {
        return textResult(
          `${stateText}\nValidate and fix reasonable blocking findings, or refute them with concrete evidence, then call goal_update again for a full re-review. Suggestions do not need to be fixed blindly.`,
          store,
        );
      }
      if (result.kind === "block") {
        return textResult(
          `${stateText}\nCompletion review fix rounds are exhausted. The goal is paused; a human may use /goal-approve <reason> or /goal-resume to start a new review cycle.`,
          store,
        );
      }
      if (result.kind === "failure") {
        return textResult(
          `${stateText}\nCompletion review is unavailable and the goal is paused. There is no automatic retry; use /goal-resume before trying again.`,
          store,
        );
      }
      return textResult(stateText, store);
    },
  });
}
