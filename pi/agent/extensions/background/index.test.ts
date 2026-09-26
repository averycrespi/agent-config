import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fixture, echo } from "../script/fixture.ts";
import script from "../script/index.ts";
import background, { widgetLines, NOTIFICATION } from "./index.ts";
import { getBackgroundService } from "./api.ts";
import { fileStore, STORE_SUFFIX } from "./store.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function harness(t: any, methods?: any) {
  let shutdown = async () => {};
  t.after(() => shutdown());
  const f = await fixture(t, methods);
  const handlers = new Map<string, any[]>(),
    tools = new Map<string, any>(),
    renderers = new Map<string, any>(),
    commands = new Map<string, any>(),
    messages: any[] = [],
    events: any[] = [];
  let idle = false,
    draft = "",
    mounts = 0,
    paints = 0,
    component: any;
  const theme: any = {
    fg: (_: string, s: string) => s,
    bold: (s: string) => s,
    bg: (_: string, s: string) => s,
  };
  const ctx: any = {
    cwd: f.dir,
    mode: "tui",
    hasUI: true,
    isIdle: () => idle,
    hasPendingMessages: () => false,
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => join(f.dir, "session.jsonl"),
      getLeafId: () => "anchor",
      getBranch: () => [{ id: "anchor" }],
    },
    ui: {
      theme,
      notify() {},
      getEditorText: () => draft,
      setEditorText: () => assert.fail("must not edit drafts"),
      setWidget: (_: string, content: any) => {
        if (typeof content === "function") {
          mounts++;
          component = content({ requestRender: () => paints++ }, theme);
        } else if (content === undefined) {
          component?.dispose();
          component = undefined;
        }
      },
    },
  };
  const pi: any = {
    ...f.pi,
    on: (name: string, fn: any) =>
      handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    registerCommand: (name: string, command: any) =>
      commands.set(name, command),
    registerMessageRenderer: (type: string, renderer: any) =>
      renderers.set(type, renderer),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    sendMessage: (m: any, options: any) => messages.push({ ...m, options }),
  };
  const hook = async (name: string, event = {}) => {
    for (const fn of handlers.get(name) ?? []) await fn(event, ctx);
  };
  background(pi);
  script(pi);
  pi.events.on("background:terminal", (e: any) => events.push(e));
  await hook("session_start");
  shutdown = () => hook("session_shutdown");
  const terminal = () =>
    new Promise<void>((resolve) => {
      const off = pi.events.on("background:terminal", () => {
        off();
        resolve();
      });
    });
  return {
    ...f,
    pi,
    ctx,
    hook,
    messages,
    events,
    renderers,
    commands,
    terminal,
    service: () => getBackgroundService(pi),
    call: (args: any) =>
      tools
        .get("script")
        .execute(
          "call",
          { description: "test", ...args },
          undefined,
          undefined,
          ctx,
        ),
    idle: () => {
      idle = true;
    },
    draft: (s: string) => {
      draft = s;
    },
    get mounts() {
      return mounts;
    },
    get paints() {
      return paints;
    },
    get component() {
      return component;
    },
  };
}
test("Script background returns stable persisted ID, remains responsive, automatically notifies and hides terminal widget on observed consumption", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await harness(t, {
    echo: {
      ...echo,
      handler: async () => {
        await gate;
        return { value: 42 };
      },
    },
  });
  const result = await h.call({
    action: "run",
    execution: "background",
    providers: ["fixture"],
    source: "return await fixture.echo(1);",
  });
  const id = result.details.records[0].id;
  assert.equal(h.service().inspect("script", id).status, "running");
  assert.match(
    readFileSync(h.ctx.sessionManager.getSessionFile() + STORE_SUFFIX, "utf8"),
    new RegExp(id),
  );
  // A second tool/user lifecycle is available while the executor is outstanding.
  assert.equal(
    (await h.call({ action: "run", providers: [], source: "return 2;" }))
      .details.status,
    "success",
  );
  const finished = h.terminal();
  release();
  await finished;
  await tick();
  assert.equal(h.messages.length, 0);
  h.idle();
  h.draft("human draft");
  await h.hook("agent_settled");
  assert.equal(h.messages.length, 0);
  h.draft("");
  await h.hook("agent_settled");
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].customType, NOTIFICATION);
  assert.equal(h.messages[0].options.triggerTurn, true);
  assert.equal(h.mounts, 1);
  assert.ok(h.paints > 0);
  assert.equal(h.service().inspect("script", id).notification.consumed, false);
  const message = h.messages[0];
  assert.equal(
    message.content,
    `Background script execution ${id}: success. Inspect with script action inspect and id ${id}. Effects may persist; reconcile unknown effects. This notification is not acceptance and never authorizes replay.`,
  );
  const before = JSON.stringify(h.service().inspect("script", id));
  const saved = readFileSync(
    h.ctx.sessionManager.getSessionFile() + STORE_SUFFIX,
    "utf8",
  );
  const original = JSON.stringify(message);
  for (const expanded of [false, true, false]) {
    const rendered = h.renderers
      .get(NOTIFICATION)(message, { expanded }, h.ctx.ui.theme)
      .render(80)
      .join("\n");
    assert.match(rendered, /script succeeded/);
    assert.equal(rendered.includes("never authorizes replay"), expanded);
  }
  assert.equal(JSON.stringify(message), original);
  assert.equal(JSON.stringify(h.service().inspect("script", id)), before);
  assert.equal(
    readFileSync(h.ctx.sessionManager.getSessionFile() + STORE_SUFFIX, "utf8"),
    saved,
  );
  assert.equal(h.messages.length, 1);
  await h.hook("context", { messages: [{ ...h.messages[0], role: "custom" }] });
  await h.hook("after_provider_response", { status: 200 });
  assert.equal(h.service().inspect("script", id).notification.consumed, true);
  assert.equal(h.events.length, 1);
  // Compare the payload contract, not substrings that may occur in opaque UUIDs.
  assert.deepEqual(h.events[0], {
    id,
    owner: "script",
    status: "success",
    notificationId: h.messages[0].details.notificationId,
    handoff: "none",
    consumed: false,
  });
});
test("terminal widget expiry retains disk state and delayed notifications across restoration", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.now() });
  const h = await harness(t);
  const finished = h.terminal();
  const r = h.service().admit({
    owner: "script",
    label: "retained",
    deadlineMs: Date.now() + 60000,
    run: async () => ({
      status: "failed",
      effectsMayPersist: true,
      outcomeUnknown: true,
      result: { evidence: 42 },
    }),
  });
  await finished;
  await tick();
  const before = h.service().inspect("script", r.id);
  const path = h.ctx.sessionManager.getSessionFile() + STORE_SUFFIX;
  const disk = readFileSync(path, "utf8");
  assert.match(h.component.render(100).join(""), /script failed/);
  t.mock.timers.tick(14000);
  assert.ok(h.component);
  t.mock.timers.tick(1000);
  assert.equal(h.component, undefined);
  assert.deepEqual(h.service().inspect("script", r.id), before);
  assert.equal(readFileSync(path, "utf8"), disk);
  assert.equal(h.messages.length, 0);
  assert.equal(h.events.length, 1);
  await h.hook("session_tree");
  assert.equal(h.component, undefined);
  assert.deepEqual(h.service().inspect("script", r.id), before);
  h.idle();
  await h.hook("agent_settled");
  assert.equal(h.messages.length, 1);
  assert.equal(h.component, undefined);
  assert.deepEqual(h.service().inspect("script", r.id).result, {
    evidence: 42,
  });
  await h.hook("session_shutdown");
  const paints = h.paints;
  t.mock.timers.tick(20000);
  assert.equal(h.paints, paints);
  assert.equal(h.messages.length, 1);
});

