import { spawn as _nodeSpawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createManagedLogger } from "../_shared/logging.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import {
  MAX_SUBAGENT_DEPTH,
  type BuiltinTool,
  type InheritSession,
} from "./types.ts";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../structured-output/api.ts";
import { resolveExtensionAllowlist } from "./utils.ts";

export const PI_BINARY = "pi";
export const POST_AGENT_END_GRACE_MS = 5_000;
const STRUCTURED_OUTPUT_EXTENSION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../structured-output",
);

// Exported so tests can stub it without launching a real process.
export const _spawn = {
  fn: _nodeSpawn,
};

export const _timers = {
  setTimeout,
  clearTimeout,
};

export interface StructuredOutputSpec {
  schema: Record<string, unknown>;
}

export interface StructuredOutputResult {
  ok: boolean;
  value?: unknown;
  errors?: string[];
  raw?: string;
}

export interface SpawnInvocation {
  prompt: string;
  toolAllowlist: BuiltinTool[];
  extensionAllowlist: string[];
  files?: string[];
  model?: string;
  thinking?: string;
  systemPrompt?: string;
  inheritSession?: InheritSession;
  maxDepth?: number;
  parentSessionFile?: string;
  disableSkills?: boolean;
  disablePromptTemplates?: boolean;
  output?: StructuredOutputSpec;
  logId?: string;
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (event: unknown) => void;
}

export interface SpawnOutcome {
  ok: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
  logFile?: string;
  structured?: StructuredOutputResult;
}

function getCurrentDepth(): number {
  const raw = process.env.PI_SUBAGENT_DEPTH;
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function clampMaxDepth(value: number | undefined): number {
  const requested = value ?? 1;
  return Math.max(1, Math.min(requested, MAX_SUBAGENT_DEPTH));
}

function uniqueTools(tools: string[]): string[] {
  return [...new Set(tools)];
}

export function buildArgs(params: {
  prompt: string;
  tools: string[];
  extensions: string[];
  files: string[];
  model?: string;
  thinking?: string;
  systemPrompt?: string;
  inheritSession: InheritSession;
  parentSessionFile?: string;
  disableSkills?: boolean;
  disablePromptTemplates?: boolean;
}): string[] {
  const args: string[] = ["--mode", "json", "-p"];

  if (params.inheritSession === "fork") {
    if (!params.parentSessionFile) {
      throw new Error("inherit_session=fork requires a parent session file");
    }
    args.push("--fork", params.parentSessionFile);
  } else {
    args.push("--no-session");
  }

  if (params.model) args.push("--model", params.model);
  if (params.thinking) args.push("--thinking", params.thinking);

  if (params.tools.length > 0) {
    args.push("--tools", uniqueTools(params.tools).join(","));
  } else {
    args.push("--no-tools");
  }

  if (params.disableSkills) args.push("--no-skills");
  if (params.disablePromptTemplates) args.push("--no-prompt-templates");
  if (params.systemPrompt?.trim()) {
    args.push("--append-system-prompt", params.systemPrompt.trim());
  }

  args.push("--no-extensions");
  for (const extensionPath of params.extensions) {
    args.push("-e", extensionPath);
  }

  for (const file of params.files) {
    args.push(`@${file}`);
  }

  args.push(params.prompt);
  return args;
}

function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as { content?: unknown };
  if (typeof record.content === "string") return record.content.trim();
  if (!Array.isArray(record.content)) return "";

  const parts: string[] = [];
  for (const block of record.content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: unknown };
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("").trim();
}

interface StructuredCapture {
  captured: boolean;
  value?: unknown;
  raw?: string;
  errors?: string[];
}

function captureStructuredOutput(
  event: { type?: string; [key: string]: unknown },
  capture: StructuredCapture | undefined,
): void {
  if (!capture) return;
  if (
    event.type !== "tool_execution_end" ||
    event.toolName !== STRUCTURED_OUTPUT_TOOL_NAME
  ) {
    return;
  }

  capture.captured = true;
  capture.raw = JSON.stringify(event);
  if (event.isError === true) {
    capture.errors = [`${STRUCTURED_OUTPUT_TOOL_NAME} returned an error`];
    return;
  }

  const result = event.result;
  if (!result || typeof result !== "object") {
    capture.errors = [`${STRUCTURED_OUTPUT_TOOL_NAME} result was empty`];
    return;
  }
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object" || !("value" in details)) {
    capture.errors = [
      `${STRUCTURED_OUTPUT_TOOL_NAME} result omitted details.value`,
    ];
    return;
  }
  capture.value = (details as { value?: unknown }).value;
}

