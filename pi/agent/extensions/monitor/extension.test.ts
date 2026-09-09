import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { createLoopExtension } from "../loop/index.ts";
import { DEFAULT_LOOP_CONFIG } from "../loop/config.ts";
import { validateToolArguments } from "@earendil-works/pi-ai";
import registerMonitor from "./index.ts";
import { fixture, TEST_BEARER } from "../mcp-gateway/fixture.ts";
import { createGatewayAccess } from "../mcp-gateway/api.ts";
import { parseConfig, loadMonitorConfig } from "./config.ts";
import {
  PARAMETERS,
  renderers,
  widgetLines,
  WidgetObservations,
} from "./tool.ts";
import {
  restoreReceipts,
  RECEIPT_TYPE,
  readReceiptBranch,
  MAX_RECOVERY_ENTRIES,
} from "./receipts.ts";

const theme: any = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
const input = {
  action: "start",
  name: "example",
  description: "Observe fixture",
  message: "Report fixture",
  source: 'return {decision:"notify", evidence:{answer:42}};',
};
async function setup(t: any, hasUI = false, mode = "print") {
  const f = await fixture(t);
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.PI_CODING_AGENT_DIR = f.dir;
  const handlers = new Map<string, Function>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const messages: any[] = [],
    entries: any[] = [],
    widgets: any[] = [],
    notices: string[] = [];
  let messageResolve!: () => void;
  const received = new Promise<void>((r) => (messageResolve = r));
  const ctx: any = {
    cwd: f.dir,
    hasUI,
    mode,
    isIdle: () => true,
    sessionManager: {
      getBranch: () => {
        throw new Error("Unbounded branch access is forbidden");
      },
      getLeafId: () => entries.at(-1)?.id ?? null,
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
    ui: {
      theme,
      setWidget: (...args: any[]) => widgets.push(args),
      notify: (s: string) => notices.push(s),
    },
  };
  const pi: any = {
    on: (e: string, fn: Function) => handlers.set(e, fn),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) =>
      commands.set(name, command),
    events: {
      emit(_e: string, r: any) {
        r.accept(createGatewayAccess(f.client));
      },
    },
    appendEntry: (customType: string, data: unknown) =>
      entries.push({
        id: String(entries.length),
        parentId: entries.at(-1)?.id ?? null,
        type: "custom",
        customType,
        data,
      }),
    sendMessage: (...args: unknown[]) => {
      messages.push(args);
      messageResolve();
    },
  };
  registerMonitor(pi);
  const emit = (name: string) => handlers.get(name)?.({}, ctx);
  t.after(() => emit("session_shutdown"));
  await emit("session_start");
  const run = (args: unknown) =>
    tools.get("monitor").execute("fixture", args, undefined, undefined, ctx);
  return {
    f,
    ctx,
    handlers,
    tools,
    commands,
    messages,
    entries,
    widgets,
    notices,
    received,
    run,
    emit,
  };
}

test("monitor guidance distinguishes observation, continuation, and terminal attention", async (t) => {
  const h = await setup(t);
  const tool = h.tools.get("monitor");
  const guidance = [tool.description, ...tool.promptGuidelines].join("\n");
  assert.match(
    guidance,
    /only for explicitly requested session-bound monitoring/,
  );
  assert.match(
    guidance,
    /Prefer it over recurring agent turns for gateway conditions expressible as deterministic checks/,
  );
  assert.match(
    guidance,
    /loop remains model continuation and code remains one short-lived execution/,
  );
  assert.match(guidance, /not a detached service/);
  assert.match(
    guidance,
    /stop on shutdown, reload, or session\/branch navigation and do not automatically resume/,
  );
  assert.match(
    guidance,
    /notify means attention is needed, not that the task succeeded/,
  );
  assert.match(guidance, /authority covering repeated mutations/);
  assert.match(
    guidance,
    /Never automatically request grants or replay uncertain observations/,
  );
  assert.equal(h.messages.length, 0);
});

