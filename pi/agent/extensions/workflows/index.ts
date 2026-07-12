import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { loadWorkflowConfig, WORKFLOWS_EXTENSION_NAME } from "./config.ts";
import { registerWorkflowTool } from "./workflow-tool.ts";
import { formatWorkflowInventory, inventoryWorkflows } from "./store.ts";

export default function (pi: ExtensionAPI) {
  registerConfigCommand(pi, {
    extensionName: WORKFLOWS_EXTENSION_NAME,
    loadConfig: async (cwd, warnings) =>
      (await loadWorkflowConfig(cwd, warnings)) as unknown as Record<
        string,
        unknown
      >,
  });
  pi.registerCommand("workflows-list", {
    description: "List current user-scoped saved workflows.",
    handler: async (_args, ctx) => {
      const warnings: string[] = [];
      try {
        const config = await loadWorkflowConfig(ctx.cwd, warnings);
        const formatted = formatWorkflowInventory(
          await inventoryWorkflows(config.userWorkflowsDir),
        );
        ctx.ui.notify(
          [formatted.text, ...warnings].join("\n\n"),
          warnings.length > 0 ? "warning" : "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to list saved workflows: ${message}`, "error");
      }
    },
  });
  registerWorkflowTool(pi);
}
