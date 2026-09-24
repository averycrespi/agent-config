import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { builtinRenderers } from "./render.ts";

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
    ...builtinRenderers("bash"),
  });
}
