import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import askUser from "./index.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function registerAskUser(
  tools: Map<string, any>,
  emit: (channel: string, data: unknown) => void = () => {},
): void {
  const previous = process.env.PI_ASK_USER_MODE;
  delete process.env.PI_ASK_USER_MODE;
  try {
    askUser({
      registerTool: (def: any) => tools.set(def.name, def),
      events: { emit },
    } as any);
  } finally {
    if (previous !== undefined) process.env.PI_ASK_USER_MODE = previous;
  }
}

test("custom UI wraps long question text instead of truncating it", async () => {
  const tools = new Map<string, any>();
  registerAskUser(tools);

  let renderedLines: string[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      async custom(factory: any) {
        const component = factory(
          { requestRender: () => {} },
          identityTheme,
          {},
          () => {},
        );
        renderedLines = component.render(36);
        return null;
      },
    },
  };

  await tools.get("ask_user").execute(
    "call-1",
    {
      question:
        "Which implementation path should we choose for wrapping long ask_user questions correctly?",
      options: [{ label: "A" }, { label: "B" }],
    },
    undefined,
    undefined,
    ctx,
  );

  assert.ok(renderedLines.some((line) => line.includes("wrapping long")));
  assert.ok(
    renderedLines.some((line) => line.includes("questions correctly?")),
  );
  const questionLines = renderedLines.slice(1, renderedLines.indexOf(""));
  assert.ok(
    questionLines.every((line) => !line.includes("...")),
    "wrapped question should not be ellipsized",
  );
});

test("ask_user reports Herdr blocked state only while the custom UI is open", async () => {
  const tools = new Map<string, any>();
  const events: Array<{ channel: string; data: unknown }> = [];
  registerAskUser(tools, (channel, data) => events.push({ channel, data }));

  let closeUI!: (value: null) => void;
  const ctx = {
    hasUI: true,
    ui: {
      custom() {
        return new Promise<null>((resolve) => {
          closeUI = resolve;
        });
      },
    },
  };

  const execution = tools.get("ask_user").execute(
    "call-1",
    {
      question: "Choose a path",
      options: [{ label: "A" }, { label: "B" }],
    },
    undefined,
    undefined,
    ctx,
  );

  assert.deepEqual(events, [
    {
      channel: "herdr:blocked",
      data: { active: true, label: "Waiting for user answer" },
    },
  ]);

  closeUI(null);
  await execution;

  assert.deepEqual(events, [
    {
      channel: "herdr:blocked",
      data: { active: true, label: "Waiting for user answer" },
    },
    { channel: "herdr:blocked", data: { active: false } },
  ]);
});

test("ask_user clears Herdr blocked state when the custom UI throws", async () => {
  const tools = new Map<string, any>();
  const events: Array<{ channel: string; data: unknown }> = [];
  registerAskUser(tools, (channel, data) => events.push({ channel, data }));

  const ctx = {
    hasUI: true,
    ui: {
      async custom() {
        throw new Error("render failed");
      },
    },
  };

  await assert.rejects(
    tools.get("ask_user").execute(
      "call-1",
      {
        question: "Choose a path",
        options: [{ label: "A" }, { label: "B" }],
      },
      undefined,
      undefined,
      ctx,
    ),
    /render failed/,
  );

  assert.deepEqual(events, [
    {
      channel: "herdr:blocked",
      data: { active: true, label: "Waiting for user answer" },
    },
    { channel: "herdr:blocked", data: { active: false } },
  ]);
});

test("ask_user resolves as cancelled when the tool signal aborts", async () => {
  const tools = new Map<string, any>();
  registerAskUser(tools);

  const controller = new AbortController();
  const ctx = {
    hasUI: true,
    ui: {
      custom(factory: any) {
        return new Promise((resolve) => {
          factory({ requestRender: () => {} }, identityTheme, {}, resolve);
          controller.abort();
        });
      },
    },
  };

  const result = await Promise.race([
    tools.get("ask_user").execute(
      "call-1",
      {
        question: "Choose a path",
        options: [{ label: "A" }, { label: "B" }],
      },
      controller.signal,
      undefined,
      ctx,
    ),
    delay(50).then(() => "timeout"),
  ]);

  assert.notEqual(result, "timeout");
  assert.equal((result as any).details.cancelled, true);
});

