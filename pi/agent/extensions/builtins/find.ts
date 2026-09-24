import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFindTool } from "@earendil-works/pi-coding-agent";
import { builtinRenderers } from "./render.ts";

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
    ...builtinRenderers("find"),
  });
}
