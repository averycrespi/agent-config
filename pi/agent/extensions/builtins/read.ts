import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { builtinRenderers } from "./render.ts";

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
    ...builtinRenderers("read"),
  });
}
