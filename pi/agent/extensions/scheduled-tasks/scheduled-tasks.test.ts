import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type { SpawnOptions } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import scheduledTasksExtension from "./index.ts";
import { registerScheduledTaskCommands, _execFile } from "./commands.ts";
import {
  loadScheduledTasksConfigFromSettings,
  mergeCronEnvironment,
  normalizeConfig,
} from "./config.ts";
import {
  buildCronBlock,
  installManagedBlock,
  shellQuote,
  uninstallManagedBlock,
} from "./cron.ts";
import { acquireLock } from "./locks.ts";
import {
  ensureRootLayout,
  isInside,
  isSafeTaskId,
  runDir,
  tickLogPath,
} from "./paths.ts";
import { renderPrompt } from "./prompt.ts";
import {
  cronMatches,
  decideDue,
  nextFutureRun,
  parseCron,
} from "./schedule.ts";
import { readLatestLogs, schedulerTick } from "./scheduler.ts";
import {
  buildSpawnPlan,
  spawnPi,
  OUTPUT_TAIL_BYTES,
  _createWriteStream,
  _spawn,
} from "./spawn.ts";
import { readTaskState, writeTaskState } from "./state.ts";
import { registerHandoffTool, registerScheduledTasksTool } from "./tools.ts";
import { parseTaskMarkdown } from "./task-file.ts";
import { effectiveTools, validateTask } from "./validate.ts";

type StubChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal: string) => boolean;
};

type BackpressureStream = Writable & {
  writes: string[];
  drainCount: number;
};

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scheduled-tasks-test-"));
  await ensureRootLayout(root);
  return root;
}

function sampleTask(path: string, cwd: string, extra = ""): string {
  return `---\nid: ${path}\ndescription: Test task\nenabled: true\nschedule: "* * * * *"\ncwd: ${cwd}\ntools:\n  - read\ntimeoutMinutes: 1\n${extra}---\nDo the work.\n`;
}

test("config normalization supports env-shaped values and defaults", () => {
  const warnings: string[] = [];
  const config = normalizeConfig(
    {
      rootDir: "~/tasks",
      defaultTimeoutMinutes: "5",
      defaultTools: "read,bash",
      piCommand: "/bin/pi",
      cronEnvironment: {
        PATH: "/opt/bin:/usr/bin",
        ASDF_DATA_DIR: "/Users/test/.asdf",
      },
    },
    warnings,
  );
  assert.equal(config.defaultTimeoutMinutes, 5);
  assert.deepEqual(config.defaultTools, ["read", "bash"]);
  assert.equal(config.piCommand, "/bin/pi");
  assert.deepEqual(config.cronEnvironment, {
    PATH: "/opt/bin:/usr/bin",
    ASDF_DATA_DIR: "/Users/test/.asdf",
  });
  assert.equal(warnings.length, 0);
});

test("extension contributes management skill only outside scheduled child runs", async () => {
  const registrations = {
    commands: [] as string[],
    tools: [] as string[],
    events: new Map<string, (...args: any[]) => any>(),
  };
  const pi = {
    registerCommand(name: string) {
      registrations.commands.push(name);
    },
    registerTool(tool: { name: string }) {
      registrations.tools.push(tool.name);
    },
    on(name: string, handler: (...args: any[]) => any) {
      registrations.events.set(name, handler);
    },
  };
  const previousEnv = { ...process.env };
  try {
    delete process.env.PI_SCHEDULED_TASK_RUN;
    scheduledTasksExtension(pi as any);
    const discovered = registrations.events.get("resources_discover")?.({
      cwd: process.cwd(),
      reason: "startup",
    });

    assert.deepEqual(registrations.tools, ["scheduled_tasks"]);
    assert.equal(discovered?.skillPaths.length, 1);
    assert.match(
      discovered.skillPaths[0],
      /scheduled-tasks\/skills\/manage-scheduled-tasks\/SKILL\.md$/,
    );
  } finally {
    process.env = previousEnv;
  }

  const childRegistrations = {
    tools: [] as string[],
    events: new Map<string, (...args: any[]) => any>(),
  };
  const childPi = {
    registerCommand() {},
    registerTool(tool: { name: string }) {
      childRegistrations.tools.push(tool.name);
    },
    on(name: string, handler: (...args: any[]) => any) {
      childRegistrations.events.set(name, handler);
    },
  };
  const childPreviousEnv = { ...process.env };
  try {
    process.env.PI_SCHEDULED_TASK_RUN = "1";
    scheduledTasksExtension(childPi as any);
    const discovered = childRegistrations.events.get("resources_discover")?.({
      cwd: process.cwd(),
      reason: "startup",
    });

    assert.deepEqual(childRegistrations.tools, ["scheduled_task_handoff"]);
    assert.equal(discovered, undefined);
  } finally {
    process.env = childPreviousEnv;
  }
});

