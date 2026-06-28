import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWorkflowTool } from "./workflow-tool.ts";

export default function (pi: ExtensionAPI) {
  registerWorkflowTool(pi);

  const addBeforeAgentStart = (pi as any).addBeforeAgentStart;
  if (typeof addBeforeAgentStart === "function") {
    addBeforeAgentStart.call(
      pi,
      [
        "## Workflows extension",
        "Use the `workflow` tool when deterministic JavaScript orchestration is better than manually dispatching several subagents.",
        "Workflow scripts must start with `export const meta = { name, description }`, define `export async function run()`, and use only the provided globals: agent, parallel, pipeline, phase, log, args, and cwd. Use `agent(prompt, { output: { schema } })` only when workflow fan-in needs machine-readable subagent results.",
        "The Phase 1 workflow tool is foreground-only and read-mostly: do not use it for parallel implementation or workspace mutation.",
      ].join("\n"),
    );
  }
}
