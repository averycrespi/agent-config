#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir, hostname } from "node:os";

const SUBDIRS = ["tasks", "handoffs", "state", "sessions", "runs", "locks"];
const DUE_GRACE_SECONDS = 90;
const HELP = `pi-task-scheduler

Usage:
  pi-task-scheduler.mjs --help
  pi-task-scheduler.mjs tick [--dry-run]

Runs one conservative scheduled-tasks scheduler tick using SCHEDULED_TASKS_ROOT_DIR.`;

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function rootDir() {
  return resolve(
    expandHome(process.env.SCHEDULED_TASKS_ROOT_DIR || "~/.pi/scheduled-tasks"),
  );
}

function config(root) {
  return {
    rootDir: root,
    defaultTimeoutMinutes: Number(
      process.env.SCHEDULED_TASKS_DEFAULT_TIMEOUT_MINUTES || 30,
    ),
    defaultTools: process.env.SCHEDULED_TASKS_DEFAULT_TOOLS
      ? process.env.SCHEDULED_TASKS_DEFAULT_TOOLS.split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : ["read", "grep", "find", "ls"],
    piCommand: process.env.SCHEDULED_TASKS_PI_COMMAND || "pi",
  };
}

async function ensureRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const subdir of SUBDIRS) {
    await mkdir(join(root, subdir), { recursive: true, mode: 0o700 });
  }
}

async function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

async function acquireLock(root, name, extra = {}) {
  const path = join(root, "locks", `${name}.lock`);
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify(
        {
          name,
          pid: process.pid,
          hostname: hostname(),
          startedAt: new Date().toISOString(),
          ...extra,
        },
        null,
        2,
      )}\n`,
    );
    await handle.close();
    return async () => {
      await rm(path).catch(() => {});
    };
  } catch {
    return undefined;
  }
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^['"]|['"]$/g, "");
}

function parseYaml(source) {
  const value = {};
  let current;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const list = line.match(/^\s+-\s+(.*)$/);
    if (list && current) {
      value[current] = Array.isArray(value[current]) ? value[current] : [];
      value[current].push(String(parseScalar(list[1])));
      continue;
    }
    const nested = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && current) {
      value[current] =
        typeof value[current] === "object" && !Array.isArray(value[current])
          ? value[current]
          : {};
      value[current][nested[1]] = String(parseScalar(nested[2] || ""));
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    current = match[1];
    value[current] = match[2].trim() === "" ? [] : parseScalar(match[2]);
  }
  return value;
}

function parseTask(path, source) {
  if (!source.startsWith("---\n")) return { errors: ["Missing frontmatter."] };
  const end = source.indexOf("\n---", 4);
  if (end < 0) return { errors: ["Unclosed frontmatter."] };
  const raw = parseYaml(source.slice(4, end));
  const fileId = basename(path, ".md");
  const id = raw.id || fileId;
  const body = source.slice(end + 4).trim();
  const errors = [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) || id !== fileId) {
    errors.push("Unsafe or mismatched task ID.");
  }
  if (!body) errors.push("Task body is required.");
  const task = {
    id,
    path,
    body,
    enabled: raw.enabled === true,
    schedule: typeof raw.schedule === "string" ? raw.schedule : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    thinking: typeof raw.thinking === "string" ? raw.thinking : undefined,
    tools: Array.isArray(raw.tools) ? raw.tools : undefined,
    env:
      raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? raw.env
        : undefined,
    timeoutMinutes:
      typeof raw.timeoutMinutes === "number" ? raw.timeoutMinutes : undefined,
    handoff: raw.handoff === true,
  };
  return { task, errors };
}

function parseField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return undefined;
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      [start, end] = rangePart.split("-").map(Number);
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
    if (start < min || end > max || start > end) return undefined;
    for (let value = start; value <= end; value += step) {
      values.add(max === 7 && value === 7 ? 0 : value);
    }
  }
  return values;
}

function parseCron(expr) {
  if (typeof expr !== "string") return undefined;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const parsed = parts.map((part, index) =>
    parseField(part, ranges[index][0], ranges[index][1]),
  );
  if (parsed.some((item) => item === undefined)) return undefined;
  return parsed;
}

function cronMatches(cron, date) {
  return (
    cron[0].has(date.getUTCMinutes()) &&
    cron[1].has(date.getUTCHours()) &&
    cron[2].has(date.getUTCDate()) &&
    cron[3].has(date.getUTCMonth() + 1) &&
    cron[4].has(date.getUTCDay())
  );
}

function nextFutureRun(expression, after) {
  const cron = parseCron(expression);
  if (!cron) return undefined;
  const candidate = new Date(after.getTime() + 60_000);
  candidate.setUTCSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (cronMatches(cron, candidate)) return new Date(candidate);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return undefined;
}

function decideDue(schedule, nextRunAt, now) {
  const current = nextRunAt ? new Date(nextRunAt) : undefined;
  if (!current || Number.isNaN(current.getTime())) {
    const next = nextFutureRun(schedule, now);
    return next
      ? { action: "initialize", nextRunAt: next }
      : { action: "wait" };
  }
  if (current.getTime() > now.getTime()) return { action: "wait" };
  const next = nextFutureRun(schedule, now);
  if (!next) return { action: "wait" };
  if (now.getTime() - current.getTime() <= DUE_GRACE_SECONDS * 1000) {
    return { action: "run", nextRunAt: next };
  }
  return { action: "missed", nextRunAt: next };
}

async function readState(root, taskId) {
  try {
    return JSON.parse(
      await readFile(join(root, "state", `${taskId}.json`), "utf8"),
    );
  } catch {
    return undefined;
  }
}

async function validForRun(task) {
  if (!task.enabled) return ["Task is disabled."];
  const errors = [];
  if (!task.schedule || !parseCron(task.schedule))
    errors.push("Invalid schedule.");
  if (!task.cwd || !task.cwd.startsWith("/"))
    errors.push("cwd must be absolute.");
  else {
    try {
      if (!(await stat(task.cwd)).isDirectory())
        errors.push("cwd must be a directory.");
    } catch {
      errors.push("cwd must exist.");
    }
  }
  return errors;
}

function runId(now = new Date()) {
  return `${now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
}