test("scheduled-tasks config loads global settings from the agent directory", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "scheduled-tasks-agent-"));
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-project-"));
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      "extension:scheduled-tasks": {
        cronEnvironment: { PATH: "/agent/bin" },
      },
    }),
  );

  const config = await loadScheduledTasksConfigFromSettings({ cwd, agentDir });

  assert.deepEqual(config.cronEnvironment, { PATH: "/agent/bin" });
  await rm(agentDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

test("cronEnvironment merges nested maps with later layers overriding keys", () => {
  assert.deepEqual(
    mergeCronEnvironment(
      { PATH: "/global/bin", ASDF_DATA_DIR: "/global/asdf" },
      { PATH: "/project/bin" },
      { ASDF_NODEJS_VERSION: "25.9.0" },
    ),
    {
      PATH: "/project/bin",
      ASDF_DATA_DIR: "/global/asdf",
      ASDF_NODEJS_VERSION: "25.9.0",
    },
  );
});

test("task ID and path helpers reject unsafe IDs and preserve root safety", () => {
  assert.equal(isSafeTaskId("dependency-audit_1"), true);
  assert.equal(isSafeTaskId("../bad"), false);
  const root = "/tmp/root";
  assert.equal(
    isInside(root, runDir(root, "task", "2026-01-01T00-00-00Z-abc123")),
    true,
  );
  assert.throws(() => runDir(root, "../task", "run"));
});

test("task Markdown parsing validates frontmatter and body shape", () => {
  const parsed = parseTaskMarkdown(
    "/tmp/dependency-audit.md",
    `---\nid: dependency-audit\nenabled: true\nschedule: "0 9 * * 1"\ncwd: /tmp\nenvFiles:\n  - .env\n  - /tmp/shared.env\nenv:\n  NODE_ENV: test\ntools:\n  - read\nhandoff: true\n---\nCheck dependencies.`,
  );
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.task?.id, "dependency-audit");
  assert.equal(parsed.task?.handoff, true);
  assert.deepEqual(parsed.task?.envFiles, [".env", "/tmp/shared.env"]);
  assert.deepEqual(parsed.task?.env, { NODE_ENV: "test" });
  assert.deepEqual(parsed.task?.tools, ["read"]);
});

test("task Markdown parsing accepts a single envFiles string", () => {
  const parsed = parseTaskMarkdown(
    "/tmp/dependency-audit.md",
    `---\nid: dependency-audit\nenabled: true\nschedule: "0 9 * * 1"\ncwd: /tmp\nenvFiles: .env\n---\nCheck dependencies.`,
  );
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.task?.envFiles, [".env"]);
});