test("one meta-tool and direct commands; idle/active terminal delivery uses followUp without steering", async (t) => {
  for (const idle of [true, false])
    await t.test(String(idle), async (t) => {
      const h = await setup(t, true, "tui");
      h.ctx.isIdle = () => idle;
      assert.deepEqual([...h.tools.keys()], ["monitor"]);
      assert.deepEqual([...h.commands.keys()].sort(), [
        "monitor",
        "monitor-cancel",
        "monitor-config",
      ]);
      const r = await h.run(input);
      assert.equal(r.details.monitorError, undefined);
      await h.received;
      assert.equal(h.messages.length, 1);
      assert.deepEqual(h.messages[0][1], {
        deliverAs: "followUp",
        triggerTurn: true,
      });
      assert.match(h.messages[0][0].content, /UNTRUSTED MONITOR EVIDENCE/);
      assert.match(h.messages[0][0].content, /answer/);
      assert.doesNotMatch(h.messages[0][0].content, /return \{/);
      assert.ok(h.widgets.every((w) => w[2].placement === "belowEditor"));
      assert.equal(h.widgets.at(-1)[1], undefined);
      const before = h.messages.length;
      await h.commands.get("monitor").handler("", h.ctx);
      await h.commands.get("monitor").handler(r.details.receipts[0].id, h.ctx);
      await h.commands.get("monitor-cancel").handler("all", h.ctx);
      assert.equal(h.messages.length, before);
      assert.match(h.notices.at(-1)!, /cannot be selectively retracted/);
    });
});

test("TUI and RPC widgets show all active monitors and clear after cancellation and recovery", async (t) => {
  for (const mode of ["tui", "rpc"])
    await t.test(mode, async (t) => {
      const h = await setup(t, true, mode);
      const lines = () => {
        const value = h.widgets.at(-1)[1];
        return typeof value === "function"
          ? value({ requestRender() {} }, theme).render(100)
          : value;
      };
      assert.equal(lines(), undefined);
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const result = await h.run({
          ...input,
          name: `active-${i}`,
          source: 'return {decision:"wait",evidence:null};',
        });
        ids.push(result.details.receipts[0].id);
      }
      assert.equal(lines().length, 4);
      for (let i = 0; i < 4; i++)
        assert.match(lines()[i], new RegExp(`^monitor active · active-${i}`));
      await h.run({ action: "cancel", id: ids[0] });
      assert.equal(lines().length, 3);
      assert.ok(lines().every((line: string) => !line.includes("active-0")));
      await h.run({ action: "cancel", id: "all" });
      assert.equal(lines(), undefined);
      assert.equal(
        (await h.run({ action: "list" })).details.receipts.length,
        4,
      );
      await h.emit("session_start");
      assert.equal(lines(), undefined);
      assert.equal(
        (await h.run({ action: "list" })).details.receipts.length,
        4,
      );
      assert.equal(h.messages.length, 0);
    });
});

test("pending polling, headless control, invalid requests and concurrent duplicate registrations", async (t) => {
  const h = await setup(t);
  const starts = await Promise.all([
    h.run({ ...input, source: 'return {decision:"wait",evidence:null};' }),
    h.run({ ...input, source: 'return {decision:"wait",evidence:null};' }),
  ]);
  assert.equal(starts.filter((r) => !r.details.monitorError).length, 1);
  const id = starts.find((r) => !r.details.monitorError)!.details.receipts[0]
    .id;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(h.messages.length, 0);
  assert.equal(h.widgets.length, 0);
  const before = h.entries.length;
  for (const args of [
    { action: "oops" },
    { action: "list", source: "forbidden" },
    { action: "get" },
    { action: "cancel", id: "missing" },
    { ...input, interval_ms: Infinity },
  ])
    assert.equal((await h.run(args)).details.monitorError, true);
  assert.equal(h.entries.length, before);
  await h.run({ action: "cancel", id });
  assert.equal(h.messages.length, 0);
  assert.equal(
    (await h.run({ action: "get", id })).details.receipts[0].state,
    "cancelled",
  );
});

