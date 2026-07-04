import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { loadWorkflowConfig, WORKFLOWS_EXTENSION_NAME } from "./config.ts";
import { registerWorkflowTool } from "./workflow-tool.ts";

export default function (pi: ExtensionAPI) {
  registerConfigCommand(pi, {
    extensionName: WORKFLOWS_EXTENSION_NAME,
    loadConfig: async (cwd, warnings) =>
      (await loadWorkflowConfig(cwd, warnings)) as unknown as Record<
        string,
        unknown
      >,
  });
  registerWorkflowTool(pi);

  const addBeforeAgentStart = (pi as any).addBeforeAgentStart;
  if (typeof addBeforeAgentStart === "function") {
    addBeforeAgentStart.call(
      pi,
      [
        "## Workflows extension",
        "Use the `workflow` tool when deterministic JavaScript orchestration is better than manually dispatching several subagents.",
        "Workflow scripts must start with `export const meta = { name, description }`, define `export async function run()`, and use only the provided globals: agent, parallel, pipeline, phase, log, args, and cwd. Use `agent(prompt, { output: { schema } })` only when workflow fan-in needs machine-readable subagent results, and `timeoutMs` when one slow branch should fail independently.",
        "The Phase 1 workflow tool is foreground-only and read-mostly: do not use it for parallel implementation or workspace mutation.",
      ].join("\n"),
    );
  }
}
