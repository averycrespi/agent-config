import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
  registerConfigCommand,
} from "../_shared/config.ts";
import {
  clearPartialTimer,
  firstLine,
  getResultText,
  getTruncatedText,
  partialElapsed,
} from "../_shared/render.ts";
import { applyExactTextEdits, resolvePlanFilePath } from "./artifact.ts";
import {
  buildWorkflowCompactionSummary,
  deriveNextAction,
  extractTodoItemsFromBranch,
} from "./compaction.ts";
import {
  buildModeContract,
  DEFAULT_THINKING_LEVELS,
  getManagedToolNamesForMode,
  getThinkingLevelForMode,
} from "./modes.ts";
import { WORKFLOW_MODE_CHANGED_EVENT, type WorkflowModeState } from "./api.ts";
import type {
  ThinkingLevel,
  WorkflowMode,
  WorkflowModeThinkingLevels,
} from "./types.ts";

type RuntimeState = {
  mode: WorkflowMode;
  pendingCompactionMode?: Exclude<WorkflowMode, "normal">;
  baselineTools?: string[];
  baselineThinking?: string;
  thinkingLevels: WorkflowModeThinkingLevels;
  autoAdvanceEnabled: boolean;
  autoAdvanceFixLoopsUsed: number;
  missingAdvanceFollowUpsUsed: number;
  todoReminderTurnsSinceTodo: number;
  todoReminderTurnsSinceReminder: number;
};

type DevWorkflowConfig = {
  autoCompactOnModeSwitch: boolean;
  autoCompactMinTokens: number;
  autoCompactOnAdvance: boolean;
  autoCompactAdvanceMinTokens: number;
  autoAdvanceEnabled: boolean;
  autoAdvanceMaxFixLoops: number;
  todoReminderEnabled: boolean;
  todoReminderTurnsSinceTodo: number;
  todoReminderTurnsBetweenReminders: number;
  planThinkingLevel: ThinkingLevel;
  executeThinkingLevel: ThinkingLevel;
  verifyThinkingLevel: ThinkingLevel;
};

type DevWorkflowExtensionOptions = {
  loadConfig?: (cwd: string) => Promise<DevWorkflowConfig>;
};

const DEFAULT_CONFIG: DevWorkflowConfig = {
  autoCompactOnModeSwitch: true,
  autoCompactMinTokens: 50_000,
  autoCompactOnAdvance: true,
  autoCompactAdvanceMinTokens: 30_000,
  autoAdvanceEnabled: false,
  autoAdvanceMaxFixLoops: 2,
  todoReminderEnabled: true,
  todoReminderTurnsSinceTodo: 3,
  todoReminderTurnsBetweenReminders: 3,
  planThinkingLevel: DEFAULT_THINKING_LEVELS.plan,
  executeThinkingLevel: DEFAULT_THINKING_LEVELS.execute,
  verifyThinkingLevel: DEFAULT_THINKING_LEVELS.verify,
};

const WRITE_PLAN_PARAMS = Type.Object({
  path: Type.String({
    description:
      "Markdown file path scoped to the repo-root .plans/ directory. Bare filenames are written under .plans/.",
  }),
  content: Type.String({
    description: "Full markdown content to write to the selected .plans file.",
  }),
});

const ADVANCE_PARAMS = Type.Object({
  state: Type.Union(
    [
      Type.Literal("execute"),
      Type.Literal("verify"),
      Type.Literal("completed"),
      Type.Literal("aborted"),
    ],
    {
      description:
        "Workflow state to advance to: execute, verify, completed, or aborted.",
    },
  ),
  reason: Type.String({
    description: "Concise reason for the workflow advance decision.",
  }),
});

type WritePlanParams = Static<typeof WRITE_PLAN_PARAMS>;
type AdvanceParams = Static<typeof ADVANCE_PARAMS>;

const MISSING_ADVANCE_FOLLOW_UP_LIMIT = 2;

const EDIT_PLAN_PARAMS = Type.Object({
  path: Type.String({
    description:
      "Markdown file path scoped to the repo-root .plans/ directory. Bare filenames are resolved under .plans/.",
  }),
  edits: Type.Array(
    Type.Object({
      old_text: Type.String({
        description:
          "Exact text that must match a unique, non-overlapping region of the original plan file.",
      }),
      new_text: Type.String({
        description: "Replacement text for the matched region.",
      }),
    }),
    { minItems: 1 },
  ),
});

type EditPlanParams = Static<typeof EDIT_PLAN_PARAMS>;

function planPathLabel(cwd: string, path: unknown): string {
  if (typeof path !== "string" || path.length === 0) return ".plans/file.md";
  const normalized = path.startsWith("@") ? path.slice(1) : path;
  if (
    normalized === ".plans" ||
    normalized.startsWith(".plans/") ||
    normalized.startsWith("/")
  ) {
    return normalized.startsWith(cwd)
      ? normalized.slice(cwd.length + 1)
      : normalized;
  }
  return `.plans/${normalized}`;
}

