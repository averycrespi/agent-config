import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getRootPaths, isSafeTaskId } from "./paths.ts";

export interface TaskDefinition {
  id: string;
  path: string;
  body: string;
  description?: string;
  enabled: boolean;
  schedule?: string;
  cwd?: string;
  model?: string;
  thinking?: string;
  tools?: string[];
  envFiles?: string[];
  env?: Record<string, string>;
  timeoutMinutes?: number;
  handoff: boolean;
  rawFrontmatter: Record<string, unknown>;
}

export interface ParsedTaskFile {
  task?: TaskDefinition;
  errors: string[];
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => String(parseScalar(item.trim())))
      .filter(Boolean);
  }
  return value;
}

export function parseSimpleYaml(source: string): {
  value: Record<string, unknown>;
  errors: string[];
} {
  const value: Record<string, unknown> = {};
  const errors: string[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let currentKey: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      const list = Array.isArray(value[currentKey])
        ? (value[currentKey] as unknown[])
        : [];
      list.push(parseScalar(listMatch[1] ?? ""));
      value[currentKey] = list;
      continue;
    }
    const nestedMatch = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nestedMatch && currentKey) {
      const parent =
        typeof value[currentKey] === "object" &&
        value[currentKey] !== null &&
        !Array.isArray(value[currentKey])
          ? (value[currentKey] as Record<string, unknown>)
          : {};
      parent[nestedMatch[1] ?? ""] = parseScalar(nestedMatch[2] ?? "");
      value[currentKey] = parent;
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) {
      errors.push(`Line ${index + 1}: unsupported YAML syntax.`);
      continue;
    }
    const key = match[1] ?? "";
    const rest = match[2] ?? "";
    currentKey = key;
    value[key] = rest.trim() === "" ? [] : parseScalar(rest);
  }
  return { value, errors };
}

export function splitFrontmatter(source: string): {
  frontmatter: string;
  body: string;
  errors: string[];
} {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n"))
    return {
      frontmatter: "",
      body: normalized.trim(),
      errors: ["Missing YAML frontmatter block."],
    };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0)
    return {
      frontmatter: "",
      body: "",
      errors: ["Unclosed YAML frontmatter block."],
    };
  const frontmatter = normalized.slice(4, end);
  const after = normalized.slice(end + 4).replace(/^\n/, "");
  return { frontmatter, body: after.trim(), errors: [] };
}

function stringField(
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(raw: Record<string, unknown>, key: string): boolean {
  return raw[key] === true;
}

function toolsField(raw: Record<string, unknown>): string[] | undefined {
  const value = raw.tools;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

function envFilesField(raw: Record<string, unknown>): string[] | undefined {
  const value = raw.envFiles;
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

function envField(
  raw: Record<string, unknown>,
): Record<string, string> | undefined {
  const value = raw.env;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    )
      result[key] = String(item);
  }
  return result;
}

export function parseTaskMarkdown(
  path: string,
  source: string,
): ParsedTaskFile {
  const fileId = basename(path, ".md");
  const errors: string[] = [];
  const split = splitFrontmatter(source);
  errors.push(...split.errors);
  const parsed = parseSimpleYaml(split.frontmatter);
  errors.push(...parsed.errors);
  const raw = parsed.value;
  const declaredId = stringField(raw, "id");
  const id = declaredId ?? fileId;
  if (!isSafeTaskId(fileId)) errors.push(`Unsafe task filename ID: ${fileId}`);
  if (!isSafeTaskId(id)) errors.push(`Unsafe task ID: ${id}`);
  if (declaredId && declaredId !== fileId)
    errors.push(`Task id ${declaredId} must match filename ${fileId}.`);
  if (!split.body.trim()) errors.push("Task Markdown body is required.");
  const timeout = raw.timeoutMinutes;
  const task: TaskDefinition = {
    id,
    path,
    body: split.body,
    ...(stringField(raw, "description")
      ? { description: stringField(raw, "description") }
      : {}),
    enabled: booleanField(raw, "enabled"),
    ...(stringField(raw, "schedule")
      ? { schedule: stringField(raw, "schedule") }
      : {}),
    ...(stringField(raw, "cwd") ? { cwd: stringField(raw, "cwd") } : {}),
    ...(stringField(raw, "model") ? { model: stringField(raw, "model") } : {}),
    ...(stringField(raw, "thinking")
      ? { thinking: stringField(raw, "thinking") }
      : {}),
    ...(raw.tools !== undefined ? { tools: toolsField(raw) } : {}),
    ...(raw.envFiles !== undefined ? { envFiles: envFilesField(raw) } : {}),
    ...(raw.env !== undefined ? { env: envField(raw) } : {}),
    ...(typeof timeout === "number" ? { timeoutMinutes: timeout } : {}),
    handoff: booleanField(raw, "handoff"),
    rawFrontmatter: raw,
  };
  return { task: errors.length === 0 ? task : task, errors };
}

export async function readTaskFile(path: string): Promise<ParsedTaskFile> {
  try {
    return parseTaskMarkdown(path, await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { errors: [`Unable to read task file: ${message}`] };
  }
}

export async function listTaskFiles(rootDir: string): Promise<string[]> {
  const dir = getRootPaths(rootDir).tasks;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export async function readAllTasks(rootDir: string): Promise<ParsedTaskFile[]> {
  const paths = await listTaskFiles(rootDir);
  return Promise.all(paths.map((path) => readTaskFile(path)));
}
