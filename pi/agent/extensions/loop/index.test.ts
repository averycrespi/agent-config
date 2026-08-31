import assert from "node:assert/strict";
import { test } from "node:test";
import { loop as loopApi } from "./api.ts";
import { createLoopExtension } from "./index.ts";

const config = {
  showWidget: true,
  defaultMaxContinuations: 3,
  defaultMaxActiveMinutes: 60,
  hardMaxContinuations: 20,
  hardMaxActiveMinutes: 120,
  defaultDelaySeconds: 0,
  hardMaxDelaySeconds: 300,
  messageMaxChars: 100,
  reasonMaxChars: 100,
};

function makePi() {
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  const tools = new Map<string, any>();
  const widgets: Array<{ key: string; content: any; options?: any }> = [];
  const entries: Array<{ type: string; data: unknown }> = [];
  const sentMessages: Array<{ message: any; options: any }> = [];
  const events: Array<{ name: string; data: unknown }> = [];
  return {
    hasUI: true,
    commands,
    handlers,
    tools,
    widgets,
    entries,
    sentMessages,
    emittedEvents: events,
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    on(name: string, handler: any) {
      handlers.set(name, handler);
    },
    setWidget(key: string, content: any, options?: any) {
      widgets.push({ key, content, options });
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
    sendMessage(message: any, options?: any) {
      sentMessages.push({ message, options });
    },
    events: {
      emit(name: string, data: unknown) {
        events.push({ name, data });
      },
    },
  } as any;
}

function makeCtx(branch: unknown[] = []) {
  const notifications: Array<{ message: string; level: string }> = [];
  let pending = false;
  return {
    cwd: "/repo",
    hasUI: true,
    notifications,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setWidget() {},
    },
    sessionManager: { getBranch: () => branch },
    hasPendingMessages: async () => pending,
    setPending(value: boolean) {
      pending = value;
    },
  } as any;
}

async function setup(
  branch: unknown[] = [],
  runtimeConfig: typeof config = config,
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>,
) {
  const pi = makePi();
  const ctx = makeCtx(branch);
  createLoopExtension({
    loadConfig: async () => ({ config: runtimeConfig, warnings: [] }),
    wait,
  })(pi);
  await pi.handlers.get("session_start")({}, ctx);
  return { pi, ctx };
}

async function execute(pi: ReturnType<typeof makePi>, params: unknown) {
  return pi.tools
    .get("loop")
    .execute("call-1", params, undefined, undefined, {});
}

test("commands expose the user control plane and place the widget below editor", async () => {
  const { pi, ctx } = await setup();

  for (const name of [
    "loop",
    "loop-start",
    "loop-yield",
    "loop-stop",
    "loop-resume",
    "loop-extend",
    "loop-clear",
    "loop-config",
  ]) {
    assert.equal(pi.commands.has(name), true, name);
  }

  await pi.commands.get("loop-start").handler("Keep going", ctx);
  assert.deepEqual(pi.widgets.at(-1)?.options, { placement: "belowEditor" });
  assert.equal(pi.entries.at(-1)?.type, "loop-state");
});

test("settlement broadcasts the specified message plus control reminder without budget pressure", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, { action: "start", message: "Keep making progress" });

  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );
  await pi.handlers.get("agent_settled")({}, ctx);

  assert.equal(pi.sentMessages.length, 1);
  const sent = pi.sentMessages[0];
  assert.equal(sent.message.customType, "loop-continuation");
  assert.match(sent.message.content, /^Keep making progress/);
  assert.doesNotMatch(sent.message.content, /\[Loop continuation\]/);
  assert.match(sent.message.content, /action: "yield"/);
  assert.match(sent.message.content, /action: "stop"/);
  assert.match(sent.message.content, /action: "get"/);
  assert.doesNotMatch(
    sent.message.content,
    /3\/10|\d+ minutes? (?:elapsed|left|remaining)/i,
  );
  assert.deepEqual(sent.options, { deliverAs: "followUp", triggerTurn: true });
  assert.equal((pi.entries.at(-1)?.data as any).loop.continuationCount, 1);

  await pi.handlers.get("agent_settled")({}, ctx);
  assert.equal(
    pi.sentMessages.length,
    1,
    "duplicate settlement must not enqueue twice",
  );
});

