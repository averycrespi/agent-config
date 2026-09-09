import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { validateToolArguments } from "@earendil-works/pi-ai";
import registerMonitor from "./index.ts";
import { fixture, TEST_BEARER } from "../mcp-gateway/fixture.ts";
import { createGatewayAccess } from "../mcp-gateway/api.ts";
import { parseConfig, loadMonitorConfig } from "./config.ts";
import { PARAMETERS, renderers, widgetLines } from "./tool.ts";
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
      const widget = h.widgets.at(-1)[1](null, theme);
      assert.equal(widget.render(100).length, 1);
      assert.match(widget.render(100)[0], /^monitor example/);
      assert.match(widget.render(200)[0], /handed\/queued/);
      const before = h.messages.length;
      await h.commands.get("monitor").handler("", h.ctx);
      await h.commands.get("monitor").handler(r.details.receipts[0].id, h.ctx);
      await h.commands.get("monitor-cancel").handler("all", h.ctx);
      assert.equal(h.messages.length, before);
      assert.match(h.notices.at(-1)!, /cannot be selectively retracted/);
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
    name: `\x1b]52;c;evil\x07a\n${TEST_BEARER}\u202e`,
    evidence: "PAYLOAD_SECRET",
  };
  for (const width of [0, 1, 7, 20, 100]) {
    const lines = widgetLines(
      [hostile, { ...r, state: "waiting", name: "other" }],
      1,
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
  assert.deepEqual(widgetLines([], 2, 0, 100, theme), []);
  assert.equal(widgetLines([r, r, r], 1, 0, 100, theme).length, 1);
  assert.deepEqual(widgetLines([r], 0, 0, 100, theme), []);
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
