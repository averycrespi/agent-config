import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fixture } from "../script/fixture.ts";
import background from "../background/index.ts";
import { getBackgroundService } from "../background/api.ts";
import monitor from "../monitor/index.ts";
import { registerMonitorProvider } from "../monitor/api.ts";
import mailbox from "../mailbox/index.ts";
import { MailboxStore } from "../mailbox/store.ts";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function harness(t: any, producer: string, mode = "tui") {
  let shutdown = async () => {};
  t.after(() => shutdown());
  const f = await fixture(t);
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({
      "extension:script": { allowedProviders: ["fixture"] },
      "extension:mailbox": { batchWindowMs: 0 },
    }),
  );
  const hooks = new Map<string, any[]>(),
    tools = new Map<string, any>();
  const messages: any[] = [],
    entries: any[] = [];
  const session = randomUUID();
  const state = {
    draft: "",
    pending: false,
    unreadable: false,
    failSend: false,
    sends: 0,
  };
  const ctx: any = {
    cwd: f.dir,
    mode,
    hasUI: false,
    isIdle: () => false,
    hasPendingMessages: () => state.pending,
    sessionManager: {
      getSessionId: () => session,
      getSessionFile: () => join(f.dir, "session.jsonl"),
      getLeafId: () => entries.at(-1)?.id ?? "anchor",
      getBranch: () => [{ id: "anchor" }, ...entries],
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
    ui: {
      getEditorText: () => {
        if (state.unreadable) throw Error("unreadable");
        return state.draft;
      },
      setEditorText: () => assert.fail("must never mutate draft"),
      notify() {},
      setWidget() {},
    },
  };
  const pi: any = {
    ...f.pi,
    on: (name: string, fn: any) =>
      hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand() {},
    registerMessageRenderer() {},
    appendEntry: (customType: string, data: any) =>
      entries.push({
        type: "custom",
        customType,
        data: structuredClone(data),
        id: randomUUID(),
        parentId: entries.at(-1)?.id,
      }),
    sendMessage: (message: any, options: any) => {
      state.sends++;
      if (state.failSend) throw Error("uncertain");
      messages.push({ ...message, options });
    },
  };
  const hook = async (name: string, event = {}) => {
    for (const fn of hooks.get(name) ?? []) await fn(event, ctx);
  };
  let emit = () => {};
  if (producer === "background") background(pi);
  else if (producer === "mailbox") mailbox(pi, join(f.dir, "boxes"));
  else {
    const dispose = registerMonitorProvider(pi, {
      namespace: "fixture",
      available: () => true,
      methods: {
        status: {
          description: "Read fixture",
          inputSchema: { type: "array", maxItems: 0 },
          handler: async () => ({ value: true }),
        },
      },
      events: {
        changed: {
          description: "fixture",
          inputSchema: { type: "array", maxItems: 0 },
          payloadSchema: { type: "boolean" },
          async subscribe(_args, options) {
            emit = () => options.emit(true);
            return { coverage: null, close() {} };
          },
        },
      },
    });
    t.after(dispose);
    await monitor(pi);
  }
  await hook("session_start");
  shutdown = () => hook("session_shutdown");
  const pump = async () => {
    t.mock.timers.tick(1000);
    await turn();
  };
  const store = new MailboxStore(join(f.dir, "boxes"));
  const trigger = async (recurring = false) => {
    if (producer === "background") {
      const service = getBackgroundService(pi);
      const r = service.admit({
        owner: "script",
        label: "protection",
        deadlineMs: Date.now() + 60000,
        run: async () => ({
          status: "success",
          effectsMayPersist: false,
          outcomeUnknown: false,
        }),
      });
      await turn();
      return r.id;
    }
    if (producer === "mailbox")
      return store.send(session, "test", "safe body", session).id;
    const result = await tools.get("monitor").execute("test", {
      action: "start",
      name: "protection",
      message: "Inspect",
      providers: ["fixture"],
      events: [{ provider: "fixture", event: "changed", args: [] }],
      cycle_timeout_ms: 60000,
      lifetime_ms: 60000,
      max_wakes: recurring ? 3 : 1,
      recurring,
    });
    assert.equal(result.details.monitorError, false, JSON.stringify(result));
    emit();
    return result.details.receipt.id;
  };
  const inspect = (id: string) =>
    producer === "background"
      ? getBackgroundService(pi).inspect("script", id)
      : producer === "mailbox"
        ? store.list(session).messages.find((m) => m.id === id)
        : entries.filter((e) => e.data.id === id).at(-1)?.data;
  return {
    ...f,
    pi,
    ctx,
    state,
    messages,
    entries,
    hook,
    pump,
    trigger,
    inspect,
    emit,
    tools,
  };
}

