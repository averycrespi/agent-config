import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { registerScheduledTaskCommands } from "./commands.ts";
import { normalizeConfig } from "./config.ts";
import {
  buildCronBlock,
  installManagedBlock,
  shellQuote,
  uninstallManagedBlock,
} from "./cron.ts";
import { acquireLock } from "./locks.ts";
import { ensureRootLayout, isInside, isSafeTaskId, runDir } from "./paths.ts";
import { renderPrompt } from "./prompt.ts";
import { decideDue, nextFutureRun, parseCron } from "./schedule.ts";
import { schedulerTick } from "./scheduler.ts";
import { buildSpawnPlan, _spawn } from "./spawn.ts";
import { readTaskState, writeTaskState } from "./state.ts";
import { parseTaskMarkdown } from "./task-file.ts";
import { effectiveTools, validateTask } from "./validate.ts";

type StubChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal: string) => boolean;
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
    },
    warnings,
  );
  assert.equal(config.defaultTimeoutMinutes, 5);
  assert.deepEqual(config.defaultTools, ["read", "bash"]);
  assert.equal(config.piCommand, "/bin/pi");
  assert.equal(warnings.length, 0);
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
    `---\nid: dependency-audit\nenabled: true\nschedule: "0 9 * * 1"\ncwd: /tmp\nenv:\n  NODE_ENV: test\ntools:\n  - read\nhandoff: true\n---\nCheck dependencies.`,
  );
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.task?.id, "dependency-audit");
  assert.equal(parsed.task?.handoff, true);
  assert.deepEqual(parsed.task?.env, { NODE_ENV: "test" });
  assert.deepEqual(parsed.task?.tools, ["read"]);
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
    },
    parsed.errors,
  );
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /handoff file does not exist/);
  assert.deepEqual(result.effectiveTools, ["read", "scheduled_task_handoff"]);
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

test("cron install and uninstall preserve unrelated crontab lines and quote Pi command entrypoint", () => {
  assert.equal(shellQuote("/tmp/a b;$(x)'y"), `'/tmp/a b;$(x)'"'"'y'`);
  const block = buildCronBlock({
    projectCwd: "/tmp/project with spaces;rm",
    piCommand: "/opt/pi bin/pi",
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
  assert.equal(due.claimed[0]?.status, "would_run");
  assert.equal(
    (await readTaskState(root, "job"))?.nextRunAt,
    "2026-06-19T09:01:00.000Z",
  );
  assert.equal(spawnCount, 0);
  assert.deepEqual(await readdir(join(root, "runs")), []);
  await rm(cwd, { recursive: true, force: true });
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

test("scheduler tick initializes state, claims due work, writes artifacts, and releases locks", async () => {
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
  };
  const first = await schedulerTick(config, {
    now: new Date("2026-06-19T09:00:00Z"),
  });
  assert.equal(first.skipped[0]?.status, "initialized");
  const state = await readTaskState(root, "job");
  assert.ok(state?.nextRunAt);
  const child = new EventEmitter() as StubChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  mock.method(_spawn, "fn", () => {
    process.nextTick(() => {
      child.stdout.write(
        '{"type":"message_end","message":{"content":"done"}}\n',
      );
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  });
  const due = await schedulerTick(config, { now: new Date(state!.nextRunAt!) });
  assert.equal(due.claimed[0]?.status, "success");
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
  const relocked = await acquireLock(root, "job");
  assert.ok(relocked);
  await relocked.release();
  await rm(cwd, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});
