import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getResultText,
  getTruncatedText,
  firstLine,
} from "../_shared/render.ts";
import type { ScheduledTasksConfig } from "./config.ts";
import { formatCrontabStatus, getCrontabStatus } from "./crontab.ts";
import { handoffPath, runDir, taskPath } from "./paths.ts";
import { manualRunTask, readLatestLogs } from "./scheduler.ts";
import { readAllTasks, readTaskFile } from "./task-file.ts";
import { formatValidation, validateConfig, validateTask } from "./validate.ts";

const actionSchema = StringEnum(
  ["list", "read", "validate", "run", "logs", "doctor"] as const,
  { description: "Scheduled task management action." },
);
const paramsSchema = Type.Object({
  action: actionSchema,
  task_id: Type.Optional(Type.String({ description: "Task ID." })),
});
type Params = Static<typeof paramsSchema>;

const handoffActionSchema = StringEnum(["read", "update"] as const, {
  description: "Handoff action.",
});
const handoffParamsSchema = Type.Object({
  action: handoffActionSchema,
  content: Type.Optional(
    Type.String({ description: "New handoff content for update." }),
  ),
});
type HandoffParams = Static<typeof handoffParamsSchema>;

type LoadConfig = (
  cwd: string,
  warnings?: string[],
) => Promise<ScheduledTasksConfig>;

function textResult(text: string, details?: unknown) {
  return { content: [{ type: "text" as const, text }], details };
}

function errorResult(message: string, details?: unknown) {
  return textResult(`Error: ${message}`, details);
}

function summarize(args: Params): string {
  return `${args.action}${args.task_id ? ` ${args.task_id}` : ""}`;
}

export function registerScheduledTasksTool(
  pi: ExtensionAPI,
  loadConfig: LoadConfig,
): void {
  pi.registerTool({
    name: "scheduled_tasks",
    label: "Scheduled Tasks",
    description: "Manage and debug Markdown-defined scheduled Pi tasks.",
    promptSnippet: "Inspect, validate, manually run, and debug scheduled tasks",
    promptGuidelines: [
      "Use scheduled_tasks for existing scheduled task inspection, validation, manual runs, logs, and doctor checks.",
      "Do not use it for structured task creation or update in v1; edit Markdown task files normally, then validate.",
      "Use task_id, not paths. Validation errors are returned as text so you can recover.",
    ],
    parameters: paramsSchema,
    renderCall(args, theme, context) {
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("scheduled_tasks"))} ${theme.fg("muted", summarize(args as Params))}`,
      ]);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial)
        return getTruncatedText(context.lastComponent, [
          theme.fg("warning", "scheduled_tasks running..."),
        ]);
      const msg = firstLine(getResultText(result));
      return getTruncatedText(context.lastComponent, [
        theme.fg(
          context.isError || msg.startsWith("Error:") ? "error" : "success",
          msg || "done",
        ),
      ]);
    },
    async execute(_id, rawParams, _signal, _onUpdate, ctx) {
      if (process.env.PI_SCHEDULED_TASK_RUN === "1")
        return errorResult(
          "scheduled_tasks management is unavailable inside scheduled child runs.",
        );
      const params = rawParams as Params;
      const config = await loadConfig(ctx.cwd);
      switch (params.action) {
        case "list": {
          const parsed = await readAllTasks(config.rootDir);
          const details = parsed.map((item) =>
            item.task
              ? {
                  id: item.task.id,
                  enabled: item.task.enabled,
                  description: item.task.description,
                }
              : { errors: item.errors },
          );
          return textResult(
            details.length
              ? details
                  .map((item) =>
                    "id" in item
                      ? `${item.id}: ${item.enabled ? "enabled" : "disabled"}${item.description ? ` — ${item.description}` : ""}`
                      : `Error: ${item.errors.join("; ")}`,
                  )
                  .join("\n")
              : "No scheduled tasks found.",
            details,
          );
        }
        case "read": {
          if (!params.task_id)
            return errorResult("task_id is required for read.");
          const parsed = await readTaskFile(
            taskPath(config.rootDir, params.task_id),
          );
          if (!parsed.task)
            return errorResult(
              parsed.errors.join("\n") || "Task not found.",
              parsed,
            );
          return textResult(
            `${JSON.stringify({ ...parsed.task, body: undefined, rawFrontmatter: undefined }, null, 2)}\n\n## Body\n${parsed.task.body}`,
            parsed.task,
          );
        }
        case "validate": {
          const parsed = params.task_id
            ? [await readTaskFile(taskPath(config.rootDir, params.task_id))]
            : await readAllTasks(config.rootDir);
          const results = await Promise.all(
            parsed.map((item) => validateTask(item.task, config, item.errors)),
          );
          return textResult(
            results.map(formatValidation).join("\n\n"),
            results,
          );
        }
        case "run": {
          if (!params.task_id)
            return errorResult("task_id is required for run.");
          const result = await manualRunTask(config, params.task_id);
          return textResult(`${result.status}: ${result.message}`, result);
        }
        case "logs": {
          if (!params.task_id)
            return errorResult("task_id is required for logs.");
          return textResult(await readLatestLogs(config, params.task_id));
        }
        case "doctor": {
          const crontabStatus = await getCrontabStatus();
          const issues = await validateConfig(config);
          const parsed = params.task_id
            ? [await readTaskFile(taskPath(config.rootDir, params.task_id))]
            : await readAllTasks(config.rootDir);
          const results = await Promise.all(
            parsed.map((item) => validateTask(item.task, config, item.errors)),
          );
          return textResult(
            [
              `rootDir: ${config.rootDir}`,
              formatCrontabStatus(crontabStatus),
              ...issues.map((issue) => `${issue.severity}: ${issue.message}`),
              "",
              ...results.map(formatValidation),
            ].join("\n"),
            { crontabStatus, issues, tasks: results },
          );
        }
      }
    },
  });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, path);
}

