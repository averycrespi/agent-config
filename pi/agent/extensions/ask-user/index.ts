/**
 * Ask extension for Pi — provides an `ask_user` tool for multiple-choice questions.
 *
 * Renders a custom TUI at the bottom of the terminal with keyboard navigation,
 * numbered options, and an inline free-text fallback with escape-to-back support.
 */

import { randomUUID } from "node:crypto";
import type {
  InputOutcome,
  InputRequestedEvent,
  InputResolvedEvent,
} from "./api.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import {
  firstLine,
  getResultText,
  displayLabel,
  expandedResult,
  getTruncatedText,
  toolSummary,
} from "../_shared/render.ts";
import { OTHER_LABEL, validateAskParams } from "./validate.ts";

const RECOMMENDED_SUFFIX = " (Recommended)";

const askOption = Type.Object({
  label: Type.String({
    description: "Short, scannable choice label.",
    minLength: 1,
  }),
  description: Type.Optional(
    Type.String({
      description: "Optional brief explanation of the trade-off.",
      minLength: 1,
    }),
  ),
});

const askParams = Type.Object({
  question: Type.String({
    description: "The question to ask the user.",
    minLength: 1,
  }),
  context: Type.Optional(
    Type.String({
      description: "Optional context or framing shown above the options.",
      minLength: 1,
    }),
  ),
  options: Type.Array(askOption, {
    description:
      "The options to present. Do not include an 'Other' option — it is added automatically.",
    minItems: 2,
    maxItems: 5,
  }),
  recommended: Type.Optional(
    Type.Integer({
      description:
        "0-indexed option to mark as recommended. Put the recommended option first and set recommended=<index>.",
      minimum: 0,
    }),
  ),
});

type AskParams = Static<typeof askParams>;

interface DisplayOption {
  label: string;
  description?: string;
  isOther?: boolean;
}

interface InteractiveDetails {
  cancelled: boolean;
  answerLabel?: string;
  answerIndex?: number | null;
  isCustom?: boolean;
}

type AskDetails = InteractiveDetails;

const ASK_DESCRIPTION = `
Ask the user a multiple-choice question when a decision materially affects the outcome.

- Use when multiple valid approaches have different trade-offs.
- Ask only one focused question per call.
- Keep the question and optional context brief and scannable.
- Do not paste long writeups, design sections, or walls of text into context; summarize only what the user needs to choose.
- Prefer 2–5 options.
- Each option must have a short label and may include a brief description.
- Put the recommended option first and set recommended=<index> (0-indexed).
- Use descriptions for trade-offs, not labels.
- Do NOT include an 'Other' option — it is added automatically.
- Do NOT use this for trivial proceed/confirm prompts.
- Managed workers use their explicit mailbox handoff for questions, not ask_user. Standalone interactive questions remain unchanged.
`.trim();

function validationError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { cancelled: true } as AskDetails,
  };
}