test("RPC rows keep running work visible and expire terminal rows without model turns", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.now() });
  const h = await harness(t);
  h.ctx.mode = "rpc";
  let rows: string[] | undefined;
  h.ctx.ui.setWidget = (_key: string, content: string[] | undefined) => {
    rows = content;
  };
  await h.hook("session_tree");
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const finished = h.terminal();
  h.service().admit({
    owner: "subagents",
    label: "RPC child",
    deadlineMs: Date.now() + 60000,
    run: async () => {
      await gate;
      return {
        status: "success",
        effectsMayPersist: false,
        outcomeUnknown: false,
      };
    },
  });
  await tick();
  t.mock.timers.tick(20000);
  assert.match(rows!.join(""), /running RPC child.*20s/);
  finish();
  await finished;
  await tick();
  assert.match(rows!.join(""), /succeeded RPC child/);
  t.mock.timers.tick(15000);
  assert.equal(rows, undefined);
  assert.equal(h.messages.length, 0);
});

test("widget settings load per session and config inspection does not mutate receipts", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.now() });
  const h = await harness(t);
  writeFileSync(
    join(h.dir, "settings.json"),
    JSON.stringify({
      "extension:background": {
        widgets: { autoHide: false, terminalHideAfterMs: 1000 },
      },
    }),
  );
  await h.hook("session_tree");
  const finished = h.terminal();
  const r = h.service().admit({
    owner: "workflow",
    label: "visible",
    deadlineMs: Date.now() + 60000,
    run: async () => ({
      status: "success",
      effectsMayPersist: false,
      outcomeUnknown: false,
    }),
  });
  await finished;
  await tick();
  t.mock.timers.tick(16000);
  assert.match(h.component.render(100).join(""), /workflow succeeded/);
  const before = h.service().inspect("workflow", r.id);
  let output = "";
  await h.commands.get("background-config").handler("", {
    ...h.ctx,
    ui: {
      notify: (text: string) => {
        output = text;
      },
    },
  });
  assert.match(output, /"autoHide": false/);
  assert.deepEqual(h.service().inspect("workflow", r.id), before);
  writeFileSync(
    join(h.dir, "settings.json"),
    JSON.stringify({
      "extension:background": { widgets: { terminalHideAfterMs: 20000 } },
    }),
  );
  await h.hook("session_tree");
  assert.ok(h.component);
  t.mock.timers.tick(4000);
  assert.equal(h.component, undefined);
});

