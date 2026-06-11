import { spawn as _nodeSpawn } from "node:child_process";
import { createManagedLogger } from "../_shared/logging.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import {
  MAX_SUBAGENT_DEPTH,
  type BuiltinTool,
  type InheritSession,
} from "./types.ts";
import { resolveExtensionAllowlist } from "./utils.ts";

export const PI_BINARY = "pi";
export const POST_AGENT_END_GRACE_MS = 5_000;

// Exported so tests can stub it without launching a real process.
export const _spawn = {
  fn: _nodeSpawn,
};

export const _timers = {
  setTimeout,
  clearTimeout,
};

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

function uniqueTools(tools: BuiltinTool[]): BuiltinTool[] {
  return [...new Set(tools)];
}

export function buildArgs(params: {
  prompt: string;
  tools: BuiltinTool[];
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

function reduceJsonLine(
  rawLine: string,
  onEvent: ((event: unknown) => void) | undefined,
  currentText: string,
): string {
  const line = rawLine.trim();
  if (!line) return currentText;

  try {
    const event = JSON.parse(line) as { type?: string; [key: string]: unknown };
    if (event.type !== "session") {
      onEvent?.(event);
    }

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

async function runSpawn(
  args: string[],
  cwd: string,
  logId: string,
  signal?: AbortSignal,
  onEvent?: (event: unknown) => void,
  extraEnv?: Record<string, string>,
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
            finish({
              ok: true,
              aborted: false,
              stdout: finalText,
              stderr: stderrBuffer,
              exitCode: 0,
              signal: null,
            });
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
        finalText = reduceJsonLine(rawLine, onChildEvent, finalText);
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
        finalText = reduceJsonLine(stdoutBuffer, onChildEvent, finalText);
        stdoutBuffer = "";
      }

      const ok = code === 0 && !aborted;
      finish({
        ok,
        aborted,
        stdout: finalText,
        stderr: stderrBuffer,
        exitCode: code,
        signal: sig,
        errorMessage: ok
          ? undefined
          : `subagent exited with code ${code ?? "unknown"}`,
      });
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

  let args: string[];
  try {
    args = buildArgs({
      prompt: options.prompt,
      tools: options.toolAllowlist,
      extensions,
      files: options.files ?? [],
      model: options.model,
      thinking: options.thinking,
      systemPrompt: options.systemPrompt,
      inheritSession: effectiveSession,
      parentSessionFile: options.parentSessionFile,
      disableSkills: options.disableSkills,
      disablePromptTemplates: options.disablePromptTemplates,
    });
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

  const logId = options.logId ?? "subagent";
  const outcome = await runSpawn(
    args,
    options.cwd,
    logId,
    options.signal,
    options.onEvent,
    options.env,
  );

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