test("navigation invalidates in-flight registration, does not mutate prepared branch, and restores without restart", async (t) => {
  const h = await setup(t);
  const pending = h.run(input);
  await h.emit("session_before_tree");
  assert.equal((await pending).details.monitorError, true);
  assert.equal(h.entries.length, 0);
  await h.emit("session_tree");
  const started = await h.run({
    ...input,
    source: 'return {decision:"wait",evidence:null};',
  });
  const id = started.details.receipts[0].id;
  const count = h.entries.length;
  await h.emit("session_before_tree");
  assert.equal(h.entries.length, count);
  await h.emit("session_tree");
  assert.equal(
    (await h.run({ action: "get", id })).details.receipts[0].state,
    "invalidated",
  );
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(h.messages.length, 0);
  await h.emit("session_shutdown");
  await h.emit("session_start");
  assert.equal(
    (await h.run({ action: "get", id })).details.receipts[0].state,
    "invalidated",
  );
});

test("missing gateway and invalid configuration fail closed without registration", async (t) => {
  const h = await setup(t);
  for (const value of [
    "{",
    "[]",
    '{"extension:monitor":null}',
    '{"extension:monitor":{"maxActive":null}}',
  ]) {
    await writeFile(join(h.f.dir, "settings.json"), value);
    assert.equal((await loadMonitorConfig(h.f.dir)).valid, false);
    await h.emit("session_start");
    assert.equal((await h.run(input)).details.monitorError, true);
  }
  assert.equal(h.entries.length, 0);
  for (const value of [0, -1, Infinity, NaN, "", "oops", 17, 1.5, null])
    assert.equal(parseConfig({ maxActive: value }, {}).valid, false);
  assert.equal(
    parseConfig({ maxActive: 2 }, { MONITOR_MAX_ACTIVE: "3" }).maxActive,
    3,
  );
});

test("recovery bounds both ancestry lookup and receipt examination, omitting older history", async (t) => {
  const h = await setup(t);
  await h.run(input);
  await h.received;
  const receipt = h.entries.at(-1)!;
  let lookups = 0;
  const branch = readReceiptBranch({
    getLeafId: () => String(MAX_RECOVERY_ENTRIES * 2),
    getEntry: (id: string) => {
      lookups++;
      return { ...receipt, id, parentId: String(Number(id) - 1) };
    },
  });
  assert.equal(lookups, MAX_RECOVERY_ENTRIES);
  assert.equal(branch.length, MAX_RECOVERY_ENTRIES);
  assert.equal(restoreReceipts(branch, 16).length, 1);
  const old = new Proxy(receipt, {
    get() {
      throw new Error("old history must not be inspected");
    },
  });
  assert.deepEqual(
    restoreReceipts(
      [
        old,
        ...Array.from({ length: MAX_RECOVERY_ENTRIES }, () => ({
          type: "message",
        })),
      ],
      16,
    ),
    [],
  );
});