async function renderPrompt(root, task, id) {
  let handoff = "";
  if (task.handoff) {
    handoff = await readFile(
      join(root, "handoffs", `${task.id}.md`),
      "utf8",
    ).catch(() => "");
  }
  return [
    "# Scheduled task run",
    "",
    `Task ID: ${task.id}`,
    `Run ID: ${id}`,
    "",
    "You are running as a scheduled Pi task.",
    "",
    "Rules:",
    "",
    "- Do the task described below.",
    "- Your final response should summarize what you did and any issues.",
    task.handoff
      ? "- If a `Previous handoff` section is present, use it as prior context and update the handoff at the end of meaningful work using `scheduled_task_handoff`."
      : undefined,
    handoff.trim() ? "" : undefined,
    handoff.trim() ? "## Previous handoff" : undefined,
    handoff.trim() ? "" : undefined,
    handoff.trim() || undefined,
    "",
    "## Task",
    "",
    task.body,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function effectiveTools(task, cfg) {
  const tools = [
    ...new Set(task.tools === undefined ? cfg.defaultTools : task.tools),
  ];
  if (task.handoff && !tools.includes("scheduled_task_handoff")) {
    tools.push("scheduled_task_handoff");
  }
  return tools.filter(Boolean);
}

async function spawnPi(root, cfg, task, id, dir) {
  const promptPath = join(dir, "prompt.md");
  await writeFile(promptPath, await renderPrompt(root, task, id), {
    mode: 0o600,
  });
  const tools = effectiveTools(task, cfg);
  const args = [
    "--mode",
    "json",
    "--session-dir",
    join(root, "sessions", task.id),
    "--name",
    `scheduled: ${task.id} ${id}`,
  ];
  if (task.model) args.push("--model", task.model);
  if (task.thinking) args.push("--thinking", task.thinking);
  if (tools.length) args.push("--tools", tools.join(","));
  else args.push("--no-tools");
  args.push("-p", `@${promptPath}`);
  const startedAt = new Date().toISOString();
  const timeoutMs = (task.timeoutMinutes || cfg.defaultTimeoutMinutes) * 60_000;
  const env = {
    ...process.env,
    ...(task.env || {}),
    SCHEDULED_TASKS_ROOT_DIR: root,
    PI_SCHEDULED_TASK_RUN: "1",
    PI_SCHEDULED_TASK_ID: task.id,
    PI_SCHEDULED_TASK_RUN_ID: id,
    PI_SCHEDULED_TASK_RUN_DIR: dir,
  };
  const outcome = await new Promise((resolveOutcome) => {
    const child = spawn(cfg.piCommand, args, {
      cwd: task.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveOutcome({
        stdout,
        stderr,
        timedOut,
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveOutcome({ stdout, stderr, timedOut, exitCode, signal });
    });
  });
  await writeFile(
    join(dir, "output.md"),
    outcome.stdout || outcome.stderr || "",
    {
      mode: 0o600,
    },
  );
  await writeFile(
    join(dir, "pi.log"),
    [
      `$ ${cfg.piCommand} ${args.join(" ")}`,
      "",
      "## stdout",
      outcome.stdout,
      "",
      "## stderr",
      outcome.stderr,
    ].join("\n"),
    { mode: 0o600 },
  );
  const handoffUpdated =
    (
      await readFile(join(dir, "handoff-updated"), "utf8").catch(() => "")
    ).trim() === "1";
  const status = outcome.timedOut
    ? "timeout"
    : outcome.exitCode === 0
      ? "success"
      : "failed";
  const result = {
    taskId: task.id,
    runId: id,
    status,
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    handoffUpdated,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
  await writeJsonAtomic(join(dir, "result.json"), result);
  return result;
}

async function runTask(root, cfg, task, now) {
  const id = runId(now);
  const release = await acquireLock(root, task.id, {
    taskId: task.id,
    runId: id,
  });
  if (!release) return { taskId: task.id, status: "locked" };
  try {
    const dir = join(root, "runs", task.id, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const result = await spawnPi(root, cfg, task, id, dir);
    const prior = (await readState(root, task.id)) || { taskId: task.id };
    await writeJsonAtomic(join(root, "state", `${task.id}.json`), {
      ...prior,
      lastRunAt: result.startedAt,
      lastStatus: result.status,
      lastRunId: id,
      lastSkipReason: null,
    });
    return { taskId: task.id, runId: id, status: result.status, runDir: dir };
  } finally {
    await release();
  }
}

async function tick({ dryRun }) {
  const root = rootDir();
  const cfg = config(root);
  await ensureRoot(root);
  const release = await acquireLock(root, "scheduler");
  if (!release) {
    return {
      dryRun,
      claimed: [],
      skipped: [{ taskId: "scheduler", status: "locked" }],
    };
  }
  const now = new Date();
  const toRun = [];
  const skipped = [];
  try {
    const files = await readdir(join(root, "tasks")).catch(() => []);
    for (const file of files.filter((name) => name.endsWith(".md")).sort()) {
      const parsed = parseTask(
        join(root, "tasks", file),
        await readFile(join(root, "tasks", file), "utf8"),
      );
      if (!parsed.task) continue;
      const task = parsed.task;
      const errors = [...parsed.errors, ...(await validForRun(task))];
      if (errors.length) {
        if (task.enabled)
          skipped.push({
            taskId: task.id,
            status: "validation_failed",
            errors,
          });
        continue;
      }
      const state = await readState(root, task.id);
      const decision = decideDue(task.schedule, state?.nextRunAt, now);
      if (decision.action === "initialize") {
        await writeJsonAtomic(join(root, "state", `${task.id}.json`), {
          ...(state || { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: null,
        });
        skipped.push({ taskId: task.id, status: "initialized" });
      } else if (decision.action === "missed") {
        await writeJsonAtomic(join(root, "state", `${task.id}.json`), {
          ...(state || { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: "missed_schedule",
        });
        skipped.push({ taskId: task.id, status: "missed" });
      } else if (decision.action === "run") {
        await writeJsonAtomic(join(root, "state", `${task.id}.json`), {
          ...(state || { taskId: task.id }),
          nextRunAt: decision.nextRunAt.toISOString(),
          lastSkipReason: null,
        });
        toRun.push(task);
      }
    }
  } finally {
    await release();
  }
  if (dryRun) {
    return {
      dryRun,
      claimed: toRun.map((task) => ({ taskId: task.id, status: "due" })),
      skipped,
    };
  }
  const claimed = [];
  for (const task of toRun) claimed.push(await runTask(root, cfg, task, now));
  return { dryRun, claimed, skipped };
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log(HELP);
  process.exit(0);
}
if (args[0] === "tick") {
  const result = await tick({ dryRun: args.includes("--dry-run") });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
console.error(HELP);
process.exit(2);
