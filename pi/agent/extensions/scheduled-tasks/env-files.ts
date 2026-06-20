import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isValidEnvName } from "./config.ts";
import type { TaskDefinition } from "./task-file.ts";

export interface EnvFileIssue {
  path: string;
  message: string;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

export function resolveEnvFilePath(
  task: Pick<TaskDefinition, "cwd">,
  path: string,
): string | undefined {
  if (isAbsolute(path)) return path;
  if (!task.cwd || !isAbsolute(task.cwd)) return undefined;
  return resolve(task.cwd, path);
}

export function parseDotenv(source: string): {
  values: Record<string, string>;
  issues: string[];
} {
  const values: Record<string, string> = {};
  const issues: string[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) {
      issues.push(`line ${index + 1}: expected KEY=value.`);
      continue;
    }
    const key = (match[1] ?? "").trim();
    if (!isValidEnvName(key)) {
      issues.push(
        `line ${index + 1}: invalid environment variable name: ${key}`,
      );
      continue;
    }
    values[key] = stripQuotes(match[2] ?? "");
  }
  return { values, issues };
}

export async function loadTaskEnvFiles(
  task: Pick<TaskDefinition, "cwd" | "envFiles">,
): Promise<{
  values: Record<string, string>;
  issues: EnvFileIssue[];
}> {
  const values: Record<string, string> = {};
  const issues: EnvFileIssue[] = [];
  for (const entry of task.envFiles ?? []) {
    const path = resolveEnvFilePath(task, entry);
    if (!path) {
      issues.push({
        path: entry,
        message: "relative env file paths require absolute cwd.",
      });
      continue;
    }
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      issues.push({ path: entry, message: "not found or unreadable." });
      continue;
    }
    const parsed = parseDotenv(source);
    Object.assign(values, parsed.values);
    for (const message of parsed.issues) issues.push({ path: entry, message });
  }
  return { values, issues };
}