function countLines(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return text.split("\n").length;
}

function renderWritePlanCall(args: WritePlanParams, theme: any, context: any) {
  const fileLabel = planPathLabel(context.cwd, args.path);
  const lineCount = countLines(args.content);
  return getTruncatedText(context.lastComponent, [
    `${theme.fg("toolTitle", theme.bold("write_plan"))} ${theme.fg("accent", fileLabel)} ${theme.fg("dim", `(${lineCount} lines)`)}`,
  ]);
}

function renderWritePlanResult(
  result: any,
  { isPartial }: { isPartial: boolean },
  theme: any,
  context: any,
) {
  const fileLabel = planPathLabel(context.cwd, context.args?.path);
  if (isPartial) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("warning", `Writing ${fileLabel}...${partialElapsed(context)}`),
    ]);
  }

  clearPartialTimer(context);
  const text = getResultText(result);
  if (context.isError || text.startsWith("write_plan:")) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("error", firstLine(text) || `Error writing ${fileLabel}`),
    ]);
  }

  return getTruncatedText(context.lastComponent, [
    theme.fg("success", "Written"),
  ]);
}

function renderEditPlanCall(args: EditPlanParams, theme: any, context: any) {
  const fileLabel = planPathLabel(context.cwd, args.path);
  return getTruncatedText(context.lastComponent, [
    `${theme.fg("toolTitle", theme.bold("edit_plan"))} ${theme.fg("accent", fileLabel)}`,
  ]);
}

function renderEditPlanResult(
  result: any,
  { expanded, isPartial }: { expanded?: boolean; isPartial: boolean },
  theme: any,
  context: any,
) {
  const fileLabel = planPathLabel(context.cwd, context.args?.path);
  if (isPartial) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("warning", `Editing ${fileLabel}...${partialElapsed(context)}`),
    ]);
  }

  clearPartialTimer(context);
  const text = getResultText(result);
  if (context.isError || text.startsWith("edit_plan:")) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("error", firstLine(text) || `Error editing ${fileLabel}`),
    ]);
  }

  const diff =
    typeof result.details?.diff === "string" ? result.details.diff : "";
  if (!diff) {
    return getTruncatedText(context.lastComponent, [
      theme.fg("success", "Applied"),
    ]);
  }

  let additions = 0;
  let removals = 0;
  const diffLines = diff.split("\n");
  for (const line of diffLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removals += 1;
  }

  const lines = [
    `${theme.fg("success", `+${additions}`)}${theme.fg("dim", " / ")}${theme.fg("error", `-${removals}`)}`,
  ];
  if (expanded) {
    for (const line of diffLines.slice(0, 30)) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push(theme.fg("success", line));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        lines.push(theme.fg("error", line));
      } else {
        lines.push(theme.fg("dim", line));
      }
    }
    if (diffLines.length > 30) {
      lines.push(
        theme.fg("muted", `... ${diffLines.length - 30} more diff lines`),
      );
    }
  }

  return getTruncatedText(context.lastComponent, lines);
}