test("custom UI rewraps question text when render width changes", async () => {
  const tools = new Map<string, any>();
  registerAskUser(tools);

  let component: { render(width: number): string[] };
  const ctx = {
    hasUI: true,
    ui: {
      async custom(factory: any) {
        component = factory(
          { requestRender: () => {} },
          identityTheme,
          {},
          () => {},
        );
        component.render(80);
        const narrowLines = component.render(36);
        assert.ok(
          narrowLines.every((line) => visibleWidth(line) <= 36),
          "rerendered lines must fit the latest width",
        );
        return null;
      },
    },
  };

  await tools.get("ask_user").execute(
    "call-1",
    {
      question:
        "Which implementation path should we choose for wrapping long ask_user questions correctly?",
      options: [{ label: "A" }, { label: "B" }],
    },
    undefined,
    undefined,
    ctx,
  );
});

for (const disposition of [
  "answered",
  "custom",
  "cancelled",
  "aborted",
  "failed",
  "sync-failed",
] as const) {
  test(`input events correlate a real wait: ${disposition}`, async () => {
    const events = createEventBus();
    const observed: Array<{ channel: string; data: any }> = [];
    for (const channel of [
      "ask-user:input_requested",
      "ask-user:input_resolved",
      "herdr:blocked",
    ])
      events.on(channel, (data) => observed.push({ channel, data }));
    const tools = new Map<string, any>();
    registerAskUser(tools, events.emit);
    const controller = new AbortController();
    let component: any;
    let rejectUI!: (error: Error) => void;
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        custom(factory: any) {
          return new Promise((resolve, reject) => {
            rejectUI = reject;
            component = factory(
              { requestRender() {} },
              identityTheme,
              {},
              resolve,
            );
            if (disposition === "sync-failed")
              throw new Error("private rendering error");
          });
        },
      },
    };
    const execution = tools.get("ask_user").execute(
      "private-tool-id",
      {
        question: "private question",
        context: "private context",
        options: [{ label: "private A" }, { label: "private B" }],
      },
      controller.signal,
      undefined,
      ctx,
    );
    const requested = observed.find(
      (e) => e.channel === "ask-user:input_requested",
    )!.data;
    assert.deepEqual(Object.keys(requested), ["requestId"]);
    assert.match(requested.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(
      observed.some((e) => e.channel === "ask-user:input_resolved"),
      false,
    );
    if (disposition === "failed") rejectUI(new Error("private raw error"));
    else if (disposition === "aborted") controller.abort();
    else if (disposition === "cancelled") component.handleInput("\x1b");
    else if (disposition === "answered") component.handleInput("\r");
    else if (disposition === "custom") {
      component.handleInput("\x1b[B");
      component.handleInput("\x1b[B");
      component.handleInput("\r");
      component.handleInput("private free text");
      component.handleInput("\r");
    }
    const failed = disposition === "failed" || disposition === "sync-failed";
    if (failed) await assert.rejects(execution, /private/);
    else {
      const result = await execution;
      assert.equal(
        result.details.cancelled,
        ["cancelled", "aborted"].includes(disposition),
      );
    }
    const resolved = observed.filter(
      (e) => e.channel === "ask-user:input_resolved",
    );
    assert.deepEqual(resolved, [
      {
        channel: "ask-user:input_resolved",
        data: {
          requestId: requested.requestId,
          outcome: failed
            ? "failed"
            : ["cancelled", "aborted"].includes(disposition)
              ? "cancelled"
              : "answered",
        },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(observed), /private/);
    assert.deepEqual(
      observed
        .filter((e) => e.channel === "herdr:blocked")
        .map((e) => e.data.active),
      [true, false],
    );
  });
}

test("no input event for validation, unavailable custom UI, pre-abort, or failure before waiting", async () => {
  for (const kind of [
    "invalid",
    "headless",
    "rpc",
    "aborted",
    "throw",
  ] as const) {
    const events = createEventBus();
    const observed: unknown[] = [];
    events.on("ask-user:input_requested", (data) => observed.push(data));
    events.on("ask-user:input_resolved", (data) => observed.push(data));
    const tools = new Map<string, any>();
    registerAskUser(tools, events.emit);
    const controller = new AbortController();
    if (kind === "aborted") controller.abort();
    const execution = tools.get("ask_user").execute(
      "id",
      {
        question: "Choose",
        options: [{ label: "A" }, { label: kind === "invalid" ? "A" : "B" }],
      },
      controller.signal,
      undefined,
      {
        hasUI: kind !== "headless",
        ui: {
          custom() {
            if (kind === "throw") throw new Error("unavailable");
            return Promise.resolve(undefined);
          },
        },
      },
    );
    if (kind === "throw") await assert.rejects(execution, /unavailable/);
    else await execution;
    assert.deepEqual(observed, []);
  }
});