test("settlement waits for the configured delay before claiming a continuation", async () => {
  const waits: number[] = [];
  let release!: () => void;
  const { pi, ctx } = await setup([], config, (milliseconds) => {
    waits.push(milliseconds);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await execute(pi, {
    action: "start",
    message: "Poll once per continuation",
    delay_seconds: 5,
  });
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );

  const settling = pi.handlers.get("agent_settled")({}, ctx);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(waits, [5_000]);
  assert.equal(pi.sentMessages.length, 0);
  assert.equal(loopApi.get()?.continuationCount, 0);

  release();
  await settling;

  assert.equal(pi.sentMessages.length, 1);
  assert.equal(loopApi.get()?.continuationCount, 1);
});

test("stopping during a delay cancels the pending continuation", async () => {
  const { pi, ctx } = await setup(
    [],
    config,
    (_milliseconds, signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  );
  await execute(pi, {
    action: "start",
    message: "Poll once per continuation",
    delay_seconds: 5,
  });
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );

  const settling = pi.handlers.get("agent_settled")({}, ctx);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await execute(pi, { action: "stop", reason: "No more polling" });
  await settling;

  assert.equal(pi.sentMessages.length, 0);
  assert.equal(loopApi.get()?.continuationCount, 0);
  assert.equal(loopApi.get()?.status, "stopped");
});

test("a stale settlement cannot claim a replacement loop", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, { action: "start", message: "old work" });
  let releasePending!: (value: boolean) => void;
  ctx.hasPendingMessages = () =>
    new Promise<boolean>((resolve) => {
      releasePending = resolve;
    });
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );
  const settling = pi.handlers.get("agent_settled")({}, ctx);
  loopApi.clear();
  loopApi.start({ message: "replacement work" });
  releasePending(false);
  await settling;

  assert.equal(loopApi.get()?.message, "replacement work");
  assert.equal(loopApi.get()?.continuationCount, 0);
  assert.equal(pi.sentMessages.length, 0);
});

test("lifecycle mutations invalidate scheduling before a delay starts", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, {
    action: "start",
    message: "Poll once per continuation",
    delay_seconds: 5,
  });
  let releasePending!: (value: boolean) => void;
  ctx.hasPendingMessages = () =>
    new Promise<boolean>((resolve) => {
      releasePending = resolve;
    });
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );

  const settling = pi.handlers.get("agent_settled")({}, ctx);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await execute(pi, { action: "stop", reason: "Pause polling" });
  await execute(pi, { action: "resume" });
  releasePending(false);
  await settling;

  assert.equal(loopApi.get()?.status, "running");
  assert.equal(loopApi.get()?.continuationCount, 0);
  assert.equal(pi.sentMessages.length, 0);
});

test("continued subscribers can stop before the message is enqueued", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, { action: "start", message: "work" });
  const unsubscribe = loopApi.subscribe((event) => {
    if (event.type === "continued") loopApi.stop("Subscriber stopped loop");
  });
  const observed: string[] = [];
  const unsubscribeObserver = loopApi.subscribe((event) =>
    observed.push(event.type),
  );
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );

  await pi.handlers.get("agent_settled")({}, ctx);
  unsubscribe();
  unsubscribeObserver();

  assert.equal(loopApi.get()?.status, "stopped");
  assert.equal(pi.sentMessages.length, 0);
  assert.deepEqual(observed, ["continued", "stopped"]);
  assert.deepEqual(
    pi.emittedEvents.slice(-2).map((event: any) => event.name),
    ["loop:continued", "loop:stopped"],
  );
});

test("pending messages defer scheduling until their run settles", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, { action: "start", message: "work" });
  ctx.setPending(true);
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );
  await pi.handlers.get("agent_settled")({}, ctx);
  assert.equal(pi.sentMessages.length, 0);

  ctx.setPending(false);
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );
  await pi.handlers.get("agent_settled")({}, ctx);
  assert.equal(pi.sentMessages.length, 1);
});

test("real user input wakes yielded loops but leaves running loops running", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, { action: "start", message: "work" });

  await pi.handlers.get("input")({ source: "interactive" }, ctx);
  assert.equal(loopApi.get()?.status, "running");

  await execute(pi, { action: "yield", reason: "Need input" });
  await pi.handlers.get("input")({ source: "extension" }, ctx);
  assert.equal(loopApi.get()?.status, "yielded");
  await pi.handlers.get("input")({ source: "rpc" }, ctx);
  assert.equal(loopApi.get()?.status, "running");
});

test("waking an exhausted yielded loop persists and emits exhaustion", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, {
    action: "start",
    message: "work",
    max_continuations: 1,
  });
  await pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    ctx,
  );
  await pi.handlers.get("agent_settled")({}, ctx);
  await execute(pi, { action: "yield", reason: "Need input" });
  const entriesBeforeWake = pi.entries.length;

  await pi.handlers.get("input")({ source: "interactive" }, ctx);

  assert.equal(loopApi.get()?.status, "stopped");
  assert.equal(loopApi.get()?.stopReason, "continuation_limit");
  assert.equal(pi.entries.length, entriesBeforeWake + 1);
  assert.ok(
    pi.emittedEvents.some((event: any) => event.name === "loop:exhausted"),
  );
});

