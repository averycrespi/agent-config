import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLsTool } from "@earendil-works/pi-coding-agent";
import { builtinRenderers } from "./render.ts";

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
    ...builtinRenderers("ls"),
  });
}