export function createDevWorkflowExtension(
  options: DevWorkflowExtensionOptions = {},
) {
  const loadDevWorkflowConfig = options.loadConfig ?? loadConfig;

  return function (pi: ExtensionAPI) {
    const state: RuntimeState = {
      mode: "normal",
      thinkingLevels: { ...DEFAULT_THINKING_LEVELS },
      autoAdvanceEnabled: false,
      autoAdvanceFixLoopsUsed: 0,
      missingAdvanceFollowUpsUsed: 0,
      todoReminderTurnsSinceTodo: 0,
      todoReminderTurnsSinceReminder: 0,
    };

    registerConfigCommand(pi, {
      extensionName: "dev-workflow",
      loadConfig: loadDevWorkflowConfig,
    });

    function getWorkflowModeState(): WorkflowModeState {
      return {
        mode: state.mode,
        baseThinking: getThinkingLevelForMode(state.mode, state.thinkingLevels),
        baselineThinking:
          state.mode === "normal" ? undefined : state.baselineThinking,
      };
    }

    function publishWorkflowModeState(): void {
      pi.events.emit(WORKFLOW_MODE_CHANGED_EVENT, getWorkflowModeState());
    }

    function captureBaselines(): void {
      if (!state.baselineTools) {
        state.baselineTools = pi.getActiveTools();
      }
      if (!state.baselineThinking) {
        state.baselineThinking = `${pi.getThinkingLevel()}`;
      }
    }

    function resetBaselines(): void {
      state.baselineTools = undefined;
      state.baselineThinking = undefined;
    }

    function updateRuntimeConfig(config: DevWorkflowConfig): void {
      state.thinkingLevels = {
        plan: config.planThinkingLevel,
        execute: config.executeThinkingLevel,
        verify: config.verifyThinkingLevel,
      };
      state.autoAdvanceEnabled = config.autoAdvanceEnabled;
    }

    function resetTodoReminder(): void {
      state.todoReminderTurnsSinceTodo = 0;
      state.todoReminderTurnsSinceReminder = 0;
    }

    function resetMissingAdvanceFollowUps(): void {
      state.missingAdvanceFollowUpsUsed = 0;
    }

    function buildMissingAdvanceFollowUpMessage(): string {
      if (state.mode === "execute") {
        return [
          "You stopped in Execute mode without calling the required workflow_advance decision tool.",
          'If implementation is ready for verification, call workflow_advance with state="verify" and a concise reason.',
          'If the workflow is blocked, unfixable, or cannot continue, call workflow_advance with state="aborted" and a concise reason.',
          "If you are not actually at a stopping point, continue the implementation work now.",
        ].join("\n");
      }

      return [
        "You stopped in Verify mode without calling the required workflow_advance decision tool.",
        'If verification found fixable issues, call workflow_advance with state="execute" and a concise reason.',
        'If verification passed, is blocked, found unfixable issues, or cannot continue, call workflow_advance with state="completed" or state="aborted" and a concise reason.',
        "If you are not actually at a stopping point, continue verification now.",
      ].join("\n");
    }

    function applyMode(mode: WorkflowMode): void {
      captureBaselines();
      if (!state.baselineTools || !state.baselineThinking) return;

      if (mode === "normal") {
        pi.setActiveTools([...state.baselineTools]);
        pi.setThinkingLevel(state.baselineThinking as any);
        return;
      }

      const available = new Set(pi.getAllTools().map((tool) => tool.name));
      const nextTools = getManagedToolNamesForMode(mode, {
        autoAdvanceEnabled: state.autoAdvanceEnabled,
      }).filter((name) => available.has(name));
      pi.setActiveTools(nextTools);
      const thinking = getThinkingLevelForMode(mode, state.thinkingLevels);
      if (thinking) {
        pi.setThinkingLevel(thinking as any);
      }
    }

    function buildKickoffMessage(
      mode: Exclude<WorkflowMode, "normal">,
      args: string,
    ): string {
      const lines = [`You are now in ${capitalize(mode)} mode.`];
      const trimmedArgs = args.trim();

      if (trimmedArgs) {
        lines.push(`User context from /${mode}:\n${trimmedArgs}`);
      } else {
        lines.push(
          "No additional command arguments were provided. Use the current conversation and repo context to get started.",
        );
      }

      if (mode === "plan") {
        lines.push(
          "Start discovery now. Read relevant repo context first. For non-trivial work, do not write or edit a plan yet: ask one focused requirements question or present the next material decision with a recommendation, then wait for the user's answer. Author .plans/*.md only after discovery, approach exploration, and user validation are complete.",
        );
      } else if (mode === "execute") {
        lines.push(
          "Start implementing now. Use the available conversation context and any relevant .plans/*.md files you discover or that the user referenced. If this is non-trivial or has multiple steps, call todo now to create or update the working checklist before editing files. Keep exactly one item in_progress while working.",
        );
      } else {
        lines.push(
          "Start verification now. Run deterministic checks first and review the current work against the available conversation context and any relevant .plans/*.md files.",
        );
      }

      return lines.join("\n\n");
    }

    function sendKickoffMessage(
      mode: Exclude<WorkflowMode, "normal">,
      args: string,
      ctx: ExtensionContext,
    ): void {
      const message = buildKickoffMessage(mode, args);
      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
        return;
      }
      pi.sendUserMessage(message, { deliverAs: "steer" });
    }

    function sendAdvanceKickoffMessage(
      mode: Exclude<WorkflowMode, "normal">,
      args: string,
    ): void {
      pi.sendUserMessage(buildKickoffMessage(mode, args), {
        deliverAs: "followUp",
      });
    }

    function buildTodoReminderMessage(ctx: ExtensionContext): string {
      const todos = extractTodoItemsFromBranch(ctx.sessionManager.getBranch());
      const lines = [
        "The todo tool has not been used recently in Execute mode. If this implementation work benefits from progress tracking, call todo now to create, refresh, or clean up the working checklist. Keep exactly one item in_progress while working. If the current task is trivial or tracking would add no value, ignore this reminder.",
        "Do not mention this reminder to the user.",
      ];

      if (todos.length > 0) {
        lines.push(
          "Current TODO list:",
          ...todos.map(
            (todo) =>
              `- [${todo.status}] ${todo.text}${todo.notes ? ` · ${todo.notes}` : ""}`,
          ),
        );
      }

      return lines.join("\n");
    }

    async function updateAutoAdvanceStatus(
      ctx: ExtensionContext,
    ): Promise<void> {
      if (!ctx.hasUI) return;
      const config = await loadDevWorkflowConfig(ctx.cwd);
      if (!config.autoAdvanceEnabled || state.mode === "normal") {
        ctx.ui.setStatus("dev-workflow", undefined);
        return;
      }

      const exhausted =
        state.autoAdvanceFixLoopsUsed >= config.autoAdvanceMaxFixLoops;
      const budget = `${state.autoAdvanceFixLoopsUsed}/${config.autoAdvanceMaxFixLoops}`;
      ctx.ui.setStatus(
        "dev-workflow",
        exhausted ? `↻ exhausted ${budget}` : `↻ auto ${budget}`,
      );
    }

    async function transitionToMode(
      mode: Exclude<WorkflowMode, "normal">,
      args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> {
      state.autoAdvanceFixLoopsUsed = 0;
      resetMissingAdvanceFollowUps();
      const config = await loadDevWorkflowConfig(ctx.cwd);
      updateRuntimeConfig(config);
      if (state.mode !== mode) {
        await maybeCompactBeforeModeSwitch(mode, ctx, {
          enabled: config.autoCompactOnModeSwitch,
          minTokens: config.autoCompactMinTokens,
          label: "Workflow mode",
        });
        applyMode(mode);
      }
      state.mode = mode;
      resetMissingAdvanceFollowUps();
      resetTodoReminder();
      publishWorkflowModeState();
      await updateAutoAdvanceStatus(ctx);
      sendKickoffMessage(mode, args, ctx);
    }

    async function transitionToModeFromAdvance(
      mode: "execute" | "verify",
      args: string,
      ctx: ExtensionContext,
      config: DevWorkflowConfig,
    ): Promise<void> {
      updateRuntimeConfig(config);
      if (state.mode !== mode) {
        await maybeCompactBeforeModeSwitch(mode, ctx, {
          enabled: config.autoCompactOnAdvance,
          minTokens: config.autoCompactAdvanceMinTokens,
          label: "Workflow advance",
        });
        applyMode(mode);
      }
      state.mode = mode;
      resetMissingAdvanceFollowUps();
      resetTodoReminder();
      publishWorkflowModeState();
      await updateAutoAdvanceStatus(ctx);
      sendAdvanceKickoffMessage(mode, args);
    }

    async function exitWorkflowFromAdvance(
      terminalState: "completed" | "aborted",
      reason: string,
      ctx: ExtensionContext,
    ): Promise<void> {
      captureBaselines();
      if (state.mode !== "normal") {
        applyMode("normal");
      }
      state.mode = "normal";
      state.autoAdvanceFixLoopsUsed = 0;
      resetMissingAdvanceFollowUps();
      resetTodoReminder();
      publishWorkflowModeState();
      await updateAutoAdvanceStatus(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(`Workflow ${terminalState}: ${reason}`, "info");
      }
    }

    async function getUncommittedChangeCount(
      ctx: ExtensionContext,
      signal: AbortSignal | undefined,
    ): Promise<number> {
      const result = await pi.exec(
        "git",
        ["-C", ctx.cwd, "status", "--porcelain=v1"],
        { signal },
      );
      if (result.code !== 0) return 0;
      return result.stdout.trim().split("\n").filter(Boolean).length;
    }

    async function maybeCompactBeforeModeSwitch(
      mode: Exclude<WorkflowMode, "normal">,
      ctx: ExtensionContext,
      options: {
        enabled: boolean;
        minTokens: number;
        label: "Workflow mode" | "Workflow advance";
      },
    ): Promise<void> {
      if (!options.enabled || !ctx.isIdle()) return;

      const tokens = ctx.getContextUsage()?.tokens;
      if (typeof tokens !== "number" || tokens < options.minTokens) {
        return;
      }

      state.pendingCompactionMode = mode;
      await new Promise<void>((resolve) => {
        if (ctx.hasUI) {
          ctx.ui.notify(`Compacting before ${mode} mode`, "info");
        }
        ctx.compact({
          customInstructions: `Prepare the session for switching to ${mode} workflow mode. Preserve current goals, decisions, TODOs, changed files, and next actions.`,
          onComplete: () => {
            state.pendingCompactionMode = undefined;
            if (ctx.hasUI) {
              ctx.ui.notify(
                `${options.label} pre-compaction completed`,
                "info",
              );
            }
            resolve();
          },
          onError: (error) => {
            state.pendingCompactionMode = undefined;
            if (ctx.hasUI) {
              ctx.ui.notify(
                `${options.label} pre-compaction failed: ${error.message}`,
                "error",
              );
            }
            resolve();
          },
        });
      });
    }

    pi.registerTool({
      name: "workflow_advance",
      label: "Workflow Advance",
      description:
        "Advance an automatic workflow to Execute, Verify, completed, or aborted when auto advance is enabled.",
      parameters: ADVANCE_PARAMS,
      async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
        const params = rawParams as AdvanceParams;
        const config = await loadDevWorkflowConfig(ctx.cwd);
        updateRuntimeConfig(config);
        if (!config.autoAdvanceEnabled) {
          return {
            content: [
              {
                type: "text" as const,
                text: "workflow_advance: automatic advance is disabled by configuration",
              },
            ],
            details: {},
          };
        }

        if (state.mode !== "execute" && state.mode !== "verify") {
          return {
            content: [
              {
                type: "text" as const,
                text: "workflow_advance: only available while workflow modes are in Execute or Verify mode",
              },
            ],
            details: {},
          };
        }

        const reason = params.reason.trim();
        const displayReason = reason || "No reason provided.";
        const nextState = params.state;

        if (
          state.mode === "execute" &&
          nextState !== "verify" &&
          nextState !== "aborted"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "workflow_advance: Execute mode can only advance to Verify or aborted",
              },
            ],
            details: {},
          };
        }
        if (
          state.mode === "verify" &&
          nextState !== "execute" &&
          nextState !== "completed" &&
          nextState !== "aborted"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "workflow_advance: Verify mode can only advance to Execute, completed, or aborted",
              },
            ],
            details: {},
          };
        }

        if (state.mode === "execute" && nextState === "verify") {
          const changeCount = await getUncommittedChangeCount(ctx, signal);
          if (changeCount > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `workflow_advance: cannot advance to Verify with uncommitted changes (${changeCount} file(s)); commit or revert staged and unstaged changes first`,
                },
              ],
              details: { uncommittedChanges: changeCount },
            };
          }
        }

        if (nextState === "completed" || nextState === "aborted") {
          await exitWorkflowFromAdvance(nextState, displayReason, ctx);
          return {
            content: [
              {
                type: "text" as const,
                text: `workflow_advance: workflow ${nextState}`,
              },
            ],
            details: {
              state: nextState,
              reason: displayReason,
              fixLoopsUsed: state.autoAdvanceFixLoopsUsed,
              maxFixLoops: config.autoAdvanceMaxFixLoops,
            },
            terminate: true,
          };
        }

        if (
          state.mode === "verify" &&
          state.autoAdvanceFixLoopsUsed >= config.autoAdvanceMaxFixLoops
        ) {
          await updateAutoAdvanceStatus(ctx);
          return {
            content: [
              {
                type: "text" as const,
                text: `workflow_advance: automatic fix-loop cap reached (${state.autoAdvanceFixLoopsUsed}/${config.autoAdvanceMaxFixLoops})`,
              },
            ],
            details: {
              fixLoopsUsed: state.autoAdvanceFixLoopsUsed,
              maxFixLoops: config.autoAdvanceMaxFixLoops,
            },
          };
        }

        if (state.mode === "verify" && nextState === "execute") {
          state.autoAdvanceFixLoopsUsed += 1;
        }

        await transitionToModeFromAdvance(
          nextState,
          displayReason,
          ctx,
          config,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `workflow_advance: advanced to ${nextState} mode`,
            },
          ],
          details: {
            state: nextState,
            fixLoopsUsed: state.autoAdvanceFixLoopsUsed,
            maxFixLoops: config.autoAdvanceMaxFixLoops,
          },
          terminate: true,
        };
      },
    });

    pi.registerTool({
      name: "write_plan",
      label: "Write Plan",
      description:
        "Create or replace a markdown file under the repo-root .plans/ directory while in Plan mode.",
      parameters: WRITE_PLAN_PARAMS,
      renderCall: renderWritePlanCall,
      renderResult: renderWritePlanResult,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (state.mode !== "plan") {
          return {
            content: [
              {
                type: "text" as const,
                text: "write_plan: only available while workflow modes are in Plan mode",
              },
            ],
            details: {},
          };
        }

        const resolved = resolvePlanFilePath(ctx.cwd, params.path);
        if (!resolved.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `write_plan: ${resolved.error}`,
              },
            ],
            details: {},
          };
        }

        await mkdir(dirname(resolved.absolutePath), { recursive: true });
        await writeFile(resolved.absolutePath, params.content, "utf8");
        const byteLength = Buffer.byteLength(params.content, "utf8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully wrote ${byteLength} bytes to ${resolved.displayPath}`,
            },
          ],
          details: { path: resolved.displayPath },
        };
      },
    });

    pi.registerTool({
      name: "edit_plan",
      label: "Edit Plan",
      description:
        "Apply exact text replacements to a markdown file under the repo-root .plans/ directory while in Plan mode.",
      parameters: EDIT_PLAN_PARAMS,
      renderCall: renderEditPlanCall,
      renderResult: renderEditPlanResult,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (state.mode !== "plan") {
          return {
            content: [
              {
                type: "text" as const,
                text: "edit_plan: only available while workflow modes are in Plan mode",
              },
            ],
            details: {},
          };
        }

        const resolved = resolvePlanFilePath(ctx.cwd, params.path);
        if (!resolved.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `edit_plan: ${resolved.error}`,
              },
            ],
            details: {},
          };
        }

        let originalContent: string;
        try {
          originalContent = await readFile(resolved.absolutePath, "utf8");
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: `edit_plan: ${resolved.displayPath} does not exist`,
              },
            ],
            details: {},
          };
        }

        const edits = params.edits.map((edit) => ({
          oldText: edit.old_text,
          newText: edit.new_text,
        }));
        const edited = applyExactTextEdits(originalContent, edits);
        if (!edited.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `edit_plan: ${edited.error}`,
              },
            ],
            details: {},
          };
        }

        await writeFile(resolved.absolutePath, edited.content, "utf8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully replaced ${params.edits.length} block(s) in ${resolved.displayPath}.`,
            },
          ],
          details: {
            path: resolved.displayPath,
            diff: edited.diff,
            firstChangedLine: edited.firstChangedLine,
          },
        };
      },
    });

    pi.registerCommand("normal", {
      description: "Exit workflow modes and restore ordinary Pi behavior.",
      handler: async (_args, ctx) => {
        captureBaselines();
        if (state.mode !== "normal") {
          applyMode("normal");
        }
        state.mode = "normal";
        state.autoAdvanceFixLoopsUsed = 0;
        resetMissingAdvanceFollowUps();
        resetTodoReminder();
        publishWorkflowModeState();
        await updateAutoAdvanceStatus(ctx);
      },
    });

    for (const mode of ["plan", "execute", "verify"] as const) {
      pi.registerCommand(mode, {
        description: `Enter ${mode} mode for workflow modes.`,
        handler: async (args, ctx) => {
          await transitionToMode(mode, args, ctx);
        },
      });
    }

    pi.on("session_start", async (_event, ctx) => {
      updateRuntimeConfig(await loadDevWorkflowConfig(ctx.cwd));
      resetBaselines();
      captureBaselines();
      if (state.mode !== "normal") {
        applyMode("normal");
      }
      state.mode = "normal";
      state.autoAdvanceFixLoopsUsed = 0;
      resetMissingAdvanceFollowUps();
      resetTodoReminder();
      publishWorkflowModeState();
      await updateAutoAdvanceStatus(ctx);
    });

    pi.on("session_tree", async (_event, ctx) => {
      if (state.mode !== "normal") {
        applyMode("normal");
      }
      state.mode = "normal";
      state.autoAdvanceFixLoopsUsed = 0;
      resetMissingAdvanceFollowUps();
      resetTodoReminder();
      publishWorkflowModeState();
      await updateAutoAdvanceStatus(ctx);
    });

    pi.on("session_shutdown", async () => {
      state.mode = "normal";
      state.autoAdvanceFixLoopsUsed = 0;
      resetMissingAdvanceFollowUps();
      resetBaselines();
      publishWorkflowModeState();
    });

    pi.on("before_agent_start", async (event, ctx) => {
      if (state.mode === "normal") return undefined;
      const config = await loadDevWorkflowConfig(ctx.cwd);
      updateRuntimeConfig(config);
      return {
        systemPrompt: `${event.systemPrompt}\n\n${buildModeContract({
          mode: state.mode,
          autoAdvanceEnabled: config.autoAdvanceEnabled,
        })}`,
      };
    });

    pi.on("agent_end", async (_event, ctx) => {
      if (state.mode !== "execute" && state.mode !== "verify") return;
      const config = await loadDevWorkflowConfig(ctx.cwd);
      if (!config.autoAdvanceEnabled) return;
      if (ctx.hasPendingMessages()) return;

      if (
        state.missingAdvanceFollowUpsUsed >= MISSING_ADVANCE_FOLLOW_UP_LIMIT
      ) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Workflow advance fallback cap reached; staying in current mode",
            "warning",
          );
        }
        return;
      }

      state.missingAdvanceFollowUpsUsed += 1;
      pi.sendUserMessage(buildMissingAdvanceFollowUpMessage(), {
        deliverAs: "followUp",
      });
    });

    pi.on("tool_call", async (event, ctx) => {
      if (state.mode === "normal") return undefined;
      const config = await loadDevWorkflowConfig(ctx.cwd);
      updateRuntimeConfig(config);
      const allowed = new Set(
        getManagedToolNamesForMode(state.mode, {
          autoAdvanceEnabled: state.autoAdvanceEnabled,
        }),
      );
      if (allowed.has(event.toolName)) return undefined;
      return {
        block: true,
        reason: `dev-workflow: ${event.toolName} is not available in ${state.mode} mode`,
      };
    });

    pi.on("tool_result", async (event) => {
      if (event.toolName === "todo") {
        resetTodoReminder();
      }
    });

    pi.on("turn_end", async () => {
      if (state.mode !== "execute") return;
      state.todoReminderTurnsSinceTodo += 1;
      state.todoReminderTurnsSinceReminder += 1;
    });

    (pi as any).on("context", async (event: any, ctx: ExtensionContext) => {
      if (state.mode !== "execute") return undefined;
      if (!pi.getActiveTools().includes("todo")) return undefined;

      const config = await loadDevWorkflowConfig(ctx.cwd);
      if (!config.todoReminderEnabled) return undefined;
      if (
        state.todoReminderTurnsSinceTodo < config.todoReminderTurnsSinceTodo ||
        state.todoReminderTurnsSinceReminder <
          config.todoReminderTurnsBetweenReminders
      ) {
        return undefined;
      }

      state.todoReminderTurnsSinceReminder = 0;
      return {
        messages: [
          ...event.messages,
          {
            role: "user",
            content: [{ type: "text", text: buildTodoReminderMessage(ctx) }],
          },
        ],
      };
    });

    pi.on("session_before_compact", async (event) => {
      if (state.mode === "normal") return undefined;
      const todos = extractTodoItemsFromBranch(
        event.branchEntries as unknown[],
      );
      const compactionMode = state.pendingCompactionMode ?? state.mode;
      const nextAction = deriveNextAction({
        todos,
        mode: compactionMode,
      });
      return {
        compaction: {
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          summary: buildWorkflowCompactionSummary({
            mode: compactionMode,
            todos,
            nextAction,
          }),
          details: {
            version: 2,
            devWorkflow: {
              mode: compactionMode,
              nextAction,
            },
          },
        },
      };
    });
  };
}