test("Loop and Monitor refresh in place without changing Pi widget order", async (t) => {
  const h = await setup(t, true, "tui");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const host: any = Object.create(InteractiveMode.prototype);
  host.extensionWidgetsAbove = new Map();
  host.extensionWidgetsBelow = new Map();
  host.widgetContainerAbove = new Container();
  host.widgetContainerBelow = new Container();
  let renders = 0;
  host.ui = {
    requestRender: () => {
      renders++;
    },
  };
  h.ctx.ui.setWidget = (key: string, content: any, options: any) =>
    host.setExtensionWidget(
      key,
      typeof content === "function"
        ? (tui: any) => content(tui, theme)
        : content,
      options,
    );
  const loopHandlers = new Map<string, any>();
  const loopTools = new Map<string, any>();
  const ctx = {
    ...h.ctx,
    sessionManager: { getBranch: () => [] },
    hasPendingMessages: () => false,
  };
  let loopTick!: () => void;
  createLoopExtension({
    loadConfig: async () => ({ config: DEFAULT_LOOP_CONFIG, warnings: [] }),
    wait: (_ms, signal) =>
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    setInterval: (callback) => {
      loopTick = callback;
      return 1;
    },
    clearInterval() {},
  })({
    on: (event: string, handler: any) => loopHandlers.set(event, handler),
    registerCommand() {},
    registerTool: (tool: any) => loopTools.set(tool.name, tool),
    appendEntry() {},
    events: { emit() {} },
    sendMessage() {
      throw new Error("Cancelled smoke fixture must not send");
    },
  } as any);
  t.after(() => loopHandlers.get("session_shutdown")({}, ctx));
  await loopHandlers.get("session_start")({}, ctx);
  await h.run({ ...input, source: 'return {decision:"wait",evidence:null};' });
  await loopTools
    .get("loop")
    .execute(
      "fixture",
      { action: "start", message: "fixture", delay_seconds: 60 },
      undefined,
      undefined,
      ctx,
    );
  void loopHandlers.get("agent_settled")({}, ctx);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const order = [...host.extensionWidgetsBelow.keys()];
  assert.deepEqual(order, ["monitor", "loop"]);
  const components = [...host.extensionWidgetsBelow.values()];
  const before = renders;
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(1000);
    assert.deepEqual([...host.extensionWidgetsBelow.keys()], order);
    loopTick();
    assert.deepEqual([...host.extensionWidgetsBelow.values()], components);
  }
  assert.ok(renders > before, "updates still request repaint");
  assert.equal(host.widgetContainerBelow.children.length, 2);
});

test("widget countdowns round up and observing appears only for sustained polls", async (t) => {
  const h = await setup(t);
  await h.run(input);
  await h.received;
  const base = restoreReceipts(h.entries, 16)[0];
  const waiting = {
    ...base,
    state: "waiting" as const,
    deadline: 60_001,
    nextAt: 1000,
  };
  const observations = new WidgetObservations();
  const render = (r: typeof base, now: number) =>
    widgetLines([r], now, 200, theme, observations)[0];
  assert.match(render(waiting, 1), /^monitor active · .* · next 1s · 1m left/);
  assert.match(render(waiting, 999), / · next 1s/);
  assert.match(render(waiting, 1000), / · next 0s/);
  assert.match(render(waiting, 61_000), /next 0s · 0s left/);
  assert.match(render({ ...waiting, nextAt: 60_001 }, 0), /next 1m 1s/);

  const polling = { ...waiting, state: "observing" as const, polls: 2 };
  observations.update([polling], 1000);
  assert.match(render(polling, 1040), /^monitor active · /);
  assert.doesNotMatch(render(polling, 1040), /next|observing/);
  observations.update([polling], 2000);
  assert.match(render(polling, 2999), /^monitor active · /);
  assert.match(render(polling, 3000), /^monitor observing · /);
  observations.update([waiting], 3100);
  assert.match(render(waiting, 3100), /^monitor active · /);
  observations.update([polling], 3200);
  assert.match(render(polling, 3200), /^monitor active · /);
  const nextPoll = { ...polling, polls: 3 };
  observations.update([nextPoll], 6000);
  assert.match(render(nextPoll, 6000), /^monitor active · /);
  observations.update([], 7000);
  observations.update([nextPoll], 9000);
  assert.match(render(nextPoll, 9000), /^monitor active · /);
});

