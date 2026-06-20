import { readFile } from "node:fs/promises";
import { handoffPath } from "./paths.ts";
import type { TaskDefinition } from "./task-file.ts";

export async function renderPrompt(options: {
  rootDir: string;
  task: TaskDefinition;
  runId: string;
}): Promise<{ prompt: string; includedHandoff: boolean }> {
  let handoff = "";
  let includedHandoff = false;
  if (options.task.handoff) {
    try {
      handoff = await readFile(
        handoffPath(options.rootDir, options.task.id),
        "utf8",
      );
      includedHandoff = handoff.trim().length > 0;
    } catch {
      includedHandoff = false;
    }
  }
  const lines = [
    "# Scheduled task run",
    "",
    `Task ID: ${options.task.id}`,
    `Run ID: ${options.runId}`,
    "",
    "You are running as a scheduled Pi task.",
    "",
    "Rules:",
    "",
    "- Do the task described below.",
    "- Your final response should summarize what you did and any issues.",
  ];
  if (options.task.handoff) {
    lines.push(
      "- If a `Previous handoff` section is present, use it as prior context and update the handoff at the end of meaningful work using `scheduled_task_handoff`.",
    );
  }
  if (includedHandoff)
    lines.push("", "## Previous handoff", "", handoff.trim());
  lines.push("", "## Task", "", options.task.body.trim(), "");
  return { prompt: lines.join("\n"), includedHandoff };
}
