import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ScheduledTasksConfig } from "./config.ts";
import { commandHealth } from "./config.ts";
import { handoffPath, isSafeTaskId } from "./paths.ts";
import { parseCron } from "./schedule.ts";
import type { TaskDefinition } from "./task-file.ts";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  taskId?: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  effectiveTools: string[];
  issues: ValidationIssue[];
}

const THINKING = new Set(["low", "medium", "high", "none", "minimal"]);
const SENSITIVE_KEY = /(token|secret|password|key|credential)/i;

export function effectiveTools(
  task: Pick<TaskDefinition, "tools" | "handoff">,
  config: Pick<ScheduledTasksConfig, "defaultTools">,
): string[] {
  const base = task.tools === undefined ? config.defaultTools : task.tools;
  const tools = [...new Set(base.filter((tool) => tool.trim()))];
  if (task.handoff && !tools.includes("scheduled_task_handoff"))
    tools.push("scheduled_task_handoff");
  return tools;
}

export async function validateTask(
  task: TaskDefinition | undefined,
  config: ScheduledTasksConfig,
  parseErrors: string[] = [],
): Promise<ValidationResult> {
  const errors = [...parseErrors];
  const warnings: string[] = [];
  if (!task) {
    return {
      ok: false,
      errors: ["Task could not be parsed.", ...errors],
      warnings,
      effectiveTools: [],
      issues: [],
    };
  }
  if (!isSafeTaskId(task.id)) errors.push("Unsafe task ID.");
  if (!task.body.trim()) errors.push("Task Markdown body is required.");
  if (!task.enabled)
    warnings.push("Task is disabled; scheduled ticks will not run it.");
  if (!task.description) warnings.push("Task description is missing.");
  if (task.enabled && !task.schedule)
    errors.push("enabled tasks require schedule.");
  if (task.schedule && !parseCron(task.schedule))
    errors.push(`Invalid cron expression: ${task.schedule}`);
  if (task.enabled && !task.cwd)
    errors.push("enabled tasks require absolute existing cwd.");
  if (task.cwd) {
    if (!isAbsolute(task.cwd)) errors.push("cwd must be absolute.");
    else {
      try {
        const info = await stat(task.cwd);
        if (!info.isDirectory())
          errors.push("cwd must be an existing directory.");
      } catch {
        errors.push("cwd must be an existing directory.");
      }
    }
  }
  if (task.model !== undefined && !task.model.trim())
    errors.push("model must be a non-empty string.");
  if (task.thinking !== undefined && !THINKING.has(task.thinking))
    warnings.push(`Unrecognized thinking value: ${task.thinking}`);
  if (
    task.rawFrontmatter.tools !== undefined &&
    (!Array.isArray(task.rawFrontmatter.tools) ||
      (task.tools ?? []).length !==
        (task.rawFrontmatter.tools as unknown[]).length)
  )
    errors.push("tools must be an array of non-empty strings.");
  if (
    task.rawFrontmatter.env !== undefined &&
    (!task.rawFrontmatter.env ||
      typeof task.rawFrontmatter.env !== "object" ||
      Array.isArray(task.rawFrontmatter.env))
  )
    errors.push("env must be an object of scalar values.");
  for (const key of Object.keys(task.env ?? {}))
    if (SENSITIVE_KEY.test(key))
      warnings.push(
        `Env key ${key} looks sensitive; raw logs may expose child process output.`,
      );
  if (
    task.rawFrontmatter.timeoutMinutes !== undefined &&
    (typeof task.rawFrontmatter.timeoutMinutes !== "number" ||
      task.rawFrontmatter.timeoutMinutes <= 0)
  )
    errors.push("timeoutMinutes must be a positive number.");
  if (
    task.rawFrontmatter.handoff !== undefined &&
    typeof task.rawFrontmatter.handoff !== "boolean"
  )
    errors.push("handoff must be boolean in v1.");
  if (task.handoff) {
    try {
      await access(handoffPath(config.rootDir, task.id));
    } catch {
      warnings.push(
        "handoff is enabled but the handoff file does not exist yet.",
      );
    }
  }
  if (task.tools === undefined)
    warnings.push(
      "No task-specific tools configured; config defaultTools will be used.",
    );
  const tools = effectiveTools(task, config);
  if (tools.some((tool) => !/^[a-zA-Z0-9_.:-]+$/.test(tool)))
    errors.push("tools contain invalid names.");
  const issues = [
    ...errors.map((message) => ({ severity: "error" as const, message })),
    ...warnings.map((message) => ({ severity: "warning" as const, message })),
  ];
  return {
    taskId: task.id,
    ok: errors.length === 0,
    errors,
    warnings,
    effectiveTools: tools,
    issues,
  };
}

export async function validateConfig(
  config: ScheduledTasksConfig,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (config.defaultTimeoutMinutes <= 0)
    issues.push({
      severity: "error",
      message: "defaultTimeoutMinutes must be positive.",
    });
  if (config.defaultTools.some((tool) => !tool.trim()))
    issues.push({
      severity: "error",
      message: "defaultTools must contain non-empty tool names.",
    });
  for (const [name, command] of [["piCommand", config.piCommand]] as const) {
    const health = await commandHealth(command);
    if (health.warning)
      issues.push({
        severity: health.ok ? "warning" : "error",
        message: `${name}: ${health.warning}`,
      });
  }
  return issues;
}

export function formatValidation(result: ValidationResult): string {
  const lines = [`${result.ok ? "OK" : "ERROR"}: ${result.taskId ?? "task"}`];
  for (const error of result.errors) lines.push(`- error: ${error}`);
  for (const warning of result.warnings) lines.push(`- warning: ${warning}`);
  lines.push(
    `- effective tools: ${result.effectiveTools.length ? result.effectiveTools.join(", ") : "(none; --no-tools)"}`,
  );
  if (result.effectiveTools.includes("scheduled_task_handoff"))
    lines.push(
      "- note: scheduled_task_handoff is added automatically because handoff is enabled.",
    );
  return lines.join("\n");
}
