import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { EXTENSION_NAME, loadScheduledTasksConfig } from "./config.ts";
import { registerScheduledTaskCommands } from "./commands.ts";
import { registerHandoffTool, registerScheduledTasksTool } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  registerConfigCommand(pi, {
    extensionName: EXTENSION_NAME,
    loadConfig: async (cwd, warnings) =>
      (await loadScheduledTasksConfig(cwd, warnings)) as unknown as Record<
        string,
        unknown
      >,
  });
  registerScheduledTaskCommands(pi, loadScheduledTasksConfig);

  if (process.env.PI_SCHEDULED_TASK_RUN === "1") {
    registerHandoffTool(pi, loadScheduledTasksConfig);
  } else {
    registerScheduledTasksTool(pi, loadScheduledTasksConfig);
  }
}