export async function loadConfig(cwd: string): Promise<DevWorkflowConfig> {
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
  });
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG,
    globalSettings: readExtensionSettings(globalSettings, "dev-workflow"),
    projectSettings: readExtensionSettings(projectSettings, "dev-workflow"),
    envSettings: readEnvSettings(),
  });

  return {
    autoCompactOnModeSwitch:
      typeof merged.autoCompactOnModeSwitch === "boolean"
        ? merged.autoCompactOnModeSwitch
        : DEFAULT_CONFIG.autoCompactOnModeSwitch,
    autoCompactMinTokens:
      typeof merged.autoCompactMinTokens === "number" &&
      Number.isFinite(merged.autoCompactMinTokens) &&
      merged.autoCompactMinTokens >= 0
        ? merged.autoCompactMinTokens
        : DEFAULT_CONFIG.autoCompactMinTokens,
    autoCompactOnAdvance:
      typeof merged.autoCompactOnAdvance === "boolean"
        ? merged.autoCompactOnAdvance
        : DEFAULT_CONFIG.autoCompactOnAdvance,
    autoCompactAdvanceMinTokens:
      typeof merged.autoCompactAdvanceMinTokens === "number" &&
      Number.isFinite(merged.autoCompactAdvanceMinTokens) &&
      merged.autoCompactAdvanceMinTokens >= 0
        ? merged.autoCompactAdvanceMinTokens
        : DEFAULT_CONFIG.autoCompactAdvanceMinTokens,
    autoAdvanceEnabled:
      typeof merged.autoAdvanceEnabled === "boolean"
        ? merged.autoAdvanceEnabled
        : DEFAULT_CONFIG.autoAdvanceEnabled,
    autoAdvanceMaxFixLoops:
      typeof merged.autoAdvanceMaxFixLoops === "number" &&
      Number.isInteger(merged.autoAdvanceMaxFixLoops) &&
      merged.autoAdvanceMaxFixLoops >= 0
        ? merged.autoAdvanceMaxFixLoops
        : DEFAULT_CONFIG.autoAdvanceMaxFixLoops,
    todoReminderEnabled:
      typeof merged.todoReminderEnabled === "boolean"
        ? merged.todoReminderEnabled
        : DEFAULT_CONFIG.todoReminderEnabled,
    todoReminderTurnsSinceTodo:
      typeof merged.todoReminderTurnsSinceTodo === "number" &&
      Number.isInteger(merged.todoReminderTurnsSinceTodo) &&
      merged.todoReminderTurnsSinceTodo >= 1
        ? merged.todoReminderTurnsSinceTodo
        : DEFAULT_CONFIG.todoReminderTurnsSinceTodo,
    todoReminderTurnsBetweenReminders:
      typeof merged.todoReminderTurnsBetweenReminders === "number" &&
      Number.isInteger(merged.todoReminderTurnsBetweenReminders) &&
      merged.todoReminderTurnsBetweenReminders >= 1
        ? merged.todoReminderTurnsBetweenReminders
        : DEFAULT_CONFIG.todoReminderTurnsBetweenReminders,
    planThinkingLevel: parseThinkingLevel(
      merged.planThinkingLevel,
      DEFAULT_CONFIG.planThinkingLevel,
    ),
    executeThinkingLevel: parseThinkingLevel(
      merged.executeThinkingLevel,
      DEFAULT_CONFIG.executeThinkingLevel,
    ),
    verifyThinkingLevel: parseThinkingLevel(
      merged.verifyThinkingLevel,
      DEFAULT_CONFIG.verifyThinkingLevel,
    ),
  };
}