function reduceJsonLine(
  rawLine: string,
  onEvent: ((event: unknown) => void) | undefined,
  currentText: string,
  structuredCapture?: StructuredCapture,
): string {
  const line = rawLine.trim();
  if (!line) return currentText;

  try {
    const event = JSON.parse(line) as { type?: string; [key: string]: unknown };
    if (event.type !== "session") {
      onEvent?.(event);
    }
    captureStructuredOutput(event, structuredCapture);

    if (event.type === "message_end") {
      return extractTextFromMessage(event.message) || currentText;
    }

    if (event.type === "agent_end") {
      const messages = event.messages;
      if (Array.isArray(messages)) {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const message = messages[i] as { role?: unknown } | undefined;
          if (message?.role === "assistant") {
            const text = extractTextFromMessage(message);
            if (text) return text;
          }
        }
      }
    }
  } catch {
    // Ignore non-JSON noise and leave it to stderr / completion handling.
  }

  return currentText;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function schemaTypes(schema: Record<string, unknown>): string[] {
  const raw = schema.type;
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function validateJsonSchemaValue(
  schema: Record<string, unknown>,
  value: unknown,
  path = "/",
): string[] {
  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must match one of the allowed enum values`);
  }
  if ("const" in schema && value !== schema.const) {
    errors.push(`${path} must equal the schema const value`);
  }

  const types = schemaTypes(schema);
  if (types.length > 0) {
    const actual = valueType(value);
    const matches = types.some((type) =>
      type === "number"
        ? actual === "number" || actual === "integer"
        : type === actual,
    );
    if (!matches) {
      errors.push(`${path} must be ${types.join(" or ")}, got ${actual}`);
      return errors;
    }
  }

  if (
    schema.type === "object" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    for (const key of required) {
      if (!(key in record)) errors.push(`${path}${key} is required`);
    }

    const properties = schema.properties;
    if (
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (
          key in record &&
          propertySchema &&
          typeof propertySchema === "object"
        ) {
          errors.push(
            ...validateJsonSchemaValue(
              propertySchema as Record<string, unknown>,
              record[key],
              `${path}${key}/`,
            ),
          );
        }
      }
    }

    if (
      schema.additionalProperties === false &&
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(record)) {
        if (!allowed.has(key)) errors.push(`${path}${key} is not allowed`);
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    const itemSchema = schema.items;
    if (
      itemSchema &&
      typeof itemSchema === "object" &&
      !Array.isArray(itemSchema)
    ) {
      value.forEach((item, index) => {
        errors.push(
          ...validateJsonSchemaValue(
            itemSchema as Record<string, unknown>,
            item,
            `${path}${index}/`,
          ),
        );
      });
    }
  }

  return errors;
}

function validateStructuredOutput(
  output: StructuredOutputSpec,
  capture: StructuredCapture,
): StructuredOutputResult {
  if (!capture.captured) {
    return {
      ok: false,
      errors: [
        `structured output was requested but ${STRUCTURED_OUTPUT_TOOL_NAME} was not called`,
      ],
    };
  }
  if (capture.errors?.length) {
    return { ok: false, errors: capture.errors, raw: capture.raw };
  }

  const errors = validateJsonSchemaValue(output.schema, capture.value);
  if (errors.length === 0) return { ok: true, value: capture.value };
  return {
    ok: false,
    value: capture.value,
    errors,
    raw: capture.raw,
  };
}

function applyStructuredContract(
  outcome: SpawnOutcome,
  output: StructuredOutputSpec | undefined,
  capture: StructuredCapture | undefined,
): SpawnOutcome {
  if (!output || !capture || !outcome.ok) return outcome;

  const structured = validateStructuredOutput(output, capture);
  if (structured.ok) return { ...outcome, structured };

  return {
    ...outcome,
    ok: false,
    structured,
    errorMessage: `structured output validation failed: ${structured.errors?.join("; ") ?? "unknown error"}`,
  };
}

async function runSpawn(
  args: string[],
  cwd: string,
  logId: string,
  signal?: AbortSignal,
  onEvent?: (event: unknown) => void,
  extraEnv?: Record<string, string>,
  output?: StructuredOutputSpec,
): Promise<SpawnOutcome> {
  const log = createManagedLogger({ extensionName: "subagents", id: logId });
  log.write(
    `$ pi ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n\n`,
  );

  return await new Promise<SpawnOutcome>((resolve) => {
    let finished = false;
    let aborted = Boolean(signal?.aborted);
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finalText = "";
    const structuredCapture: StructuredCapture | undefined = output
      ? { captured: false }
      : undefined;
    let sawAgentEnd = false;
    let child: ReturnType<typeof _nodeSpawn> | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let postAgentEndTimer: NodeJS.Timeout | undefined;

    const finish = (outcome: SpawnOutcome) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      if (killTimer) _timers.clearTimeout(killTimer);
      if (postAgentEndTimer) _timers.clearTimeout(postAgentEndTimer);
      void log.close().then(() => {
        if (outcome.ok) {
          log.delete();
        } else {
          outcome.logFile = log.path;
        }
        resolve(outcome);
      });
    };

    const startKillSequence = () => {
      child?.kill("SIGTERM");
      killTimer = _timers.setTimeout(() => {
        child?.kill("SIGKILL");
      }, 2_000);
    };

    const onAbort = () => {
      aborted = true;
      startKillSequence();
    };

    const onChildEvent = (event: unknown) => {
      if (event && typeof event === "object") {
        const record = event as { type?: string };
        if (record.type === "agent_end" && !sawAgentEnd) {
          sawAgentEnd = true;
          postAgentEndTimer = _timers.setTimeout(() => {
            startKillSequence();
            finish(
              applyStructuredContract(
                {
                  ok: true,
                  aborted: false,
                  stdout: finalText,
                  stderr: stderrBuffer,
                  exitCode: 0,
                  signal: null,
                },
                output,
                structuredCapture,
              ),
            );
          }, POST_AGENT_END_GRACE_MS);
        }
      }
      onEvent?.(event);
    };

    if (signal?.aborted) {
      return finish({
        ok: false,
        aborted: true,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        errorMessage: "aborted before spawn",
      });
    }

    child = _spawn.fn(PI_BINARY, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
        PI_SUBAGENT_DEPTH: String(getCurrentDepth() + 1),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child?.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        aborted,
        stdout: finalText,
        stderr: stderrBuffer,
        exitCode: null,
        signal: null,
        errorMessage: error.message,
      });
    });

    child?.stdout?.setEncoding("utf8");
    child?.stdout?.on("data", (chunk: string) => {
      log.write(chunk);
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        finalText = reduceJsonLine(
          rawLine,
          onChildEvent,
          finalText,
          structuredCapture,
        );
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child?.stderr?.setEncoding("utf8");
    let stderrLineBuffer = "";
    child?.stderr?.on("data", (chunk: string) => {
      log.write(`[stderr] ${chunk}`);
      stderrBuffer += chunk;
      stderrLineBuffer += chunk;
      let newlineIndex = stderrLineBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stderrLineBuffer.slice(0, newlineIndex).trim();
        stderrLineBuffer = stderrLineBuffer.slice(newlineIndex + 1);
        if (line) onChildEvent({ type: "stderr", text: line });
        newlineIndex = stderrLineBuffer.indexOf("\n");
      }
    });

    child?.on("close", (code, sig) => {
      if (stdoutBuffer.trim()) {
        finalText = reduceJsonLine(
          stdoutBuffer,
          onChildEvent,
          finalText,
          structuredCapture,
        );
        stdoutBuffer = "";
      }

      const ok = code === 0 && !aborted;
      finish(
        applyStructuredContract(
          {
            ok,
            aborted,
            stdout: finalText,
            stderr: stderrBuffer,
            exitCode: code,
            signal: sig,
            errorMessage: ok
              ? undefined
              : `subagent exited with code ${code ?? "unknown"}`,
          },
          output,
          structuredCapture,
        ),
      );
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function createStructuredOutputSchemaFile(
  output: StructuredOutputSpec,
): Promise<{ dir: string; schemaFile: string }> {
  const dir = await mkdtemp(join(tmpdir(), "subagent-structured-output-"));
  const schemaFile = join(dir, "schema.json");
  await writeFile(schemaFile, JSON.stringify(output.schema, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return { dir, schemaFile };
}

function appendStructuredOutputPrompt(
  systemPrompt: string | undefined,
  output: StructuredOutputSpec | undefined,
): string | undefined {
  if (!output) return systemPrompt;
  const instructions = [
    "## Structured subagent output",
    `When the task is complete, call the ${STRUCTURED_OUTPUT_TOOL_NAME} tool as your final action.`,
    "Its parameters are schema-validated and will be consumed by the parent workflow.",
    "Do not include the structured value only in prose; the tool call is required.",
  ];
  return [systemPrompt?.trim(), instructions.join("\n")]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export async function spawnSubagent(
  options: SpawnInvocation,
): Promise<SpawnOutcome> {
  const maxDepth = clampMaxDepth(options.maxDepth);
  const currentDepth = getCurrentDepth();

  if (currentDepth >= maxDepth) {
    return {
      ok: false,
      aborted: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      errorMessage: `subagent depth limit exceeded (max ${maxDepth})`,
    };
  }

  const effectiveSession = options.inheritSession ?? "none";
  const extensions = await resolveExtensionAllowlist(
    options.extensionAllowlist,
    options.cwd,
  );

  if (options.extensionAllowlist.length > 0 && extensions.length === 0) {
    return {
      ok: false,
      aborted: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      errorMessage: `no matching extensions found for: ${options.extensionAllowlist.join(", ")}`,
    };
  }

  let structuredSchema: { dir: string; schemaFile: string } | undefined;
  if (options.output) {
    try {
      structuredSchema = await createStructuredOutputSchemaFile(options.output);
    } catch (error: any) {
      return {
        ok: false,
        aborted: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        errorMessage: error?.message ?? String(error),
      };
    }
  }

  let args: string[];
  try {
    args = buildArgs({
      prompt: options.prompt,
      tools: structuredSchema
        ? [...options.toolAllowlist, STRUCTURED_OUTPUT_TOOL_NAME]
        : options.toolAllowlist,
      extensions: structuredSchema
        ? [...extensions, STRUCTURED_OUTPUT_EXTENSION_PATH]
        : extensions,
      files: options.files ?? [],
      model: options.model,
      thinking: options.thinking,
      systemPrompt: appendStructuredOutputPrompt(
        options.systemPrompt,
        options.output,
      ),
      inheritSession: effectiveSession,
      parentSessionFile: options.parentSessionFile,
      disableSkills: options.disableSkills,
      disablePromptTemplates: options.disablePromptTemplates,
    });
  } catch (error: any) {
    if (structuredSchema) {
      await rm(structuredSchema.dir, { recursive: true, force: true });
    }
    return {
      ok: false,
      aborted: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      errorMessage: error?.message ?? String(error),
    };
  }

  const logId = options.logId ?? "subagent";
  const outcome = await runSpawn(
    args,
    options.cwd,
    logId,
    options.signal,
    options.onEvent,
    structuredSchema
      ? {
          ...options.env,
          PI_STRUCTURED_OUTPUT_SCHEMA_FILE: structuredSchema.schemaFile,
          PI_STRUCTURED_OUTPUT_TERMINATE: "1",
        }
      : options.env,
    options.output,
  );
  if (structuredSchema) {
    await rm(structuredSchema.dir, { recursive: true, force: true });
  }

  for (const key of ["stdout", "stderr"] as const) {
    const spilled = await spillIfNeeded(
      [{ type: "text", text: outcome[key] }],
      `${logId}-${key}`,
    );
    const text = spilled.content.find(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )?.text;
    if (spilled.spilled && text) outcome[key] = text;
  }

  return outcome;
}

export function formatSpawnFailure(outcome: SpawnOutcome): string {
  const logSuffix = outcome.logFile ? `\nLog: ${outcome.logFile}` : "";

  if (outcome.aborted) return `Error: subagent aborted${logSuffix}`;

  const lines = [`Error: ${outcome.errorMessage ?? "subagent failed"}`];
  if (outcome.exitCode != null) lines.push(`Exit code: ${outcome.exitCode}`);
  if (outcome.stderr.trim()) lines.push("stderr:", outcome.stderr.trimEnd());
  if (outcome.stdout.trim()) lines.push("stdout:", outcome.stdout.trimEnd());
  if (outcome.logFile) lines.push(`Log: ${outcome.logFile}`);
  return lines.join("\n");
}
