import { execFile as _nodeExecFile } from "node:child_process";
import { access } from "node:fs/promises";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ScheduledTasksConfig } from "./config.ts";
import {
  buildCronBlock,
  installManagedBlock,
  uninstallManagedBlock,
} from "./cron.ts";
import { ensureRootLayout, isSafeTaskId, taskPath } from "./paths.ts";
import { manualRunTask, readLatestLogs, schedulerTick } from "./scheduler.ts";
import {
  readAllTasks,
  readTaskFile,
  type ParsedTaskFile,
} from "./task-file.ts";
import { formatValidation, validateConfig, validateTask } from "./validate.ts";

export const _execFile = { fn: _nodeExecFile };

type LoadConfig = (
  cwd: string,
  warnings?: string[],
) => Promise<ScheduledTasksConfig>;

function notify(
  ctx: ExtensionCommandContext,
  text: string,
  level: "info" | "warning" | "error" = "info",
) {
  ctx.ui.notify(text, level);
}

const TASK_ID_RULES =
  "Use letters, numbers, underscores, or hyphens; no slashes or dots.";

function taskIdArg(
  args: string,
  command: string,
  ctx: ExtensionCommandContext,
): string | undefined {
  const taskId = args.trim();
  if (!taskId) {
    notify(ctx, `Usage: /${command} <task-id>`, "warning");
    return undefined;
  }
  if (!isSafeTaskId(taskId)) {
    notify(ctx, `Invalid task ID. ${TASK_ID_RULES}`, "error");
    return undefined;
  }
  return taskId;
}

async function existingTaskPath(
  config: ScheduledTasksConfig,
  taskId: string,
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  const path = taskPath(config.rootDir, taskId);
  try {
    await access(path);
    return path;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "ENOENT") {
      notify(ctx, `Task not found: ${taskId}`, "warning");
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    notify(ctx, `Unable to access task file: ${message}`, "error");
    return undefined;
  }
}

async function currentCrontab(): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      _execFile.fn("crontab", ["-l"], (error, stdout) =>
        error ? reject(error) : resolve(String(stdout ?? "")),
      );
    });
  } catch {
    return "";
  }
}

async function writeCrontab(content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = _execFile.fn("crontab", ["-"], (error) =>
      error ? reject(error) : resolve(),
    );
    child.stdin?.end(content);
  });
}

export function registerScheduledTaskCommands(
  pi: ExtensionAPI,
  loadConfig: LoadConfig,
): void {
  async function configFor(ctx: ExtensionCommandContext) {
    const warnings: string[] = [];
    const config = await loadConfig(ctx.cwd, warnings);
    return { config, warnings };
  }

  pi.registerCommand("tasks-list", {
    description:
      "List scheduled task IDs, enabled state, next run, and last status.",
    handler: async (_args, ctx) => {
      const { config } = await configFor(ctx);
      await ensureRootLayout(config.rootDir);
      const tasks = await readAllTasks(config.rootDir);
      const lines = tasks.some((parsed) => parsed.task)
        ? ["Scheduled tasks:"]
        : ["No tasks found."];
      for (const parsed of tasks) {
        const task = parsed.task;
        if (!task) continue;
        lines.push(
          `- ${task.id}: ${task.enabled ? "enabled" : "disabled"}${task.description ? ` — ${task.description}` : ""}`,
        );
      }
      notify(ctx, lines.join("\n"));
    },
  });

  pi.registerCommand("tasks-show", {
    description: "Show parsed scheduled task metadata and prompt body.",
    handler: async (args, ctx) => {
      const taskId = taskIdArg(args, "tasks-show", ctx);
      if (!taskId) return;
      const { config } = await configFor(ctx);
      const path = await existingTaskPath(config, taskId, ctx);
      if (!path) return;
      const parsed = await readTaskFile(path);
      if (!parsed.task)
        return notify(
          ctx,
          parsed.errors.join("\n") || "Task not found.",
          "error",
        );
      const { body, rawFrontmatter: _rawFrontmatter, ...meta } = parsed.task;
      notify(
        ctx,
        `${JSON.stringify(meta, null, 2)}\n\n## Body\n${body.slice(0, 4000)}`,
      );
    },
  });

  pi.registerCommand("tasks-run", {
    description: "Manually spawn a scheduled child Pi run for a task.",
    handler: async (args, ctx) => {
      const taskId = taskIdArg(args, "tasks-run", ctx);
      if (!taskId) return;
      const { config } = await configFor(ctx);
      if (!(await existingTaskPath(config, taskId, ctx))) return;
      const result = await manualRunTask(config, taskId);
      notify(
        ctx,
        `${result.status}: ${result.message}${result.runDir ? `\n${result.runDir}` : ""}`,
        result.status === "success" ? "info" : "warning",
      );
    },
  });

  pi.registerCommand("tasks-logs", {
    description: "Show latest scheduled task run logs and artifact paths.",
    handler: async (args, ctx) => {
      const taskId = taskIdArg(args, "tasks-logs", ctx);
      if (!taskId) return;
      const { config } = await configFor(ctx);
      if (!(await existingTaskPath(config, taskId, ctx))) return;
      notify(ctx, await readLatestLogs(config, taskId));
    },
  });

  pi.registerCommand("tasks-doctor", {
    description: "Validate scheduled task files and scheduler health.",
    handler: async (args, ctx) => {
      const { config, warnings } = await configFor(ctx);
      await ensureRootLayout(config.rootDir);
      const taskId = args.trim();
      if (taskId && !isSafeTaskId(taskId)) {
        return notify(ctx, `Invalid task ID. ${TASK_ID_RULES}`, "error");
      }
      const lines = [
        `rootDir: ${config.rootDir}`,
        ...warnings.map((warning) => `config warning: ${warning}`),
      ];
      for (const issue of await validateConfig(config))
        lines.push(`${issue.severity}: ${issue.message}`);
      let parsed: ParsedTaskFile[];
      if (taskId) {
        const path = await existingTaskPath(config, taskId, ctx);
        if (!path) return;
        parsed = [await readTaskFile(path)];
      } else {
        parsed = await readAllTasks(config.rootDir);
      }
      for (const item of parsed)
        lines.push(
          "",
          formatValidation(await validateTask(item.task, config, item.errors)),
        );
      notify(ctx, lines.join("\n"));
    },
  });

  pi.registerCommand("tasks-install-cron", {
    description: "Install or update the managed scheduled-tasks crontab block.",
    handler: async (_args, ctx) => {
      const { config } = await configFor(ctx);
      const next = installManagedBlock(
        await currentCrontab(),
        buildCronBlock({
          projectCwd: ctx.cwd,
          piCommand: config.piCommand,
          cronEnvironment: config.cronEnvironment,
        }),
      );
      await writeCrontab(next);
      notify(ctx, "Installed managed Pi scheduled-tasks crontab block.");
    },
  });

  pi.registerCommand("tasks-uninstall-cron", {
    description: "Remove only the managed scheduled-tasks crontab block.",
    handler: async (_args, ctx) => {
      await writeCrontab(uninstallManagedBlock(await currentCrontab()));
      notify(ctx, "Removed managed Pi scheduled-tasks crontab block.");
    },
  });

  pi.registerCommand("tasks-tick", {
    description:
      "Run one scheduled-tasks scheduler tick. Use --dry-run to inspect without mutating.",
    handler: async (args, ctx) => {
      const { config } = await configFor(ctx);
      const dryRun = args
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .includes("--dry-run");
      notify(
        ctx,
        JSON.stringify(await schedulerTick(config, { dryRun }), null, 2),
      );
    },
  });
}