export function readEnvSettings(): Partial<DevWorkflowConfig> {
  const settings: Partial<DevWorkflowConfig> = {};
  setBooleanEnv(
    settings,
    "autoCompactOnModeSwitch",
    process.env.DEV_WORKFLOW_AUTO_COMPACT_ON_MODE_SWITCH,
  );
  setNumberEnv(
    settings,
    "autoCompactMinTokens",
    process.env.DEV_WORKFLOW_AUTO_COMPACT_MIN_TOKENS,
    false,
  );
  setBooleanEnv(
    settings,
    "autoCompactOnAdvance",
    process.env.DEV_WORKFLOW_AUTO_COMPACT_ON_ADVANCE,
  );
  setNumberEnv(
    settings,
    "autoCompactAdvanceMinTokens",
    process.env.DEV_WORKFLOW_AUTO_COMPACT_ADVANCE_MIN_TOKENS,
    false,
  );
  setBooleanEnv(
    settings,
    "autoAdvanceEnabled",
    process.env.DEV_WORKFLOW_AUTO_ADVANCE_ENABLED,
  );
  setNumberEnv(
    settings,
    "autoAdvanceMaxFixLoops",
    process.env.DEV_WORKFLOW_AUTO_ADVANCE_MAX_FIX_LOOPS,
    true,
  );
  setBooleanEnv(
    settings,
    "todoReminderEnabled",
    process.env.DEV_WORKFLOW_TODO_REMINDER_ENABLED,
  );
  setNumberEnv(
    settings,
    "todoReminderTurnsSinceTodo",
    process.env.DEV_WORKFLOW_TODO_REMINDER_TURNS_SINCE_TODO,
    true,
  );
  setNumberEnv(
    settings,
    "todoReminderTurnsBetweenReminders",
    process.env.DEV_WORKFLOW_TODO_REMINDER_TURNS_BETWEEN_REMINDERS,
    true,
  );
  setThinkingLevelEnv(
    settings,
    "planThinkingLevel",
    process.env.DEV_WORKFLOW_PLAN_THINKING_LEVEL,
  );
  setThinkingLevelEnv(
    settings,
    "executeThinkingLevel",
    process.env.DEV_WORKFLOW_EXECUTE_THINKING_LEVEL,
  );
  setThinkingLevelEnv(
    settings,
    "verifyThinkingLevel",
    process.env.DEV_WORKFLOW_VERIFY_THINKING_LEVEL,
  );
  return settings;
}

