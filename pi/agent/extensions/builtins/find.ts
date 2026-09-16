/**
 * Compact renderer for the built-in `find` tool.
 *
 * Shows a one-line glob pattern label and a short preview on success.
 * Execution is delegated to Pi's built-in find tool unchanged.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFindTool } from "@earendil-works/pi-coding-agent";
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

const findTools = new Map<string, ReturnType<typeof createFindTool>>();

function getFindTool(cwd: string) {
  let tool = findTools.get(cwd);
  if (!tool) {
    tool = createFindTool(cwd);
    findTools.set(cwd, tool);
  }
  return tool;
}

export default function registerFind(pi: ExtensionAPI) {
  const defaultTool = getFindTool(process.cwd());

  pi.registerTool({
    name: "find",
    label: "find",
    description: defaultTool.description,
    parameters: defaultTool.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getFindTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const pattern = args?.pattern ?? "";
      const scope = getRelativeLabel(context.cwd, args?.path ?? ".");
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)} ${theme.fg("muted", `in ${scope}`)}`,
      ]);
    },

    renderResult(result, { isPartial }, theme, context) {
      const pattern = context.args?.pattern ?? "files";

      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg(
            "warning",
            `Finding ${pattern}...${partialElapsed(context)}`,
          ),
        ]);
      }

      clearPartialTimer(context);

      const text = getResultText(result);

      if (context.isError) {
        const message = firstLine(text) || `Error finding ${pattern}`;
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", message),
        ]);
      }

      const head = headNonEmptyLines(text, 3);
      if (head.length === 0) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("muted", "no matches"),
        ]);
      }

      const totalLines = countNonEmptyLines(text);
      const extra = totalLines - head.length;
      const displayLines =
        extra > 0 ? [...head, `... +${plural(extra, "more result")}`] : head;
      return getTruncatedText(
        context.lastComponent,
        displayLines.map((line) => theme.fg("muted", line)),
      );
    },
  });
}