for (const producer of ["background", "monitor", "mailbox"]) {
  test(`${producer}: simultaneous held outcomes preserve identities without competing callback duplicates`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const h = await harness(t, producer);
    h.state.draft = "hold both";
    const ids = [await h.trigger(), await h.trigger()];
    await h.pump();
    assert.equal(h.messages.length, 0);
    if (producer === "background")
      h.pi.events.on("background:notification", () =>
        (getBackgroundService(h.pi) as any).flush(),
      );
    h.state.draft = "";
    await h.pump();
    assert.equal(h.messages.length, producer === "mailbox" ? 1 : 2);
    if (producer === "mailbox") {
      assert.equal(h.messages[0].details.count, 2);
      for (const id of ids) assert.ok(h.messages[0].content.includes(id));
    } else
      assert.deepEqual(
        h.messages.map((m) => m.details.executionId ?? m.details.jobId).sort(),
        ids.sort(),
      );
    await h.pump();
    assert.equal(h.messages.length, producer === "mailbox" ? 1 : 2);
  });
  test(`${producer}: busy draft/input/unreadable/nested-dialog holds release without settlement`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const h = await harness(t, producer);
    h.state.draft = "nonempty\nuser draft";
    const id = await h.trigger();
    await h.pump();
    assert.equal(h.messages.length, 0);
    assert.ok(h.inspect(id));
    h.state.draft = "";
    h.state.pending = true;
    await h.pump();
    assert.equal(h.messages.length, 0);
    h.state.pending = false;
    h.state.unreadable = true;
    await h.pump();
    assert.equal(h.messages.length, 0);
    h.state.unreadable = false;
    await h.hook("ui_prompt_start");
    await h.hook("ui_prompt_start");
    await h.pump();
    await h.hook("ui_prompt_end");
    await h.pump();
    assert.equal(h.messages.length, 0);
    await h.hook("ui_prompt_end");
    await h.pump();
    assert.equal(h.ctx.isIdle(), false);
    assert.equal(h.messages.length, 1);
    assert.deepEqual(h.messages[0].options, {
      deliverAs: "steer",
      triggerTurn: true,
    });
    await h.pump();
    assert.equal(h.messages.length, 1);
  });

  test(`${producer}: final readiness race holds without spending a handoff; releases while active`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const h = await harness(t, producer);
    // Introduce a draft after initial eligibility, at the durable intent boundary.
    if (producer === "background" || producer === "monitor") {
      h.pi.events.on(`${producer}:notification`, (e: any) => {
        if (e.handoff === "unknown" || e.notification === "handoff_unknown")
          h.state.draft = "late draft";
      });
    } else {
      let reads = 0;
      h.ctx.ui.getEditorText = () => (++reads >= 3 ? "late draft" : "");
    }
    const id = await h.trigger();
    await h.pump();
    assert.equal(h.messages.length, 0);
    if (producer === "mailbox") assert.equal(h.inspect(id).attempts, 0);
    if (producer === "monitor") assert.equal(h.inspect(id).wakes, 0);
    // Keep the observer installed but stop creating the race after the first hold.
    h.ctx.ui.getEditorText = () => "";
    await h.pump();
    assert.equal(h.messages.length, 1);
  });

  test(`${producer}: unknown send never automatically replays, including after navigation`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const h = await harness(t, producer);
    h.state.failSend = true;
    const id = await h.trigger();
    await h.pump();
    assert.equal(h.state.sends, 1);
    assert.ok(h.inspect(id));
    h.state.failSend = false;
    await h.pump();
    await h.hook("session_before_tree");
    await h.hook("session_tree");
    await h.pump();
    assert.equal(h.state.sends, 1);
  });

  for (const mode of ["rpc", "json"])
    test(`${producer}: ${mode} preserves mode exception without TUI editor dependency`, async (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
      const h = await harness(t, producer, mode);
      h.state.unreadable = true;
      await h.trigger();
      await h.pump();
      if (producer === "mailbox" && mode === "rpc")
        assert.equal(h.messages.length, 0);
      else {
        assert.equal(h.messages.length, 1);
        assert.deepEqual(
          h.messages[0].options,
          producer === "monitor" && mode === "rpc"
            ? { deliverAs: "nextTurn", triggerTurn: false }
            : { deliverAs: "steer", triggerTurn: true },
        );
      }
    });
}

test("Monitor mid-run admission rearms only its matching wake at settlement", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const h = await harness(t, "monitor");
  const id = await h.trigger(true);
  await h.pump();
  assert.equal(h.messages.length, 1);
  const before = h.inspect(id);
  await h.hook("agent_settled");
  assert.equal(h.inspect(id).awaitingSettlement, true);
  await h.hook("message_start", {
    message: {
      role: "custom",
      customType: "monitor-wake",
      details: { wakeId: randomUUID() },
    },
  });
  await h.hook("agent_settled");
  assert.equal(h.inspect(id).awaitingSettlement, true);
  await h.hook("message_start", {
    message: { role: "custom", ...h.messages[0] },
  });
  await h.hook("turn_end");
  await h.pump();
  assert.equal(h.inspect(id).awaitingSettlement, true);
  await h.hook("agent_settled");
  assert.equal(h.inspect(id).awaitingSettlement, false);
  assert.equal(h.inspect(id).deadline, before.deadline);
  assert.equal(h.inspect(id).wakes, 1);
  await h.tools.get("monitor").execute("cancel", { action: "cancel", id });
  h.emit();
  await h.pump();
  assert.equal(h.messages.length, 1);
});