function cancelledResult(message = "User cancelled — no option selected.") {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    details: { cancelled: true } as AskDetails,
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_DESCRIPTION,
    parameters: askParams,

    async execute(_toolCallId, params: AskParams, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: ask_user requires interactive mode. Cannot present choices in non-interactive context.",
            },
          ],
          details: { cancelled: true } as AskDetails,
        };
      }

      const validationMessage = validateAskParams(params);
      if (validationMessage) return validationError(validationMessage);

      if (signal?.aborted)
        return cancelledResult("User prompt aborted — no option selected.");

      const allOptions: DisplayOption[] = [
        ...params.options.map((o) => ({ ...o, label: o.label.trim() })),
        { label: OTHER_LABEL, isOther: true },
      ];

      let abortHandler: (() => void) | undefined;
      let requestId: string | undefined;
      let outcome: InputOutcome = "failed";
      const publish = (
        name: string,
        event: InputRequestedEvent | InputResolvedEvent,
      ) => {
        try {
          pi.events.emit(name, Object.freeze(event));
        } catch {
          // Event observers cannot change the user's result or UI cleanup.
        }
      };
      type Answer = { answer: string; index: number | null; isCustom: boolean };
      let result: Answer | null | undefined;
      pi.events.emit("herdr:blocked", {
        active: true,
        label: "Waiting for user answer",
      });
      try {
        result = await ctx.ui.custom<Answer | null>((tui, theme, _kb, done) => {
          if (!signal?.aborted) {
            requestId = randomUUID();
            publish("ask-user:input_requested", { requestId });
          }
          let finished = false;
          const finish = (
            value: {
              answer: string;
              index: number | null;
              isCustom: boolean;
            } | null,
          ) => {
            if (finished) return;
            finished = true;
            if (abortHandler)
              signal?.removeEventListener("abort", abortHandler);
            done(value);
          };
          abortHandler = () => finish(null);
          signal?.addEventListener("abort", abortHandler, { once: true });
          if (signal?.aborted) finish(null);
          let optionIndex = 0;
          let editMode = false;
          let cachedLines: string[] | undefined;
          let cachedWidth: number | undefined;

          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          editor.onSubmit = (value) => {
            const trimmed = value.trim();
            if (trimmed) {
              finish({ answer: trimmed, index: null, isCustom: true });
            } else {
              editMode = false;
              editor.setText("");
              refresh();
            }
          };

          function refresh() {
            cachedLines = undefined;
            cachedWidth = undefined;
            tui.requestRender();
          }

          function handleInput(data: string) {
            if (editMode) {
              if (matchesKey(data, Key.escape)) {
                editMode = false;
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            if (matchesKey(data, Key.up)) {
              optionIndex = Math.max(0, optionIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.enter)) {
              const selected = allOptions[optionIndex];
              if (selected.isOther) {
                editMode = true;
                refresh();
              } else {
                finish({
                  answer: selected.label,
                  index: optionIndex + 1,
                  isCustom: false,
                });
              }
              return;
            }
            if (matchesKey(data, Key.escape)) {
              finish(null);
            }
          }

          function render(width: number): string[] {
            if (cachedLines && cachedWidth === width) return cachedLines;

            const lines: string[] = [];
            const add = (s: string) => lines.push(truncateToWidth(s, width));
            const addWrapped = (s: string) => {
              for (const line of wrapTextWithAnsi(s, Math.max(1, width))) {
                lines.push(line);
              }
            };

            add(theme.fg("accent", "─".repeat(width)));
            addWrapped(
              theme.fg("text", ` ${displayLabel(params.question, 2000)}`),
            );

            if (params.context) {
              lines.push("");
              addWrapped(
                theme.fg("muted", ` ${displayLabel(params.context, 2000)}`),
              );
            }

            lines.push("");

            for (let i = 0; i < allOptions.length; i++) {
              const opt = allOptions[i];
              const selected = i === optionIndex;
              const prefix = selected ? theme.fg("accent", "> ") : "  ";

              let labelText = displayLabel(opt.label, 500);
              if (i === params.recommended) labelText += RECOMMENDED_SUFFIX;

              if (opt.isOther && editMode) {
                add(prefix + theme.fg("accent", `${i + 1}. ${labelText} ✎`));
              } else if (selected) {
                add(prefix + theme.fg("accent", `${i + 1}. ${labelText}`));
              } else {
                add(`  ${theme.fg("text", `${i + 1}. ${labelText}`)}`);
              }

              if (opt.description) {
                add(
                  `   ${theme.fg("muted", displayLabel(opt.description, 1000))}`,
                );
              }
            }

            if (editMode) {
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(width - 2)) {
                add(` ${line}`);
              }
            }

            lines.push("");
            if (editMode) {
              add(theme.fg("dim", " Enter to submit • Esc to go back"));
            } else {
              add(
                theme.fg(
                  "dim",
                  " ↑↓ navigate • Enter to select • Esc to cancel",
                ),
              );
            }
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            cachedWidth = width;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
              cachedWidth = undefined;
            },
            handleInput,
          };
        });
        outcome = result ? "answered" : "cancelled";
      } finally {
        if (abortHandler) signal?.removeEventListener("abort", abortHandler);
        if (requestId)
          publish("ask-user:input_resolved", { requestId, outcome });
        pi.events.emit("herdr:blocked", { active: false });
      }

      if (!result) {
        return cancelledResult();
      }

      if (result.isCustom) {
        return {
          content: [
            { type: "text" as const, text: `User wrote: ${result.answer}` },
          ],
          details: {
            cancelled: false,
            answerLabel: result.answer,
            answerIndex: null,
            isCustom: true,
          } as AskDetails,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `User selected: ${result.index}. ${result.answer}`,
          },
        ],
        details: {
          cancelled: false,
          answerLabel: result.answer,
          answerIndex: result.index,
          isCustom: false,
        } as AskDetails,
      };
    },

    renderCall(args, theme, context) {
      const options = Array.isArray(args.options) ? args.options : [];
      return getTruncatedText(context.lastComponent, [
        toolSummary(theme, "ask_user", "choice", `${options.length} options`),
        ...(context.expanded
          ? [
              displayLabel(args.question, 2000),
              ...options.map(
                (o, i) => `${i + 1}. ${displayLabel(o.label, 500)}`,
              ),
            ]
          : []),
      ]);
    },

    renderResult(result, { isPartial, expanded }, theme, context) {
      const details = result.details as AskDetails | undefined;
      const failed =
        context.isError ||
        firstLine(getResultText(result)).startsWith("Error:");
      const state = isPartial
        ? "waiting for answer"
        : failed
          ? "request failed"
          : !details
            ? "status unavailable"
            : details.cancelled
              ? "cancelled"
              : details.isCustom
                ? "answered · custom response"
                : `answered · option ${details.answerIndex ?? "selected"}`;
      return getTruncatedText(context.lastComponent, [
        toolSummary(
          theme,
          "ask_user",
          "",
          state,
          "",
          failed
            ? "error"
            : isPartial || details?.cancelled || !details
              ? "warning"
              : "success",
        ),
        ...(expanded ? expandedResult(result) : []),
      ]);
    },
  });
}