test("provider revocation, explicit cancellation, timeout and guest failure retain existing executor accounting", async (t) => {
  const h = await harness(t, {
    echo: {
      ...echo,
      handler: async (_: any, { signal }: any) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("aborted")), {
            once: true,
          }),
        ),
    },
  });
  const done = h.terminal();
  const r = await h.call({
    action: "run",
    execution: "background",
    providers: ["fixture"],
    source: "return await fixture.echo(1);",
  });
  h.dispose();
  await done;
  assert.equal(
    h.service().inspect("script", r.details.records[0].id).status,
    "cancelled",
  );
  for (const mode of ["cancel", "timeout", "failed"] as const) {
    await h.config({
      allowedProviders: [],
      timeoutMs: mode === "timeout" ? 30 : 2000,
    });
    const finished = h.terminal();
    const admitted = await h.call({
      action: "run",
      execution: "background",
      providers: [],
      source: mode === "failed" ? "throw Error('private');" : "while(true){}",
    });
    const id = admitted.details.records[0].id;
    if (mode === "cancel") await h.call({ action: "cancel", id });
    await finished;
    assert.equal(
      h.service().inspect("script", id).status,
      mode === "cancel" ? "cancelled" : mode,
    );
  }
});
test("missing service, invalid source/policy and corrupt storage never admit; distinct sidecar ignores observer entries", async (t) => {
  assert.throws(
    () => getBackgroundService({ events: { emit() {} } } as any),
    /unavailable/,
  );
  const h = await harness(t);
  await assert.rejects(
    h.call({
      action: "run",
      execution: "background",
      providers: [],
      source: " ",
    }),
    /invalid_source/,
  );
  await assert.rejects(
    h.call({
      action: "run",
      execution: "background",
      providers: ["denied"],
      source: "return null",
    }),
    /capability_denied/,
  );
  assert.equal(h.service().list("script").length, 0);
  const path = join(h.dir, "other.jsonl");
  writeFileSync(
    path,
    JSON.stringify({
      customType: "background:receipt-v1",
      data: { id: "old" },
    }),
  );
  assert.deepEqual(fileStore(path).read(), []);
  writeFileSync(path + STORE_SUFFIX, "{broken");
  assert.throws(() => fileStore(path).read());
});
test("hostile labels and every narrow width are safe; dismissal retains full result", async (t) => {
  const h = await harness(t);
  const done = h.terminal();
  const r = await h.call({
    action: "run",
    execution: "background",
    description: "hostile\x1b]52;c;secret\x07\n宽字符",
    providers: [],
    source: "return 42",
  });
  await done;
  const records = h.service().list("script");
  records[0].progress = { completed: 2, total: 3, failed: 1 };
  assert.match(
    widgetLines(records, 120, h.ctx.ui.theme)[0],
    /2\/3 settled, 1 unsuccessful/,
  );
  assert.equal(widgetLines(records, 120, h.ctx.ui.theme).length, 1);
  for (let width = 0; width < 100; width++)
    for (const line of widgetLines(records, width, h.ctx.ui.theme)) {
      assert.ok(visibleWidth(line) <= width);
      assert.doesNotMatch(stripVTControlCharacters(line), /\n|\x1b|secret/);
    }
  await h.call({ action: "dismiss", id: r.details.records[0].id });
  assert.deepEqual(
    widgetLines(h.service().list("script"), 80, h.ctx.ui.theme),
    [],
  );
  assert.equal(
    (h.service().inspect("script", records[0].id).result as any).json,
    "42",
  );
});