function setBooleanEnv<K extends keyof DevWorkflowConfig>(
  settings: Partial<DevWorkflowConfig>,
  key: K,
  value: string | undefined,
): void {
  const parsed = parseBooleanEnv(value);
  if (parsed !== undefined) {
    (settings as Record<string, unknown>)[key] = parsed;
  }
}

function setNumberEnv<K extends keyof DevWorkflowConfig>(
  settings: Partial<DevWorkflowConfig>,
  key: K,
  value: string | undefined,
  integer: boolean,
): void {
  if (value === undefined || value.trim() === "") return;
  const parsed = Number(value);
  if (
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    (!integer || Number.isInteger(parsed))
  ) {
    (settings as Record<string, unknown>)[key] = parsed;
  }
}

function setThinkingLevelEnv<K extends keyof DevWorkflowConfig>(
  settings: Partial<DevWorkflowConfig>,
  key: K,
  value: string | undefined,
): void {
  if (value !== undefined && isThinkingLevel(value.trim())) {
    (settings as Record<string, unknown>)[key] = value.trim();
  }
}

function parseThinkingLevel(
  value: unknown,
  fallback: ThinkingLevel,
): ThinkingLevel {
  return typeof value === "string" && isThinkingLevel(value) ? value : fallback;
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value);
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export default createDevWorkflowExtension();
