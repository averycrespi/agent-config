import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "../_shared/config.ts";
import { EXTENSION_NAME, loadScheduledTasksConfig } from "./config.ts";
import { registerScheduledTaskCommands } from "./commands.ts";
import { registerHandoffTool, registerScheduledTasksTool } from "./tools.ts";

const baseDir = dirname(fileURLToPath(import.meta.url));

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
  pi.on("resources_discover", () => {
    if (process.env.PI_SCHEDULED_TASK_RUN === "1") return;
    return {
      skillPaths: [
        join(baseDir, "skills", "manage-scheduled-tasks", "SKILL.md"),
      ],
    };
  });

  if (process.env.PI_SCHEDULED_TASK_RUN === "1") {
    registerHandoffTool(pi, loadScheduledTasksConfig);
  } else {
    registerScheduledTasksTool(pi, loadScheduledTasksConfig);
  }
}
