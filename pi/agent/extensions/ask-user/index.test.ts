import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
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
  askUser({
    registerTool: (def: any) => tools.set(def.name, def),
    events: { emit },
  } as any);
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
