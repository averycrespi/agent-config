import { spawn as _nodeSpawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream as _nodeCreateWriteStream,
} from "node:fs";
import { rm } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ScheduledTasksConfig } from "./config.ts";
import type { TaskDefinition } from "./task-file.ts";
import { effectiveTools } from "./validate.ts";

export const _spawn = { fn: _nodeSpawn };
export const _createWriteStream = { fn: _nodeCreateWriteStream };
export const _timers = { setTimeout, clearTimeout };

export const OUTPUT_TAIL_BYTES = 1024 * 1024;
const LINE_BUFFER_BYTES = 64 * 1024;
const KILL_ESCALATION_MS = 3_000;

export interface SpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface SpawnOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  sessionFile?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function shellExecCommand(command: string, args: string[]): string {
  return ["exec", shellQuote(command), ...args.map(shellQuote)].join(" ");
}

export function buildSpawnPlan(options: {
  config: ScheduledTasksConfig;
  task: TaskDefinition;
  runId: string;
  runDir: string;
  promptPath: string;
  envFileValues?: Record<string, string>;
}): SpawnPlan {
  const tools = effectiveTools(options.task, options.config);
  const args = [
    "--mode",
    "json",
    "--session-dir",
    `${options.config.rootDir}/sessions/${options.task.id}`,
    "--name",
    `scheduled: ${options.task.id} ${options.runId}`,
  ];
  if (options.task.model) args.push("--model", options.task.model);
  if (options.task.thinking) args.push("--thinking", options.task.thinking);
  if (tools.length > 0) args.push("--tools", tools.join(","));
  else args.push("--no-tools");
  args.push("-p", `@${options.promptPath}`);
  const command =
    options.task.executionShell === "bash-login"
      ? "bash"
      : options.config.piCommand;
  const spawnArgs =
    options.task.executionShell === "bash-login"
      ? ["--login", "-c", shellExecCommand(options.config.piCommand, args)]
      : args;
  const timeoutMinutes =
    options.task.timeoutMinutes ?? options.config.defaultTimeoutMinutes;
  return {
    command,
    args: spawnArgs,
    cwd: options.task.cwd ?? process.cwd(),
    env: {
      ...(options.envFileValues ?? {}),
      ...Object.fromEntries(
        Object.entries(options.task.env ?? {}).map(([key, value]) => [
          key,
          value,
        ]),
      ),
      SCHEDULED_TASKS_ROOT_DIR: options.config.rootDir,
      PI_SCHEDULED_TASK_RUN: "1",
      PI_SCHEDULED_TASK_ID: options.task.id,
      PI_SCHEDULED_TASK_RUN_ID: options.runId,
      PI_SCHEDULED_TASK_RUN_DIR: options.runDir,
    },
    timeoutMs: timeoutMinutes * 60_000,
  };
}

function extractSessionFileLine(line: string): string | undefined {
  try {
    const event = JSON.parse(line) as {
      type?: string;
      sessionFile?: unknown;
      session_file?: unknown;
    };
    const value = event.sessionFile ?? event.session_file;
    if (typeof value === "string") return value;
  } catch {
    // ignore non-json output
  }
  return undefined;
}

function appendTail(current: string, chunk: string): string {
  let combined = current + chunk;
  while (Buffer.byteLength(combined) > OUTPUT_TAIL_BYTES) {
    combined = combined.slice(Math.max(1, combined.length >> 1));
  }
  return combined;
}

function appendLineBuffer(current: string, chunk: string): string {
  let combined = current + chunk;
  while (Buffer.byteLength(combined) > LINE_BUFFER_BYTES) {
    combined = combined.slice(Math.max(1, combined.length >> 1));
  }
  return combined;
}

function writeWithBackpressure(
  stream: Writable,
  source: Readable | undefined,
  text: string,
): void {
  if (!stream.write(text) && source) {
    source.pause();
    stream.once("drain", () => source.resume());
  }
}

function endStream(stream: Writable): Promise<void> {
  return new Promise((resolve) => {
    stream.once("error", () => resolve());
    stream.end(resolve);
  });
}

function appendFileToStream(stream: Writable, path: string): Promise<void> {
  return new Promise((resolve) => {
    const input = createReadStream(path);
    input.on("error", () => resolve());
    input.on("end", () => resolve());
    input.pipe(stream, { end: false });
  });
}

export async function spawnPi(
  plan: SpawnPlan,
  logPath: string,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const child = _spawn.fn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let sessionFile: string | undefined;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let timedOut = false;
    let settled = false;
    let streamError: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const log = _createWriteStream.fn(logPath, { mode: 0o600 });
    const stderrPath = `${logPath}.stderr.tmp`;
    const stderrLog = _createWriteStream.fn(stderrPath, { mode: 0o600 });
    const handleStdoutText = (text: string) => {
      if (!text) return;
      writeWithBackpressure(log, child.stdout ?? undefined, text);
      stdout = appendTail(stdout, text);
      stdoutLineBuffer += text;
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = appendLineBuffer(lines.pop() ?? "", "");
      for (const line of lines) sessionFile ??= extractSessionFileLine(line);
    };
    const handleStderrText = (text: string) => {
      if (!text) return;
      writeWithBackpressure(stderrLog, child.stderr ?? undefined, text);
      stderr = appendTail(stderr, text);
    };
    const finish = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      _timers.clearTimeout(timer);
      if (killTimer) _timers.clearTimeout(killTimer);
      handleStdoutText(stdoutDecoder.end());
      handleStderrText(stderrDecoder.end());
      if (!sessionFile) sessionFile = extractSessionFileLine(stdoutLineBuffer);
      void (async () => {
        await endStream(stderrLog);
        log.write("\n\n## stderr\n");
        await appendFileToStream(log, stderrPath);
        await endStream(log);
        await rm(stderrPath, { force: true }).catch(() => undefined);
        resolve({
          ...outcome,
          stdout,
          stderr,
          timedOut,
          sessionFile,
          ...((outcome.error ?? streamError)
            ? { error: outcome.error ?? streamError }
            : {}),
        });
      })();
    };
    const timer = _timers.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = _timers.setTimeout(
        () => child.kill("SIGKILL"),
        KILL_ESCALATION_MS,
      );
    }, plan.timeoutMs);
    const failFromStream = (error: Error) => {
      if (settled || streamError) return;
      streamError = error.message;
      child.kill("SIGTERM");
      killTimer = _timers.setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          exitCode: null,
          signal: "SIGKILL",
          timedOut,
          stdout,
          stderr,
          error: error.message,
        });
      }, KILL_ESCALATION_MS);
    };
    log.once("error", failFromStream);
    stderrLog.once("error", failFromStream);
    log.write(`$ ${plan.command} ${plan.args.join(" ")}\n\n## stdout\n`);
    child.stdout?.on("data", (chunk) => {
      handleStdoutText(stdoutDecoder.write(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      handleStderrText(stderrDecoder.write(chunk));
    });
    child.on(
      "error",
      (error) =>
        void finish({
          exitCode: null,
          signal: null,
          timedOut,
          stdout,
          stderr,
          error: error.message,
        }),
    );
    child.on(
      "close",
      (code, signal) =>
        void finish({ exitCode: code, signal, timedOut, stdout, stderr }),
    );
  });
}