test("validator reports errors, warnings, and effective handoff tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  const root = await tempRoot();
  const parsed = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "handoff: true\n"),
  );
  const result = await validateTask(
    parsed.task,
    {
      rootDir: root,
      defaultTimeoutMinutes: 30,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    },
    parsed.errors,
  );
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /handoff file does not exist/);
  assert.deepEqual(result.effectiveTools, ["read", "scheduled_task_handoff"]);
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("validator requires enabled task envFiles and only warns for disabled tasks", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  const root = await tempRoot();
  const config = {
    rootDir: root,
    defaultTimeoutMinutes: 30,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  };
  const enabled = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "envFiles:\n  - .env.missing\n"),
  );
  const enabledResult = await validateTask(
    enabled.task,
    config,
    enabled.errors,
  );
  assert.equal(enabledResult.ok, false);
  assert.match(
    enabledResult.errors.join("\n"),
    /envFiles .*\.env\.missing.*not found or unreadable/,
  );

  const disabled = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask(
      "job",
      cwd,
      "enabled: false\nenvFiles:\n  - .env.missing\n",
    ).replace("enabled: true\n", ""),
  );
  const disabledResult = await validateTask(
    disabled.task,
    config,
    disabled.errors,
  );
  assert.equal(disabledResult.ok, true);
  assert.match(
    disabledResult.warnings.join("\n"),
    /envFiles .*\.env\.missing.*not found or unreadable/,
  );
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("validator rejects invalid envFiles syntax and dotenv names without leaking values", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  const root = await tempRoot();
  await writeFile(
    join(cwd, ".env"),
    "GOOD=ok\nBAD-NAME=secret-value\n",
    "utf8",
  );
  const parsed = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "envFiles:\n  - .env\n"),
  );
  const result = await validateTask(
    parsed.task,
    {
      rootDir: root,
      defaultTimeoutMinutes: 30,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    },
    parsed.errors,
  );
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /invalid environment variable name: BAD-NAME/,
  );
  assert.doesNotMatch(result.errors.join("\n"), /secret-value/);
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("prompt rendering omits handoff unless task enables it and content exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  const root = await tempRoot();
  const parsed = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "handoff: true\n"),
  );
  await writeFile(join(root, "handoffs", "job.md"), "Previous note", "utf8");
  const rendered = await renderPrompt({
    rootDir: root,
    task: parsed.task!,
    runId: "run1",
  });
  assert.equal(rendered.includedHandoff, true);
  assert.match(rendered.prompt, /## Previous handoff\n\nPrevious note/);
  const noHandoffTask = { ...parsed.task!, handoff: false };
  const omitted = await renderPrompt({
    rootDir: root,
    task: noHandoffTask,
    runId: "run2",
  });
  assert.doesNotMatch(omitted.prompt, /Previous handoff/);
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("effective tool allowlist uses defaults and implicit handoff tool", () => {
  assert.deepEqual(
    effectiveTools(
      { tools: undefined, handoff: false },
      { defaultTools: ["read", "grep"] },
    ),
    ["read", "grep"],
  );
  assert.deepEqual(
    effectiveTools({ tools: [], handoff: true }, { defaultTools: ["read"] }),
    ["scheduled_task_handoff"],
  );
});

test("cron DOM and DOW fields use standard OR semantics when both are restricted", () => {
  const cron = parseCron("0 9 15 * 1");
  assert.ok(cron);
  assert.equal(cronMatches(cron, new Date("2026-06-15T09:00:00Z")), true);
  assert.equal(cronMatches(cron, new Date("2026-06-22T09:00:00Z")), true);
  assert.equal(cronMatches(cron, new Date("2026-07-15T09:00:00Z")), true);
  assert.equal(cronMatches(cron, new Date("2026-06-16T09:00:00Z")), false);
});

test("cron schedule computes next future runs and missed due decisions", () => {
  assert.ok(parseCron("*/5 * * * *"));
  const next = nextFutureRun("0 9 * * 1", new Date("2026-06-19T09:00:00Z"));
  assert.equal(next?.toISOString(), "2026-06-22T09:00:00.000Z");
  assert.deepEqual(
    decideDue({ schedule: "* * * * *", now: new Date("2026-06-19T09:00:00Z") })
      .action,
    "initialize",
  );
  assert.deepEqual(
    decideDue({
      schedule: "* * * * *",
      nextRunAt: "2026-06-19T08:58:00.000Z",
      now: new Date("2026-06-19T09:00:00Z"),
    }).action,
    "missed",
  );
});

test("state locks are exclusive and releasable", async () => {
  const root = await tempRoot();
  const first = await acquireLock(root, "scheduler");
  assert.ok(first);
  const second = await acquireLock(root, "scheduler");
  assert.equal(second, undefined);
  await first.release();
  const third = await acquireLock(root, "scheduler");
  assert.ok(third);
  await third.release();
  await rm(root, { recursive: true, force: true });
});

test("spawn plan builds safe arg arrays and scheduled-run env", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  const root = await tempRoot();
  const task = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "handoff: true\n"),
  ).task!;
  const plan = buildSpawnPlan({
    config: {
      rootDir: root,
      defaultTimeoutMinutes: 7,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    },
    task,
    runId: "run1",
    runDir: join(root, "runs", "job", "run1"),
    promptPath: join(root, "runs", "job", "run1", "prompt.md"),
  });
  assert.equal(plan.command, "pi");
  assert.deepEqual(plan.args.slice(0, 2), ["--mode", "json"]);
  assert.ok(plan.args.includes("--session-dir"));
  assert.ok(plan.args.includes("--tools"));
  assert.ok(plan.args.includes("read,scheduled_task_handoff"));
  assert.equal(plan.env.PI_SCHEDULED_TASK_RUN, "1");
  assert.equal(plan.timeoutMs, 60_000);
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("spawn plan merges env files before inline task env and scheduled markers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  const root = await tempRoot();
  await writeFile(
    join(cwd, ".env"),
    'FROM_FILE=one\nDUPLICATE=file\nPI_SCHEDULED_TASK_RUN=bad\nQUOTED="hello world"\n',
    "utf8",
  );
  await writeFile(join(cwd, ".env.local"), "DUPLICATE=later\n", "utf8");
  const task = parseTaskMarkdown(
    join(root, "tasks", "job.md"),
    sampleTask(
      "job",
      cwd,
      "envFiles:\n  - .env\n  - .env.local\nenv:\n  DUPLICATE: inline\n  INLINE_ONLY: yes\n",
    ),
  ).task!;
  const plan = buildSpawnPlan({
    config: {
      rootDir: root,
      defaultTimeoutMinutes: 7,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    },
    task,
    runId: "run1",
    runDir: join(root, "runs", "job", "run1"),
    promptPath: join(root, "runs", "job", "run1", "prompt.md"),
    envFileValues: {
      FROM_FILE: "one",
      DUPLICATE: "later",
      QUOTED: "hello world",
      PI_SCHEDULED_TASK_RUN: "bad",
    },
  });
  assert.equal(plan.env.FROM_FILE, "one");
  assert.equal(plan.env.QUOTED, "hello world");
  assert.equal(plan.env.DUPLICATE, "inline");
  assert.equal(plan.env.INLINE_ONLY, "yes");
  assert.equal(plan.env.PI_SCHEDULED_TASK_RUN, "1");
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("cron block scopes configured environment to the managed Pi command", () => {
  const block = buildCronBlock({
    projectCwd: "/tmp/project",
    piCommand: "pi",
    cronEnvironment: {
      PATH: "/asdf shims:/usr/bin",
      ASDF_DATA_DIR: "/Users/test/.asdf",
    },
  });
  assert.match(
    block,
    /cd '\/tmp\/project' && env PATH='\/asdf shims:\/usr\/bin' ASDF_DATA_DIR='\/Users\/test\/.asdf' 'pi' --mode json --no-session -p '\/tasks-tick'/,
  );
});

test("cron install and uninstall preserve unrelated crontab lines and quote Pi command entrypoint", () => {
  assert.equal(shellQuote("/tmp/a b;$(x)'y"), `'/tmp/a b;$(x)'"'"'y'`);
  const block = buildCronBlock({
    projectCwd: "/tmp/project with spaces;rm",
    piCommand: "/opt/pi bin/pi",
    cronEnvironment: {},
  });
  assert.match(block, /BEGIN PI SCHEDULED TASKS/);
  assert.match(
    block,
    /cd '\/tmp\/project with spaces;rm' && '\/opt\/pi bin\/pi' --mode json --no-session -p '\/tasks-tick'/,
  );
  assert.doesNotMatch(block, /pi-task-scheduler\.mjs|node/);
  const existing = "MAILTO=user@example.com\n";
  const installed = installManagedBlock(existing, block);
  assert.match(installed, /^MAILTO=user@example.com/m);
  const replaced = installManagedBlock(
    installed,
    block.replace("/opt/pi bin/pi", "/opt/pi2"),
  );
  assert.equal((replaced.match(/BEGIN PI SCHEDULED TASKS/g) ?? []).length, 1);
  const removed = uninstallManagedBlock(replaced);
  assert.equal(removed, existing);
});

async function commandHarness() {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const loadConfig = async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  });
  registerScheduledTaskCommands(pi as any, loadConfig);
  const notifications: Array<{ text: string; level: string }> = [];
  const ctx = {
    cwd: "/tmp/project",
    ui: {
      notify(text: string, level = "info") {
        notifications.push({ text, level });
      },
    },
  };
  return { registered, root, notifications, ctx };
}

