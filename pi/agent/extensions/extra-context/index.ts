import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  readPiSettingsFiles,
  registerConfigCommand,
} from "../_shared/config.ts";

type PlainObject = Record<string, unknown>;

type MissingFileBehavior = "warn" | "ignore" | "error";

export type ExtraContextConfig = {
  enabled: boolean;
  files: string[];
  missingFileBehavior: MissingFileBehavior;
};

type LoadedContextFile = {
  path: string;
  content: string;
};

type Diagnostic = {
  message: string;
  level: "warning" | "error";
};

type LoadConfigResult = {
  config: ExtraContextConfig;
  warnings: string[];
};

type ExtraContextExtensionOptions = {
  loadConfig?: (cwd: string) => Promise<LoadConfigResult> | LoadConfigResult;
};

const DEFAULT_CONFIG: ExtraContextConfig = {
  enabled: true,
  files: [],
  missingFileBehavior: "warn",
};

function parseFiles(
  value: unknown,
  field: string,
  warnings: string[],
): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (Array.isArray(value)) {
    const files: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        files.push(entry.trim());
      } else {
        warnings.push(`Ignoring invalid ${field} entry: ${String(entry)}`);
      }
    }
    return files;
  }
  warnings.push(`Ignoring invalid ${field}: expected string or string[]`);
  return [];
}

function parseMissingFileBehavior(
  value: unknown,
  warnings: string[],
): MissingFileBehavior {
  if (value === undefined) return DEFAULT_CONFIG.missingFileBehavior;
  if (value === "warn" || value === "ignore" || value === "error") {
    return value;
  }
  warnings.push(`Ignoring invalid missingFileBehavior: ${String(value)}`);
  return DEFAULT_CONFIG.missingFileBehavior;
}

function readEnvSettings(
  env: NodeJS.ProcessEnv,
  warnings: string[],
): PlainObject {
  const enabled = parseBooleanEnv(
    env.EXTRA_CONTEXT_ENABLED,
    "EXTRA_CONTEXT_ENABLED",
    warnings,
  );
  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(env.EXTRA_CONTEXT_FILES !== undefined
      ? { files: env.EXTRA_CONTEXT_FILES }
      : {}),
    ...(env.EXTRA_CONTEXT_MISSING_FILE_BEHAVIOR !== undefined
      ? { missingFileBehavior: env.EXTRA_CONTEXT_MISSING_FILE_BEHAVIOR }
      : {}),
  };
}

export function parseExtraContextConfig(options: {
  settings?: PlainObject;
  env?: NodeJS.ProcessEnv;
  warnings?: string[];
}): ExtraContextConfig {
  const warnings = options.warnings ?? [];
  const merged = mergeExtensionConfig({
    defaults: DEFAULT_CONFIG,
    projectSettings: options.settings,
    envSettings: readEnvSettings(options.env ?? process.env, warnings),
  });

  return {
    enabled:
      typeof merged.enabled === "boolean"
        ? merged.enabled
        : DEFAULT_CONFIG.enabled,
    files: parseFiles(merged.files, "files", warnings),
    missingFileBehavior: parseMissingFileBehavior(
      merged.missingFileBehavior,
      warnings,
    ),
  };
}

export async function loadExtraContextConfig(
  cwd: string,
): Promise<LoadConfigResult> {
  const warnings: string[] = [];
  const { globalSettings, projectSettings } = await readPiSettingsFiles({
    agentDir: getAgentDir(),
    cwd,
    warnings,
  });
  const settings = mergeExtensionConfig({
    defaults: {},
    globalSettings: readExtensionSettings(globalSettings, "extra-context"),
    projectSettings: readExtensionSettings(projectSettings, "extra-context"),
  });
  return {
    config: parseExtraContextConfig({ settings, warnings }),
    warnings,
  };
}

export function resolveContextPath(path: string, cwd: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  return resolve(cwd, path);
}

async function loadConfiguredFiles(
  config: ExtraContextConfig,
  cwd: string,
): Promise<{ files: LoadedContextFile[]; diagnostics: Diagnostic[] }> {
  if (!config.enabled || config.files.length === 0) {
    return { files: [], diagnostics: [] };
  }

  const files: LoadedContextFile[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const configuredPath of config.files) {
    const resolvedPath = resolveContextPath(configuredPath, cwd);
    if (seen.has(resolvedPath)) continue;
    seen.add(resolvedPath);
    try {
      files.push({
        path: resolvedPath,
        content: await readFile(resolvedPath, "utf8"),
      });
    } catch (error) {
      if (config.missingFileBehavior === "ignore") continue;
      const message =
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? `Extra context file not found: ${resolvedPath}`
          : `Could not read extra context file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`;
      diagnostics.push({
        message,
        level: config.missingFileBehavior === "error" ? "error" : "warning",
      });
    }
  }
  return { files, diagnostics };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildExtraContextPrompt(
  files: LoadedContextFile[],
): string | undefined {
  if (files.length === 0) return undefined;
  const sections = files.map(
    (file) =>
      `<extra_context_file path="${escapeAttribute(file.path)}">\n${file.content}\n</extra_context_file>`,
  );
  return [
    "<extra_context>",
    "Additional user-configured context files:",
    "",
    ...sections,
    "</extra_context>",
  ].join("\n");
}

function formatStatus(
  files: LoadedContextFile[],
  diagnostics: Diagnostic[],
): string {
  const lines = [`extra-context loaded files: ${files.length}`];
  for (const file of files) {
    lines.push(`- ${file.path} (${file.content.length} chars)`);
  }
  if (diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of diagnostics) {
      lines.push(`- ${diagnostic.level}: ${diagnostic.message}`);
    }
  }
  return lines.join("\n");
}

export function createExtraContextExtension(
  options: ExtraContextExtensionOptions = {},
) {
  const loadConfig = options.loadConfig ?? loadExtraContextConfig;

  return function extraContextExtension(pi: ExtensionAPI) {
    let files: LoadedContextFile[] = [];
    let diagnostics: Diagnostic[] = [];

    registerConfigCommand(pi, {
      extensionName: "extra-context",
      loadConfig: async (cwd, warnings) => {
        const loaded = await loadConfig(cwd);
        warnings?.push(...loaded.warnings);
        return loaded.config;
      },
    });

    pi.registerCommand("extra-context-status", {
      description: "Show loaded extra context files without printing contents.",
      handler: async (_args, ctx) => {
        ctx.ui.notify(formatStatus(files, diagnostics), "info");
      },
    });

    async function reload(ctx: ExtensionContext): Promise<void> {
      const loaded = await loadConfig(ctx.cwd);
      const result = await loadConfiguredFiles(loaded.config, ctx.cwd);
      files = result.files;
      diagnostics = result.diagnostics;
      for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");
      for (const diagnostic of diagnostics) {
        ctx.ui.notify(diagnostic.message, diagnostic.level);
      }
    }

    pi.on("session_start", async (_event, ctx) => {
      await reload(ctx);
    });

    pi.on("before_agent_start", async (event: { systemPrompt: string }) => {
      const prompt = buildExtraContextPrompt(files);
      if (!prompt) return undefined;
      return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
    });
  };
}

export default createExtraContextExtension();
