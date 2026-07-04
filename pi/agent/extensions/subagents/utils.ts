import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const EXTENSION_FILE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

export function getAgentDir(): string {
  return expandHome(process.env.PI_CODING_AGENT_DIR ?? "~/.pi/agent");
}

export function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

export function resolvePath(baseDir: string, target: string): string {
  const expanded = expandHome(target);
  return expanded.startsWith("/") ? expanded : resolve(baseDir, expanded);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadSettingsExtensionRoots(agentDir: string): Promise<string[]> {
  const settingsFile = join(agentDir, "settings.json");
  if (!(await pathExists(settingsFile))) return [];

  try {
    const raw = await readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as { extensions?: unknown };
    if (!Array.isArray(parsed.extensions)) return [];

    return parsed.extensions
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      .map((value) => resolvePath(agentDir, value.trim()));
  } catch {
    return [];
  }
}

async function collectMatchesFromRoot(
  root: string,
  name: string,
): Promise<string[]> {
  const matches: string[] = [];
  if (!(await pathExists(root))) return matches;

  const rootBase = basename(root);

  if (rootBase === name) {
    matches.push(root);
    return matches;
  }

  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = (await readdir(root, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch {
    return matches;
  }

  for (const entry of entries) {
    const entryExtension = extname(entry.name).toLowerCase();
    const entryBaseName = entryExtension
      ? entry.name.slice(0, -entryExtension.length)
      : entry.name;
    if (entry.name !== name && entryBaseName !== name) continue;

    const candidate = join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(candidate);
      continue;
    }
    if (entry.isFile() && EXTENSION_FILE_EXTENSIONS.has(entryExtension)) {
      matches.push(candidate);
    }
  }

  return matches;
}

export async function resolveExtensionAllowlist(
  names: string[],
  cwd: string,
): Promise<string[]> {
  if (!names.length) return [];

  const agentDir = getAgentDir();
  const roots = [
    join(cwd, ".pi/extensions"),
    join(agentDir, "extensions"),
    ...(await loadSettingsExtensionRoots(agentDir)),
  ];

  const matches = new Set<string>();

  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;

    for (const root of roots) {
      for (const candidate of await collectMatchesFromRoot(root, trimmed)) {
        matches.add(candidate);
      }
    }
  }

  return [...matches];
}
