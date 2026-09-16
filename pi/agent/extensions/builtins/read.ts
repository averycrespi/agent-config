/**
 * Compact renderer for the built-in `read` tool.
 *
 * Shows a one-line file label instead of file contents. Execution is
 * delegated to Pi's built-in read tool unchanged.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import {
  clearPartialTimer,
  firstLine,
  getRelativeLabel,
  getResultText,
  getTruncatedText,
  partialElapsed,
} from "../_shared/render.ts";

const readTools = new Map<string, ReturnType<typeof createReadTool>>();

function getReadTool(cwd: string) {
  let tool = readTools.get(cwd);
  if (!tool) {
    tool = createReadTool(cwd);
    readTools.set(cwd, tool);
  }
  return tool;
}

export default function registerRead(pi: ExtensionAPI) {
  const defaultTool = getReadTool(process.cwd());

  pi.registerTool({
    name: "read",
    label: "read",
    description: defaultTool.description,
    parameters: defaultTool.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getReadTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const fileLabel = getRelativeLabel(context.cwd, args.path);
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", fileLabel)}`,
      ]);
    },

    renderResult(result, { isPartial }, theme, context) {
      const fileLabel = getRelativeLabel(context.cwd, context.args?.path);

      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg(
            "warning",
            `Reading ${fileLabel}...${partialElapsed(context)}`,
          ),
        ]);
      }

      clearPartialTimer(context);

      if (context.isError) {
        const message =
          firstLine(getResultText(result)) || `Error reading ${fileLabel}`;
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", message),
        ]);
      }

      return getTruncatedText(context.lastComponent, []);
    },
  });
}
