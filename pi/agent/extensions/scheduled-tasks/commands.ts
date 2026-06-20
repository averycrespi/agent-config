import { execFile as _nodeExecFile } from "node:child_process";
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
import { ensureRootLayout, taskPath } from "./paths.ts";
import { manualRunTask, readLatestLogs, schedulerTick } from "./scheduler.ts";
import { readAllTasks, readTaskFile } from "./task-file.ts";
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
      const lines = ["Scheduled tasks:"];
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
      const taskId = args.trim();
      const { config } = await configFor(ctx);
      const parsed = await readTaskFile(taskPath(config.rootDir, taskId));
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
      const taskId = args.trim();
      const { config } = await configFor(ctx);
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
      const { config } = await configFor(ctx);
      notify(ctx, await readLatestLogs(config, args.trim()));
    },
  });

  pi.registerCommand("tasks-doctor", {
    description: "Validate scheduled task files and scheduler health.",
    handler: async (args, ctx) => {
      const { config, warnings } = await configFor(ctx);
      await ensureRootLayout(config.rootDir);
      const taskId = args.trim();
      const lines = [
        `rootDir: ${config.rootDir}`,
        ...warnings.map((warning) => `config warning: ${warning}`),
      ];
      for (const issue of await validateConfig(config))
        lines.push(`${issue.severity}: ${issue.message}`);
      const parsed = taskId
        ? [await readTaskFile(taskPath(config.rootDir, taskId))]
        : await readAllTasks(config.rootDir);
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