export function registerHandoffTool(
  pi: ExtensionAPI,
  loadConfig: LoadConfig,
): void {
  pi.registerTool({
    name: "scheduled_task_handoff",
    label: "Scheduled Task Handoff",
    description:
      "Read or update the current scheduled task's scoped handoff file.",
    promptSnippet:
      "Read/update scoped scheduled-task handoff content during scheduled child runs",
    parameters: handoffParamsSchema,
    renderCall(args, theme, context) {
      const params = args as HandoffParams;
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("scheduled_task_handoff"))} ${theme.fg("muted", params.action)}`,
      ]);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial)
        return getTruncatedText(context.lastComponent, [
          theme.fg("warning", "handoff running..."),
        ]);
      const msg = firstLine(getResultText(result));
      return getTruncatedText(context.lastComponent, [
        theme.fg(
          context.isError || msg.startsWith("Error:") ? "error" : "success",
          msg || "done",
        ),
      ]);
    },
    async execute(_id, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as HandoffParams;
      if (process.env.PI_SCHEDULED_TASK_RUN !== "1")
        return errorResult(
          "scheduled_task_handoff is only available during scheduled child runs.",
        );
      const taskId = process.env.PI_SCHEDULED_TASK_ID;
      if (!taskId) return errorResult("PI_SCHEDULED_TASK_ID is missing.");
      const config = await loadConfig(ctx.cwd);
      const parsed = await readTaskFile(taskPath(config.rootDir, taskId));
      if (!parsed.task || !parsed.task.handoff)
        return errorResult("handoff is not enabled for this task.");
      const path = handoffPath(config.rootDir, taskId);
      if (params.action === "read") {
        try {
          return textResult(await readFile(path, "utf8"));
        } catch {
          return textResult("");
        }
      }
      if (typeof params.content !== "string")
        return errorResult("content is required for update.");
      await atomicWrite(path, params.content);
      const runId = process.env.PI_SCHEDULED_TASK_RUN_ID;
      let markerWarning = "";
      if (runId) {
        try {
          await writeFile(
            join(runDir(config.rootDir, taskId, runId), "handoff-updated"),
            "1",
            {
              mode: 0o600,
            },
          );
        } catch {
          markerWarning =
            " Handoff marker was not written because the run ID or run directory was invalid.";
        }
      } else {
        markerWarning =
          " Handoff marker was not written because PI_SCHEDULED_TASK_RUN_ID is missing.";
      }
      return textResult(`Updated scheduled task handoff.${markerWarning}`);
    },
  });
}
