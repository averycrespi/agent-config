/**
 * Compact renderer for the built-in `bash` tool.
 *
 * Shows the command as a one-line label, a short tail of output on success,
 * and a one-line error on failure. Execution is delegated to Pi's built-in
 * bash tool unchanged.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import {
  clearPartialTimer,
  firstLine,
  getResultText,
  getTruncatedText,
  partialElapsed,
  singleLineCommand,
  tailNonEmptyLines,
} from "../_shared/render.ts";

const TAIL_LINES = 3;

const bashTools = new Map<string, ReturnType<typeof createBashTool>>();

function getBashTool(cwd: string) {
  let tool = bashTools.get(cwd);
  if (!tool) {
    tool = createBashTool(cwd);
    bashTools.set(cwd, tool);
  }
  return tool;
}

export default function registerBash(pi: ExtensionAPI) {
  const defaultTool = getBashTool(process.cwd());

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: defaultTool.description,
    parameters: defaultTool.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const commandLabel = singleLineCommand(args?.command);
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("bash"))} ${theme.fg("accent", commandLabel)}`,
      ]);
    },

    renderResult(result, { isPartial }, theme, context) {
      const commandLabel = singleLineCommand(context.args?.command);

      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg(
            "warning",
            `Running ${commandLabel}...${partialElapsed(context)}`,
          ),
        ]);
      }

      clearPartialTimer(context);

      const text = getResultText(result);

      if (context.isError) {
        const message = firstLine(text) || `bash failed: ${commandLabel}`;
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", message),
        ]);
      }

      const tail = tailNonEmptyLines(text, TAIL_LINES);
      if (tail.length === 0) {
        return getTruncatedText(context.lastComponent, []);
      }

      return getTruncatedText(
        context.lastComponent,
        tail.map((line) => theme.fg("muted", line)),
      );
    },
  });
}
