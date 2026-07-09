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
}
