import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "@earendil-works/pi-coding-agent";
import { builtinRenderers } from "./render.ts";

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
    ...builtinRenderers("grep"),
  });
}