test("resume schedules only after an actual transition", async () => {
  const { pi, ctx } = await setup();
  ctx.isIdle = () => true;
  await execute(pi, { action: "start", message: "work" });
  await execute(pi, { action: "stop", reason: "wait" });

  loopApi.resume();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pi.sentMessages.length, 1);

  await pi.commands.get("loop-resume").handler("", ctx);
  assert.equal(pi.sentMessages.length, 1);
});

test("provider failures do not stop a replacement loop", async () => {
  const { pi, ctx } = await setup();
  await execute(pi, { action: "start", message: "old work" });
  await pi.handlers.get("agent_end")(
    {
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "rate limit" },
      ],
    },
    ctx,
  );
  loopApi.clear();
  loopApi.start({ message: "replacement work" });

  await pi.handlers.get("agent_settled")({}, ctx);

  assert.equal(loopApi.get()?.status, "running");
  assert.equal(loopApi.get()?.message, "replacement work");
  assert.equal(loopApi.get()?.continuationCount, 1);
  assert.equal(pi.sentMessages.length, 1);
  assert.match(pi.sentMessages[0].message.content, /replacement work/);
});

test("provider failure details obey the configured reason cap", async () => {
  const { pi, ctx } = await setup([], { ...config, reasonMaxChars: 5 });
  await execute(pi, { action: "start", message: "work" });
  await pi.handlers.get("agent_end")(
    {
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "a provider failure message that is too long",
        },
      ],
    },
    ctx,
  );

  await pi.handlers.get("agent_settled")({}, ctx);

  assert.equal(loopApi.get()?.status, "stopped");
  assert.equal(loopApi.get()?.detail?.length, 5);
});

test("provider errors and aborts stop rather than continue", async () => {
  const first = await setup();
  await execute(first.pi, { action: "start", message: "work" });
  await first.pi.handlers.get("agent_end")(
    {
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "rate limit" },
      ],
    },
    first.ctx,
  );
  await first.pi.handlers.get("agent_settled")({}, first.ctx);
  assert.equal(loopApi.get()?.stopReason, "provider_error");
  assert.equal(first.pi.sentMessages.length, 0);

  const second = await setup();
  await execute(second.pi, { action: "start", message: "work" });
  await second.pi.handlers.get("agent_end")(
    { messages: [{ role: "assistant", stopReason: "aborted" }] },
    second.ctx,
  );
  await second.pi.handlers.get("agent_settled")({}, second.ctx);
  assert.equal(loopApi.get()?.stopReason, "aborted");
  assert.equal(second.pi.sentMessages.length, 0);
});

test("restoration is branch-scoped and normalizes running loops to stopped", async () => {
  const branch = [
    {
      type: "custom",
      customType: "loop-state",
      data: {
        generation: 2,
        loop: {
          id: "loop-2",
          generation: 2,
          status: "running",
          message: "restored work",
          limits: { maxContinuations: 3, maxActiveMinutes: 60 },
          continuationCount: 1,
          activeElapsedMs: 100,
          runningSince: 10,
          createdAt: 1,
          updatedAt: 20,
        },
      },
    },
  ];
  await setup(branch);

  assert.equal(loopApi.get()?.status, "stopped");
  assert.equal(loopApi.get()?.stopReason, "session_restored");
});

test("restoration clamps historical limits to current hard ceilings", async () => {
  const branch = [
    {
      type: "custom",
      customType: "loop-state",
      data: {
        generation: 2,
        loop: {
          id: "loop-2",
          generation: 2,
          status: "stopped",
          message: "restored work",
          limits: { maxContinuations: 99, maxActiveMinutes: 99 },
          continuationCount: 1,
          activeElapsedMs: 100,
          createdAt: 1,
          updatedAt: 20,
          stopReason: "user_stop",
        },
      },
    },
  ];
  await setup(branch, {
    ...config,
    hardMaxContinuations: 5,
    hardMaxActiveMinutes: 6,
  });

  assert.deepEqual(loopApi.get()?.limits, {
    maxContinuations: 5,
    maxActiveMinutes: 6,
  });
});

test("public API performs the same bounded mutations and publishes events", async () => {
  const { pi } = await setup();
  const observed: string[] = [];
  const unsubscribe = loopApi.subscribe((event) => observed.push(event.type));

  loopApi.start({ message: "API work", maxContinuations: 2 });
  loopApi.yield("wait");
  loopApi.stop("stop");
  loopApi.extend({ maxContinuations: 3 });
  loopApi.resume();
  loopApi.clear();
  unsubscribe();

  assert.deepEqual(observed, [
    "started",
    "yielded",
    "stopped",
    "extended",
    "resumed",
    "cleared",
  ]);
  assert.equal(loopApi.get(), undefined);
  assert.ok(
    pi.emittedEvents.some((event: any) => event.name === "loop:started"),
  );
  assert.ok(pi.entries.length >= 6);
});
