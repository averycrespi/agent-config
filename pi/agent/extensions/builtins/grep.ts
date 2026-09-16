/**
 * Compact renderer for the built-in `grep` tool.
 *
 * Shows a one-line pattern label and a count of matches on success.
 * Execution is delegated to Pi's built-in grep tool unchanged.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "@earendil-works/pi-coding-agent";
import {
  clearPartialTimer,
  countNonEmptyLines,
  firstLine,
  getRelativeLabel,
  getResultText,
  getTruncatedText,
  partialElapsed,
  plural,
} from "../_shared/render.ts";

const grepTools = new Map<string, ReturnType<typeof createGrepTool>>();

function getGrepTool(cwd: string) {
  let tool = grepTools.get(cwd);
  if (!tool) {
    tool = createGrepTool(cwd);
    grepTools.set(cwd, tool);
  }
  return tool;
}

export default function registerGrep(pi: ExtensionAPI) {
  const defaultTool = getGrepTool(process.cwd());

  pi.registerTool({
    name: "grep",
    label: "grep",
    description: defaultTool.description,
    parameters: defaultTool.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getGrepTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const pattern = args?.pattern ?? "";
      const scope = getRelativeLabel(context.cwd, args?.path ?? ".");
      const globSuffix = args?.glob ? theme.fg("muted", ` (${args.glob})`) : "";
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)} ${theme.fg("muted", `in ${scope}`)}${globSuffix}`,
      ]);
    },

    renderResult(result, { isPartial }, theme, context) {
      const pattern = context.args?.pattern ?? "pattern";

      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg(
            "warning",
            `Searching /${pattern}/...${partialElapsed(context)}`,
          ),
        ]);
      }

      clearPartialTimer(context);

      const text = getResultText(result);

      if (context.isError) {
        const message = firstLine(text) || `Error searching /${pattern}/`;
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", message),
        ]);
      }

      const count = countNonEmptyLines(text);
      if (count === 0) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("muted", "no matches"),
        ]);
      }

      return getTruncatedText(context.lastComponent, [
        theme.fg("muted", plural(count, "match", "matches")),
      ]);
    },
  });
}