test("published schema, bounded restore, compact expandable rendering and hostile narrow widgets", async (t) => {
  const h = await setup(t);
  validateToolArguments(
    { name: "monitor", description: "Monitor", parameters: PARAMETERS },
    { type: "toolCall", id: "schema", name: "monitor", arguments: input },
  );
  await h.run(input);
  await h.received;
  const r = restoreReceipts(h.entries, 16)[0];
  assert.equal(r.notification, "handed_to_pi");
  assert.deepEqual(
    restoreReceipts(
      [
        {
          type: "custom",
          customType: RECEIPT_TYPE,
          data: { ...r, source: "secret" },
        },
      ],
      16,
    ),
    [],
  );
  const hostile = {
    ...r,
    state: "waiting" as const,
    notification: "none" as const,
    name: `\x1b]52;c;evil\x07a\n${TEST_BEARER}\u202e`,
    evidence: "PAYLOAD_SECRET",
  };
  for (const width of [0, 1, 7, 20, 100]) {
    const lines = widgetLines(
      [hostile, r, { ...r, state: "observing", name: "other" }],
      Date.now(),
      width,
      theme,
    );
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width);
      assert.doesNotMatch(
        line.replaceAll("\x1b[0m", ""),
        /\x1b|\x07|\n|mgw_agent_|PAYLOAD_SECRET/,
      );
    }
  }
  const styled = widgetLines(
    [
      {
        ...hostile,
        name: "Build checks",
        failures: 1,
        failureLimit: 3,
        nextAt: 12000,
        deadline: 60000,
      },
    ],
    0,
    1000,
    {
      fg: (color, text) => `<${color}>${text}</${color}>`,
    },
  );
  assert.deepEqual(styled, [
    "<muted>monitor</muted> <accent>active</accent><dim> · </dim><text>Build checks</text><dim> · </dim><warning>failures 1/3</warning><dim> · </dim><muted>next </muted><text>12s</text><dim> · </dim><text>1m</text><muted> left</muted>",
  ]);
  const narrow = widgetLines(
    [
      {
        ...hostile,
        name: "A long monitor name repeated".repeat(3),
        failures: 1,
        failureLimit: 3,
        nextAt: 12000,
        deadline: 60000,
      },
    ],
    0,
    56,
    theme,
  )[0];
  assert.match(
    narrow.replaceAll("\x1b[0m", ""),
    /^monitor active · .*… · failures 1\/3 · next 12s$/,
  );
  assert.ok(visibleWidth(narrow) <= 56);
  assert.deepEqual(widgetLines([], 0, 100, theme), []);
  for (const state of [
    "condition",
    "deadline",
    "failure_limit",
    "unsafe_failure",
    "cancelled",
    "invalidated",
  ] as const)
    for (const notification of [
      "none",
      "pending",
      "handoff_unknown",
      "handed_to_pi",
      "suppressed",
    ] as const)
      assert.deepEqual(
        widgetLines(
          [{ ...r, state, notification, inFlight: true }],
          0,
          100,
          theme,
        ),
        [],
      );
  assert.equal(
    widgetLines(
      Array.from({ length: 16 }, (_, i) => ({
        ...hostile,
        name: `active-${i}`,
      })),
      0,
      100,
      theme,
    ).length,
    16,
  );
  assert.equal(
    Object.hasOwn(
      parseConfig({ terminalRows: 8 }, { MONITOR_TERMINAL_ROWS: "8" }),
      "terminalRows",
    ),
    false,
  );
  for (const expanded of [false, true])
    for (const isPartial of [false, true])
      for (const isError of [false, true])
        for (const monitorError of [false, true]) {
          const ctx: any = {
            args: { action: "start", source: "SOURCE_SECRET" },
            isError,
          };
          const result = renderers.renderResult!(
            {
              content: [{ type: "text", text: "PAYLOAD_SECRET" }],
              details: {
                action: "start",
                status: "registered",
                monitorError,
                receipts: [hostile],
              },
            },
            { expanded, isPartial },
            theme,
            ctx,
          );
          const text = result.render(1000).join("\n");
          assert.doesNotMatch(
            text,
            /SOURCE_SECRET|PAYLOAD_SECRET|mgw_agent_|\x1b|\x07/,
          );
          assert.match(
            text,
            isError || monitorError
              ? /failed/
              : isPartial
                ? /working/
                : /registered/,
          );
          assert.equal(result.render(10).length, expanded ? 2 : 1);
        }
  const call = renderers.renderCall!(
    { action: "start", name: hostile.name, source: "SOURCE_SECRET" },
    theme,
    { args: {} } as any,
  );
  assert.match(call.render(1000)[0], /^monitor start/);
  assert.doesNotMatch(call.render(1000)[0], /SOURCE_SECRET|mgw_agent_|\x1b/);
});
