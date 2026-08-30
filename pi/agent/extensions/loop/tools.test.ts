import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoopStore } from "./state.ts";
import { registerLoopTool } from "./tools.ts";

function makePi() {
  const tools = new Map<string, any>();
  const entries: Array<{ type: string; data: unknown }> = [];
  return {
    tools,
    entries,
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
  } as any;
}

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const config = {
  defaultMaxContinuations: 10,
  defaultMaxActiveMinutes: 60,
  hardMaxContinuations: 100,
  hardMaxActiveMinutes: 480,
  messageMaxChars: 100,
  reasonMaxChars: 100,
};

function setup() {
  const pi = makePi();
  const store = createLoopStore(() => 1);
  registerLoopTool(pi, store, () => config);
  const execute = (params: unknown) =>
    pi.tools.get("loop").execute("call-1", params, undefined, undefined, {});
  return { pi, store, execute };
}

test("loop tool advertises all lifecycle actions and snake_case limits", () => {
  const { pi } = setup();
  const tool = pi.tools.get("loop");

  assert.deepEqual(tool.parameters.properties.action.enum, [
    "get",
    "start",
    "yield",
    "stop",
    "resume",
    "extend",
    "clear",
  ]);
  assert.ok(tool.parameters.properties.max_continuations);
  assert.ok(tool.parameters.properties.max_active_minutes);
  assert.match(tool.promptGuidelines.join("\n"), /explicit/i);
});

test("renderCall uses an action-first summary without echoing the continuation message", () => {
  const { pi } = setup();
  const tool = pi.tools.get("loop");
  const render = (args: Record<string, unknown>) =>
    tool
      .renderCall(args, identityTheme, { lastComponent: undefined })
      .render(100)[0];

  assert.equal(
    render({
      action: "start",
      message: "A long or sensitive continuation message",
      max_continuations: 3,
      max_active_minutes: 5,
    }),
    "loop start · 3 continuations · 5m",
  );
  assert.equal(render({ action: "get" }), "loop get");
  assert.equal(
    render({ action: "yield", reason: "Need\n\u001b[31minput" }),
    "loop yield · Need input",
  );
  assert.equal(
    render({ action: "stop", reason: "Smoke test complete" }),
    "loop stop · Smoke test complete",
  );
  assert.equal(render({ action: "resume" }), "loop resume");
  assert.equal(
    render({ action: "extend", max_continuations: 10 }),
    "loop extend · 10 continuations",
  );
  assert.equal(render({ action: "clear" }), "loop clear");
});

test("renderResult shows compact state and expanded transition details", async () => {
  const { pi, execute } = setup();
  const tool = pi.tools.get("loop");
  const result = await execute({
    action: "start",
    message: "Keep going",
    max_continuations: 3,
    max_active_minutes: 5,
  });
  (result.details as any).loop.runningSince = Date.now();
  const context = {
    args: { action: "start" },
    lastComponent: undefined,
    isError: false,
  };

  const collapsed = tool
    .renderResult(
      result,
      { isPartial: false, expanded: false },
      identityTheme,
      context,
    )
    .render(100);
  const expanded = tool
    .renderResult(
      result,
      { isPartial: false, expanded: true },
      identityTheme,
      context,
    )
    .render(100);

  assert.deepEqual(collapsed, ["✓ running · 0/3 continuations · 5m left"]);
  assert.deepEqual(expanded, [
    "✓ running · 0/3 continuations · 5m left",
    "absent → running",
  ]);
});

test("renderResult keeps partial and semantic errors contextual and concise", () => {
  const { pi } = setup();
  const tool = pi.tools.get("loop");
  const context = {
    args: { action: "extend" },
    lastComponent: undefined,
    isError: false,
  };

  const partial = tool
    .renderResult(
      { content: [{ type: "text", text: "" }] },
      { isPartial: true, expanded: false },
      identityTheme,
      context,
    )
    .render(80);
  const error = tool
    .renderResult(
      {
        content: [
          {
            type: "text",
            text: "Error: max_continuations exceeds the configured ceiling. More state follows.",
          },
        ],
      },
      { isPartial: false, expanded: false },
      identityTheme,
      context,
    )
    .render(80);
  const frameworkError = tool
    .renderResult(
      {
        content: [
          {
            type: "text",
            text: "\u001b[31mTransport\nfailed",
          },
        ],
      },
      { isPartial: false, expanded: false },
      identityTheme,
      { ...context, isError: true },
    )
    .render(20);

  assert.deepEqual(partial, ["Extending loop..."]);
  assert.deepEqual(error, [
    "Error: max_continuations exceeds the configured ceiling. More state follows.",
  ]);
  assert.deepEqual(frameworkError, ["Transport"]);
});

test("start uses defaults and persists one shared loop", async () => {
  const { pi, store, execute } = setup();

  const result = await execute({ action: "start", message: "Keep going" });

  assert.match(result.content[0].text, /Loop \[running\] Keep going/);
  assert.equal(store.getLoop()?.limits.maxContinuations, 10);
  assert.equal(store.getLoop()?.limits.maxActiveMinutes, 60);
  assert.equal(pi.entries.length, 1);
  assert.equal(pi.entries[0].type, "loop-state");
});

test("tool validates action fields atomically", async () => {
  const { pi, store, execute } = setup();

  const result = await execute({
    action: "start",
    message: "work",
    reason: "unexpected",
    max_continuations: 101,
  });

  assert.match(result.content[0].text, /reason is not accepted for start/);
  assert.match(result.content[0].text, /configured ceiling of 100/);
  assert.equal(store.getLoop(), undefined);
  assert.equal(pi.entries.length, 0);
});

test("yield, wake-independent stop, extend, resume, get, and clear mutate correctly", async () => {
  const { pi, store, execute } = setup();
  await execute({ action: "start", message: "work", max_continuations: 2 });

  await execute({ action: "yield", reason: "Need input" });
  assert.equal(store.getLoop()?.status, "yielded");

  await execute({ action: "stop", reason: "Wait explicitly" });
  assert.equal(store.getLoop()?.status, "stopped");

  await execute({ action: "extend", max_continuations: 3 });
  assert.equal(store.getLoop()?.limits.maxContinuations, 3);
  assert.equal(store.getLoop()?.status, "stopped");

  await execute({ action: "resume" });
  assert.equal(store.getLoop()?.status, "running");

  const beforeGet = pi.entries.length;
  const get = await execute({ action: "get" });
  assert.match(get.content[0].text, /Loop \[running\]/);
  assert.equal(pi.entries.length, beforeGet);

  await execute({ action: "clear" });
  assert.equal(store.getLoop(), undefined);
});

test("resume cannot bypass an exhausted budget", async () => {
  const { store, execute } = setup();
  await execute({ action: "start", message: "work", max_continuations: 1 });
  store.claimContinuation();
  store.stop("agent_stop", "done", 100);

  const result = await execute({ action: "resume" });

  assert.match(result.content[0].text, /extend it before resuming/);
  assert.equal(store.getLoop()?.status, "stopped");
});