test("/tasks-list reports a clear empty state", async () => {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const loadConfig = async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  });
  registerScheduledTaskCommands(pi as any, loadConfig);

  const notifications: Array<{ text: string; level: string }> = [];
  await registered.get("tasks-list")!.handler("", {
    cwd: "/tmp/project",
    ui: {
      notify(text: string, level = "info") {
        notifications.push({ text, level });
      },
    },
  });

  assert.equal(notifications[0]!.text, "No tasks found.");
  await rm(root, { recursive: true, force: true });
});

test("/tasks-show reports usage for missing task id", async () => {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const loadConfig = async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  });
  registerScheduledTaskCommands(pi as any, loadConfig);

  const notifications: Array<{ text: string; level: string }> = [];
  await registered.get("tasks-show")!.handler("   ", {
    cwd: "/tmp/project",
    ui: {
      notify(text: string, level = "info") {
        notifications.push({ text, level });
      },
    },
  });

  assert.deepEqual(notifications[0], {
    text: "Usage: /tasks-show <task-id>",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-show reports valid missing task as not found", async () => {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const loadConfig = async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  });
  registerScheduledTaskCommands(pi as any, loadConfig);

  const notifications: Array<{ text: string; level: string }> = [];
  await registered.get("tasks-show")!.handler("foo", {
    cwd: "/tmp/project",
    ui: {
      notify(text: string, level = "info") {
        notifications.push({ text, level });
      },
    },
  });

  assert.deepEqual(notifications[0], {
    text: "Task not found: foo",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-show reports invalid task id without throwing", async () => {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const loadConfig = async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  });
  registerScheduledTaskCommands(pi as any, loadConfig);

  const notifications: Array<{ text: string; level: string }> = [];
  await registered.get("tasks-show")!.handler("../bad", {
    cwd: "/tmp/project",
    ui: {
      notify(text: string, level = "info") {
        notifications.push({ text, level });
      },
    },
  });

  assert.equal(notifications[0]!.level, "error");
  assert.match(notifications[0]!.text, /Invalid task ID/);
  await rm(root, { recursive: true, force: true });
});

test("/tasks-run reports usage for missing task id", async () => {
  const { registered, root, notifications, ctx } = await commandHarness();
  await registered.get("tasks-run")!.handler("", ctx);

  assert.deepEqual(notifications[0], {
    text: "Usage: /tasks-run <task-id>",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-run reports valid missing task as not found", async () => {
  const { registered, root, notifications, ctx } = await commandHarness();
  await registered.get("tasks-run")!.handler("foo", ctx);

  assert.deepEqual(notifications[0], {
    text: "Task not found: foo",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-logs reports usage for missing task id", async () => {
  const { registered, root, notifications, ctx } = await commandHarness();
  await registered.get("tasks-logs")!.handler("", ctx);

  assert.deepEqual(notifications[0], {
    text: "Usage: /tasks-logs <task-id>",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-logs reports valid missing task as not found", async () => {
  const { registered, root, notifications, ctx } = await commandHarness();
  await registered.get("tasks-logs")!.handler("foo", ctx);

  assert.deepEqual(notifications[0], {
    text: "Task not found: foo",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-doctor reports invalid task id without throwing", async () => {
  const { registered, root, notifications, ctx } = await commandHarness();
  await registered.get("tasks-doctor")!.handler("../bad", ctx);

  assert.equal(notifications[0]!.level, "error");
  assert.match(notifications[0]!.text, /Invalid task ID/);
  await rm(root, { recursive: true, force: true });
});

test("/tasks-doctor reports valid missing task as not found", async () => {
  const { registered, root, notifications, ctx } = await commandHarness();
  await registered.get("tasks-doctor")!.handler("foo", ctx);

  assert.deepEqual(notifications[0], {
    text: "Task not found: foo",
    level: "warning",
  });
  await rm(root, { recursive: true, force: true });
});

test("/tasks-doctor reports managed crontab installation status", async () => {
  const cases = [
    {
      stdout: buildCronBlock({
        projectCwd: "/tmp/project",
        piCommand: "pi",
        cronEnvironment: {},
      }),
      error: null,
      stderr: "",
      expected: "cron: installed",
    },
    {
      stdout: "MAILTO=user@example.com\n",
      error: null,
      stderr: "",
      expected: "cron: not installed",
    },
    {
      stdout: "",
      error: Object.assign(new Error("spawn crontab ENOENT"), {
        code: "ENOENT",
      }),
      stderr: "",
      expected: "cron: unavailable (crontab exited ENOENT)",
    },
  ];

  for (const item of cases) {
    const { registered, root, notifications, ctx } = await commandHarness();
    mock.method(
      _execFile,
      "fn",
      (_command: string, _args: string[], callback: any) => {
        callback(item.error, item.stdout, item.stderr);
        return { stdin: { end() {} } };
      },
    );

    await registered.get("tasks-doctor")!.handler("", ctx);

    assert.ok(notifications[0]!.text.includes(item.expected));
    assert.ok(notifications[0]!.text.includes("last tick: none"));
    await rm(root, { recursive: true, force: true });
    mock.restoreAll();
  }
});

test("scheduled_tasks doctor reports managed crontab status", async () => {
  const root = await tempRoot();
  const registered: Array<{ execute: (...args: any[]) => Promise<any> }> = [];
  registerScheduledTasksTool(
    {
      registerTool(tool: { execute: (...args: any[]) => Promise<any> }) {
        registered.push(tool);
      },
    } as any,
    async () => ({
      rootDir: root,
      defaultTimeoutMinutes: 1,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    }),
  );
  mock.method(
    _execFile,
    "fn",
    (_command: string, _args: string[], callback: any) => {
      callback(null, "MAILTO=user@example.com\n", "");
      return { stdin: { end() {} } };
    },
  );

  const result = await registered[0]!.execute(
    "call-1",
    { action: "doctor" },
    undefined,
    undefined,
    { cwd: "/tmp/project" },
  );

  assert.match(result.content[0].text, /cron: not installed/);
  assert.match(result.content[0].text, /last tick: none/);
  assert.equal(result.details.crontabStatus.status, "not_installed");
  await rm(root, { recursive: true, force: true });
});

test("commands register /tasks-tick with dry-run support instead of legacy dry-run command", async () => {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const loadConfig = async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  });
  registerScheduledTaskCommands(pi as any, loadConfig);
  assert.ok(registered.has("tasks-tick"));
  assert.equal(registered.has("tasks-tick-dry-run"), false);

  const notifications: Array<{ text: string; level: string }> = [];
  await registered.get("tasks-tick")!.handler("--dry-run", {
    cwd: "/tmp/project",
    ui: {
      notify(text: string, level = "info") {
        notifications.push({ text, level });
      },
    },
  });
  assert.match(notifications[0]!.text, /"dryRun": true/);
  await rm(root, { recursive: true, force: true });
});

test("spawn streams full logs while keeping bounded output tails", async () => {
  const root = await tempRoot();
  const logPath = join(root, "runs", "pi.log");
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => child);
  const first = `FIRST_PREFIX${"a".repeat(700_000)}`;
  const last = "b".repeat(700_000);
  process.nextTick(() => {
    child.stdout.write(first);
    child.stdout.write(last);
    child.stderr.write("err".repeat(400_000));
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  const outcome = await spawnPi(
    {
      command: "pi",
      args: ["--mode", "json"],
      cwd: root,
      env: {},
      timeoutMs: 60_000,
    },
    logPath,
  );
  assert.equal(outcome.exitCode, 0);
  assert.ok(Buffer.byteLength(outcome.stdout) <= OUTPUT_TAIL_BYTES);
  assert.ok(Buffer.byteLength(outcome.stderr) <= OUTPUT_TAIL_BYTES);
  assert.equal(outcome.stdout.includes("FIRST_PREFIX"), false);
  assert.ok(outcome.stdout.endsWith(last));
  const log = await readFile(logPath, "utf8");
  assert.match(log, /^\$ pi --mode json/);
  assert.ok(log.includes(first.slice(0, 100)));
  assert.ok(log.includes(last.slice(-100)));
  const stderrHeader = log.indexOf("\n\n## stderr\n");
  assert.notEqual(stderrHeader, -1);
  assert.equal(log.slice(0, stderrHeader).includes("errerr"), false);
  assert.match(log.slice(stderrHeader), /errerr/);
  await rm(root, { recursive: true, force: true });
});

test("spawn keeps multibyte output tails within the byte limit", async () => {
  const root = await tempRoot();
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => child);
  process.nextTick(() => {
    child.stdout.write(`PREFIX${"é".repeat(OUTPUT_TAIL_BYTES)}`);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  const outcome = await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "multibyte.log"),
  );
  assert.ok(Buffer.byteLength(outcome.stdout) <= OUTPUT_TAIL_BYTES);
  assert.equal(outcome.stdout.includes("PREFIX"), false);
  await rm(root, { recursive: true, force: true });
});

test("spawn applies write-stream backpressure to child pipes", async () => {
  const root = await tempRoot();
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let paused = 0;
  let resumed = 0;
  const originalPause = child.stdout.pause.bind(child.stdout);
  const originalResume = child.stdout.resume.bind(child.stdout);
  child.stdout.pause = () => {
    paused += 1;
    return originalPause();
  };
  child.stdout.resume = () => {
    resumed += 1;
    return originalResume();
  };
  mock.method(_spawn, "fn", () => child);
  const log = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as BackpressureStream;
  log.writes = [];
  log.drainCount = 0;
  mock.method(log, "write", (chunk: unknown) => {
    log.writes.push(String(chunk));
    if (log.drainCount === 0 && String(chunk).includes("payload")) {
      log.drainCount += 1;
      process.nextTick(() => log.emit("drain"));
      return false;
    }
    return true;
  });
  mock.method(_createWriteStream, "fn", () => log as any);
  process.nextTick(() => {
    child.stdout.write("payload");
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "backpressure.log"),
  );
  assert.ok(paused > 0);
  assert.ok(resumed > 0);
  await rm(root, { recursive: true, force: true });
});

test("spawn parses complete session lines before bounding later partial stdout", async () => {
  const root = await tempRoot();
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => child);
  process.nextTick(() => {
    child.stdout.write(
      `{"session_file":"/tmp/session-before-tail.json"}\n${"x".repeat(OUTPUT_TAIL_BYTES + 10_000)}`,
    );
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  const outcome = await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "line-before-tail.log"),
  );
  assert.equal(outcome.sessionFile, "/tmp/session-before-tail.json");
  assert.ok(Buffer.byteLength(outcome.stdout) <= OUTPUT_TAIL_BYTES);
  await rm(root, { recursive: true, force: true });
});

test("spawn preserves multibyte characters split across output chunks", async () => {
  const root = await tempRoot();
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => child);
  const encoded = Buffer.from("é");
  process.nextTick(() => {
    child.stdout.write(encoded.subarray(0, 1));
    child.stdout.write(encoded.subarray(1));
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  const outcome = await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "split-multibyte.log"),
  );
  assert.equal(outcome.stdout, "é");
  await rm(root, { recursive: true, force: true });
});

test("spawn bounds unterminated stdout line buffering while still parsing later session events", async () => {
  const root = await tempRoot();
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => child);
  process.nextTick(() => {
    child.stdout.write("x".repeat(OUTPUT_TAIL_BYTES + 10_000));
    child.stdout.write('\n{"session_file":"/tmp/session.json"}\n');
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  const outcome = await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "line-buffer.log"),
  );
  assert.equal(outcome.sessionFile, "/tmp/session.json");
  assert.ok(Buffer.byteLength(outcome.stdout) <= OUTPUT_TAIL_BYTES);
  await rm(root, { recursive: true, force: true });
});

test("spawn error and nonzero results keep bounded tails", async () => {
  const root = await tempRoot();
  const errorChild = new EventEmitter() as StubChild;
  errorChild.stdout = new PassThrough();
  errorChild.stderr = new PassThrough();
  errorChild.kill = () => true;
  mock.method(_spawn, "fn", () => errorChild);
  process.nextTick(() => {
    errorChild.stderr.write(`ERR_PREFIX${"e".repeat(1_200_000)}`);
    errorChild.emit("error", new Error("spawn failed"));
  });
  const errorOutcome = await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "error.log"),
  );
  assert.equal(errorOutcome.error, "spawn failed");
  assert.ok(Buffer.byteLength(errorOutcome.stderr) <= OUTPUT_TAIL_BYTES);
  assert.equal(errorOutcome.stderr.includes("ERR_PREFIX"), false);

  const nonzeroChild = new EventEmitter() as StubChild;
  nonzeroChild.stdout = new PassThrough();
  nonzeroChild.stderr = new PassThrough();
  nonzeroChild.kill = () => true;
  mock.method(_spawn, "fn", () => nonzeroChild);
  process.nextTick(() => {
    nonzeroChild.stdout.write(`OUT_PREFIX${"o".repeat(1_200_000)}`);
    nonzeroChild.stdout.end();
    nonzeroChild.stderr.end();
    nonzeroChild.emit("close", 2, null);
  });
  const nonzeroOutcome = await spawnPi(
    { command: "pi", args: [], cwd: root, env: {}, timeoutMs: 60_000 },
    join(root, "runs", "nonzero.log"),
  );
  assert.equal(nonzeroOutcome.exitCode, 2);
  assert.ok(Buffer.byteLength(nonzeroOutcome.stdout) <= OUTPUT_TAIL_BYTES);
  assert.equal(nonzeroOutcome.stdout.includes("OUT_PREFIX"), false);
  await rm(root, { recursive: true, force: true });
});

test("spawn timeout results keep bounded tails", async () => {
  const root = await tempRoot();
  const logPath = join(root, "runs", "timeout.log");
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal: string) => {
    if (signal === "SIGTERM")
      process.nextTick(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  mock.method(_spawn, "fn", () => child);
  child.stdout.write("x".repeat(1_200_000));

  const outcome = await spawnPi(
    {
      command: "pi",
      args: [],
      cwd: root,
      env: {},
      timeoutMs: 1,
    },
    logPath,
  );
  assert.equal(outcome.timedOut, true);
  assert.ok(Buffer.byteLength(outcome.stdout) <= OUTPUT_TAIL_BYTES);
  await rm(root, { recursive: true, force: true });
});

test("latest logs show bounded artifact tails", async () => {
  const root = await tempRoot();
  const runId = "2026-06-19T09-00-00Z-abcdef";
  const dir = runDir(root, "job", runId);
  await mkdir(dir, { recursive: true });
  await writeTaskState(root, {
    taskId: "job",
    lastRunId: runId,
    lastStatus: "success",
  });
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify({ status: "success" }),
    "utf8",
  );
  await writeFile(
    join(dir, "output.md"),
    `HEAD_OUTPUT${"x".repeat(10_000)}TAIL_OUTPUT`,
    "utf8",
  );
  await writeFile(
    join(dir, "pi.log"),
    `HEAD_LOG${"y".repeat(10_000)}TAIL_LOG`,
    "utf8",
  );

  const logs = await readLatestLogs(
    {
      rootDir: root,
      defaultTimeoutMinutes: 1,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    },
    "job",
  );
  assert.match(logs, /TAIL_OUTPUT/);
  assert.match(logs, /TAIL_LOG/);
  assert.doesNotMatch(logs, /HEAD_OUTPUT/);
  assert.doesNotMatch(logs, /HEAD_LOG/);
  await rm(root, { recursive: true, force: true });
});

test("handoff updates derive run marker path from root task and run IDs", async () => {
  const root = await tempRoot();
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  await writeFile(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "handoff: true\n"),
    "utf8",
  );
  const safeRunId = "2026-06-19T09-00-00Z-abcdef";
  const safeRunDir = runDir(root, "job", safeRunId);
  const maliciousRunDir = await mkdtemp(
    join(tmpdir(), "scheduled-tasks-bad-run-"),
  );
  await mkdir(safeRunDir, { recursive: true });
  const registered: Array<{ execute: (...args: any[]) => Promise<any> }> = [];
  registerHandoffTool(
    {
      registerTool(tool: { execute: (...args: any[]) => Promise<any> }) {
        registered.push(tool);
      },
    } as any,
    async () => ({
      rootDir: root,
      defaultTimeoutMinutes: 1,
      defaultTools: ["read"],
      piCommand: "pi",
      cronEnvironment: {},
    }),
  );
  const previousEnv = { ...process.env };
  try {
    process.env.PI_SCHEDULED_TASK_RUN = "1";
    process.env.PI_SCHEDULED_TASK_ID = "job";
    process.env.PI_SCHEDULED_TASK_RUN_ID = safeRunId;
    process.env.PI_SCHEDULED_TASK_RUN_DIR = maliciousRunDir;
    const result = await registered[0]!.execute(
      "call-1",
      { action: "update", content: "new handoff" },
      undefined,
      undefined,
      { cwd },
    );
    assert.match(result.content[0].text, /Updated scheduled task handoff/);
    assert.equal(
      await readFile(join(root, "handoffs", "job.md"), "utf8"),
      "new handoff",
    );
    assert.equal(
      await readFile(join(safeRunDir, "handoff-updated"), "utf8"),
      "1",
    );
    await assert.rejects(
      readFile(join(maliciousRunDir, "handoff-updated"), "utf8"),
    );

    process.env.PI_SCHEDULED_TASK_RUN_ID = "../bad";
    const invalid = await registered[0]!.execute(
      "call-2",
      { action: "update", content: "still updates" },
      undefined,
      undefined,
      { cwd },
    );
    assert.match(invalid.content[0].text, /Updated scheduled task handoff/);
    assert.equal(
      await readFile(join(root, "handoffs", "job.md"), "utf8"),
      "still updates",
    );
  } finally {
    process.env = previousEnv;
    await rm(maliciousRunDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("scheduler dry-run reports decisions without mutating state, artifacts, or spawning", async () => {
  const root = await tempRoot();
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  await writeFile(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd),
    "utf8",
  );
  const config = {
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  };
  let spawnCount = 0;
  mock.method(_spawn, "fn", () => {
    spawnCount += 1;
    throw new Error("dry-run must not spawn");
  });

  const initialized = await schedulerTick(config, {
    dryRun: true,
    now: new Date("2026-06-19T09:00:00Z"),
  });
  assert.equal(initialized.status, "ok");
  assert.equal(initialized.timestamp, "2026-06-19T09:00:00.000Z");
  assert.equal(initialized.skipped[0]?.status, "would_initialize");
  assert.equal(await readTaskState(root, "job"), undefined);
  assert.deepEqual(await readdir(join(root, "runs")), []);

  await writeTaskState(root, {
    taskId: "job",
    nextRunAt: "2026-06-19T09:01:00.000Z",
  });
  const due = await schedulerTick(config, {
    dryRun: true,
    now: new Date("2026-06-19T09:01:00Z"),
  });
  assert.equal(due.status, "ok");
  assert.equal(due.claimed[0]?.status, "would_run");
  assert.equal(
    (await readTaskState(root, "job"))?.nextRunAt,
    "2026-06-19T09:01:00.000Z",
  );

  await writeTaskState(root, {
    taskId: "job",
    nextRunAt: "2026-06-19T09:01:00.000Z",
  });
  const missed = await schedulerTick(config, {
    dryRun: true,
    now: new Date("2026-06-19T09:03:00Z"),
  });
  assert.equal(missed.status, "ok");
  assert.equal(missed.skipped[0]?.status, "would_miss");
  assert.equal(
    (await readTaskState(root, "job"))?.nextRunAt,
    "2026-06-19T09:01:00.000Z",
  );
  assert.equal(spawnCount, 0);
  assert.deepEqual(await readdir(join(root, "runs")), []);
  const tickLog = (await readFile(tickLogPath(root), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(tickLog.length, 3);
  assert.equal(tickLog[0].dryRun, true);
  assert.equal(tickLog[2].skipped[0].status, "would_miss");
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("scheduler lock reports scheduler-level locked status without fake task id", async () => {
  const root = await tempRoot();
  const config = {
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  };
  const held = await acquireLock(root, "scheduler");
  assert.ok(held);

  const locked = await schedulerTick(config, {
    now: new Date("2026-06-19T09:00:00Z"),
  });

  assert.equal(locked.status, "locked");
  assert.equal(locked.message, "Scheduler lock is already held.");
  assert.deepEqual(locked.claimed, []);
  assert.deepEqual(locked.skipped, []);
  const latest = JSON.parse(
    (await readFile(tickLogPath(root), "utf8")).trim().split("\n").at(-1)!,
  );
  assert.equal(latest.status, "locked");
  assert.equal(latest.taskId, undefined);

  await held.release();
  await rm(root, { recursive: true, force: true });
});

test("scheduler tick log is retained to the latest 1000 entries", async () => {
  const root = await tempRoot();
  const oldEntries = Array.from({ length: 1005 }, (_, index) =>
    JSON.stringify({
      timestamp: `2026-06-18T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
      status: "ok",
      claimed: [],
      skipped: [],
      dryRun: false,
    }),
  );
  await writeFile(tickLogPath(root), `${oldEntries.join("\n")}\n`, "utf8");

  const config = {
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  };
  await schedulerTick(config, { now: new Date("2026-06-19T09:00:00Z") });

  const lines = (await readFile(tickLogPath(root), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1000);
  assert.equal(JSON.parse(lines.at(-1)!).timestamp, "2026-06-19T09:00:00.000Z");
  assert.equal(
    JSON.parse(lines[0]!).timestamp,
    JSON.parse(oldEntries[6]!).timestamp,
  );
  await rm(root, { recursive: true, force: true });
});

test("scheduler locked due tasks keep nextRunAt for retries until grace expires", async () => {
  const root = await tempRoot();
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  await writeFile(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd),
    "utf8",
  );
  const config = {
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  };
  await writeTaskState(root, {
    taskId: "job",
    nextRunAt: "2026-06-19T09:01:00.000Z",
  });
  const held = await acquireLock(root, "job");
  assert.ok(held);

  const locked = await schedulerTick(config, {
    now: new Date("2026-06-19T09:01:30Z"),
  });
  assert.equal(locked.status, "ok");
  assert.equal(locked.skipped[0]?.status, "locked");
  assert.equal(
    (await readTaskState(root, "job"))?.nextRunAt,
    "2026-06-19T09:01:00.000Z",
  );

  await held.release();
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => {
    process.nextTick(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  });
  const retried = await schedulerTick(config, {
    now: new Date("2026-06-19T09:02:00Z"),
  });
  assert.equal(retried.claimed[0]?.status, "success");
  assert.equal(
    (await readTaskState(root, "job"))?.nextRunAt,
    "2026-06-19T09:03:00.000Z",
  );

  await writeTaskState(root, {
    taskId: "job",
    nextRunAt: "2026-06-19T09:01:00.000Z",
  });
  const missed = await schedulerTick(config, {
    now: new Date("2026-06-19T09:03:00Z"),
  });
  assert.equal(missed.skipped[0]?.status, "missed");
  assert.equal(
    (await readTaskState(root, "job"))?.nextRunAt,
    "2026-06-19T09:04:00.000Z",
  );
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

test("cron commands call crontab through exported wrapper", async () => {
  const registered = new Map<
    string,
    { handler: (args: string, ctx: any) => Promise<void> }
  >();
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: any) => Promise<void> },
    ) {
      registered.set(name, command);
    },
  };
  const root = await tempRoot();
  const calls: Array<{ command: string; args: string[]; input?: string }> = [];
  mock.method(
    _execFile,
    "fn",
    (command: string, args: string[], callback: any) => {
      calls.push({ command, args });
      if (args[0] === "-l") callback(null, "MAILTO=user@example.com\n", "");
      else callback(null, "", "");
      return {
        stdin: {
          end(input: string) {
            calls[calls.length - 1]!.input = input;
          },
        },
      };
    },
  );
  registerScheduledTaskCommands(pi as any, async () => ({
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  }));

  await registered.get("tasks-install-cron")!.handler("", {
    cwd: "/tmp/project",
    ui: { notify() {} },
  });
  assert.deepEqual(
    calls.map((call) => [call.command, call.args]),
    [
      ["crontab", ["-l"]],
      ["crontab", ["-"]],
    ],
  );
  assert.match(calls[1]!.input ?? "", /\/tasks-tick/);
  await rm(root, { recursive: true, force: true });
});

test("scheduler tick initializes state, claims due work, writes artifacts, and releases locks", async () => {
  const root = await tempRoot();
  const cwd = await mkdtemp(join(tmpdir(), "scheduled-tasks-cwd-"));
  await writeFile(join(cwd, ".env"), "FROM_ENV_FILE=loaded\n", "utf8");
  await writeFile(
    join(root, "tasks", "job.md"),
    sampleTask("job", cwd, "envFiles:\n  - .env\n"),
    "utf8",
  );
  const config = {
    rootDir: root,
    defaultTimeoutMinutes: 1,
    defaultTools: ["read"],
    piCommand: "pi",
    cronEnvironment: {},
  };
  const first = await schedulerTick(config, {
    now: new Date("2026-06-19T09:00:00Z"),
  });
  assert.equal(first.status, "ok");
  assert.equal(first.skipped[0]?.status, "initialized");
  const state = await readTaskState(root, "job");
  assert.ok(state?.nextRunAt);
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  mock.method(
    _spawn,
    "fn",
    (_command: string, _args: readonly string[], options?: SpawnOptions) => {
      spawnedEnv = options?.env;
      process.nextTick(() => {
        child.stdout.write(
          '{"type":"message_end","message":{"content":"done"}}\n',
        );
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return child;
    },
  );
  const due = await schedulerTick(config, { now: new Date(state!.nextRunAt!) });
  assert.equal(due.status, "ok");
  assert.equal(due.claimed[0]?.status, "success");
  assert.equal(spawnedEnv?.FROM_ENV_FILE, "loaded");
  const updated = await readTaskState(root, "job");
  assert.equal(updated?.lastStatus, "success");
  const runId = updated!.lastRunId!;
  assert.match(
    await readFile(join(root, "runs", "job", runId, "prompt.md"), "utf8"),
    /# Scheduled task run/,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(root, "runs", "job", runId, "result.json"), "utf8"),
    ).status,
    "success",
  );
  const latestTick = JSON.parse(
    (await readFile(tickLogPath(root), "utf8")).trim().split("\n").at(-1)!,
  );
  assert.equal(latestTick.claimed[0].runId, runId);
  assert.equal(latestTick.status, "ok");
  const relocked = await acquireLock(root, "job");
  assert.ok(relocked);
  await relocked.release();
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});
