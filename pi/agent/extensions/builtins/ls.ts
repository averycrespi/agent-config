/**
 * Compact renderer for the built-in `ls` tool.
 *
 * Shows a one-line path label and a short preview on success.
 * Execution is delegated to Pi's built-in ls tool unchanged.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLsTool } from "@earendil-works/pi-coding-agent";
import {
  clearPartialTimer,
  countNonEmptyLines,
  firstLine,
  getRelativeLabel,
  getResultText,
  getTruncatedText,
  headNonEmptyLines,
  partialElapsed,
  plural,
} from "../_shared/render.ts";

const lsTools = new Map<string, ReturnType<typeof createLsTool>>();

function getLsTool(cwd: string) {
  let tool = lsTools.get(cwd);
  if (!tool) {
    tool = createLsTool(cwd);
    lsTools.set(cwd, tool);
  }
  return tool;
}

export default function registerLs(pi: ExtensionAPI) {
  const defaultTool = getLsTool(process.cwd());

  pi.registerTool({
    name: "ls",
    label: "ls",
    description: defaultTool.description,
    parameters: defaultTool.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getLsTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const pathLabel = getRelativeLabel(context.cwd, args?.path ?? ".");
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", pathLabel)}`,
      ]);
    },

    renderResult(result, { isPartial }, theme, context) {
      const pathLabel = getRelativeLabel(
        context.cwd,
        context.args?.path ?? ".",
      );

      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg(
            "warning",
            `Listing ${pathLabel}...${partialElapsed(context)}`,
          ),
        ]);
      }

      clearPartialTimer(context);

      const text = getResultText(result);

      if (context.isError) {
        const message = firstLine(text) || `Error listing ${pathLabel}`;
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", message),
        ]);
      }

      const head = headNonEmptyLines(text, 3);
      if (head.length === 0) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("muted", "empty"),
        ]);
      }

      const totalLines = countNonEmptyLines(text);
      const extra = totalLines - head.length;
      const displayLines =
        extra > 0
          ? [...head, `... +${plural(extra, "more entry", "more entries")}`]
          : head;
      return getTruncatedText(
        context.lastComponent,
        displayLines.map((line) => theme.fg("muted", line)),
      );
    },
  });
}
