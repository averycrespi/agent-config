import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fixture } from "../script/fixture.ts";
import { temporaryRoot, pause, theme, value } from "./test-support.ts";
import background from "./index.ts";
import { restore, parseReceipt } from "./receipts.ts";
import { widgetLines, renderers, notificationContent } from "./tool.ts";

async function harness(t: any, mode = "tui", config: unknown = {}) {
  const f = await fixture(t);
  delete process.env.BACKGROUND_MAX_CYCLE_TIMEOUT_MS;
  delete process.env.BACKGROUND_MAX_LIFETIME_MS;
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({
      "extension:script": { allowedProviders: ["sessions"] },
      "extension:background": config,
    }),
  );
  const temp = temporaryRoot(),
    handlers = new Map<string, any>(),
    tools = new Map<string, any>(),
    commands = new Map<string, any>();
  const entries: any[] = [],
    messages: any[] = [],
    mounts: any[] = [];
  let busy = true,
    component: any,
    paints = 0;
  const ctx: any = {
    cwd: f.dir,
    mode,
    hasUI: mode !== "json",
    isIdle: () => !busy,
    sessionManager: {
      getSessionId: () => "11111111-2222-4333-8444-555555555555",
      getLeafId: () => entries.at(-1)?.id,
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
    ui: {
      theme,
      notify() {},
      setWidget(key: string, content: any) {
        mounts.push({ key, content });
        component?.dispose?.();
        component =
          typeof content === "function"
            ? content({ requestRender: () => paints++ }, theme)
            : undefined;
      },
    },
  };
  const pi: any = {
    ...f.pi,
    on: (n: string, fn: any) => handlers.set(n, fn),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) =>
      commands.set(name, command),
    appendEntry: (customType: string, data: any) =>
      entries.push({
        type: "custom",
        customType,
        data,
        id: randomUUID(),
        parentId: entries.at(-1)?.id,
      }),
    sendMessage: (message: any, options: any) => {
      messages.push({ message, options });
      busy = true;
    },
  };
  await background(pi, () => temp.root);
  const hook = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  t.after(async () => {
    await hook("session_shutdown");
    temp.remove();
  });
  await hook("session_start");
  const call = (args: any, signal?: AbortSignal) =>
    tools.get("background").execute("fixture", args, signal, undefined, ctx);
  return {
    ...f,
    call,
    hook,
    tools,
    commands,
    entries,
    messages,
    mounts,
    get component() {
      return component;
    },
    get paints() {
      return paints;
    },
    idle: async () => {
      busy = false;
      await hook("agent_settled");
    },
  };
}
const input = {
  action: "start",
  name: "safe name",
  message: "Inspect latest evidence",
  providers: ["sessions"],
  cycle_timeout_ms: 5000,
  lifetime_ms: 10000,
  max_wakes: 1,
  events: [
    {
      provider: "sessions",
      event: "lifecycle",
      args: ["local", ["agent_start"]],
    },
  ],
};

test("configuration snapshot aligns tool schema and admission until extension reload", async (t) => {
  const h = await harness(t, "json", {
    maxCycleTimeoutMs: 3_600_000,
    maxLifetimeMs: 172_800_000,
  });
  const tool = h.tools.get("background");
  assert.equal(tool.parameters.properties.cycle_timeout_ms.maximum, 3_600_000);
  assert.equal(tool.parameters.properties.lifetime_ms.maximum, 172_800_000);
  assert.match(tool.description, /1000–3600000 ms/);
  const raw = {
    ...input,
    cycle_timeout_ms: 3_600_000,
    lifetime_ms: 172_800_000,
  };
  const started = await h.call(raw);
  assert.equal(started.details.backgroundError, false);
  const r = value(started);
  assert.equal(r.deadline - r.createdAt, 172_800_000);
  await writeFile(
    join(h.dir, "settings.json"),
    JSON.stringify({
      "extension:script": { allowedProviders: ["sessions"] },
      "extension:background": { maxCycleTimeoutMs: 1000, maxLifetimeMs: 1000 },
    }),
  );
  process.env.BACKGROUND_MAX_CYCLE_TIMEOUT_MS = "1000";
  await h.hook("session_before_tree");
  await h.hook("session_tree");
  assert.equal(
    value(await h.call({ action: "get", id: r.id })).status,
    "invalidated",
  );
  assert.equal((await h.call(raw)).details.backgroundError, false);
  assert.equal(
    (await h.call({ ...raw, cycle_timeout_ms: 3_600_001 })).details
      .backgroundError,
    true,
  );
  const notices: string[] = [];
  await h.commands.get("background-config").handler("", {
    cwd: h.dir,
    ui: { notify: (s: string) => notices.push(s) },
  });
  assert.match(notices[0], /3600000/);
  assert.match(notices[0], /"valid": true/);
  // A new factory (reload) takes the new policy; it does not mutate old jobs.
  const reloaded = new Map<string, any>();
  await background({
    registerCommand() {},
    on() {},
    registerTool: (t: any) => reloaded.set(t.name, t),
  } as any);
  assert.equal(
    reloaded.get("background").parameters.properties.cycle_timeout_ms.maximum,
    1000,
  );
});

test("invalid policy blocks starts without disabling inspection or cancellation", async (t) => {
  const h = await harness(t, "json", {
    maxLifetimeMs: "PRIVATE invalid value",
  });
  const result = await h.call(input);
  assert.equal(result.details.backgroundError, true);
  assert.match(result.content[0].text, /starts disabled/);
  assert.doesNotMatch(result.content[0].text, /PRIVATE/);
  assert.deepEqual(value(await h.call({ action: "list" })).receipts, []);
  assert.equal(h.entries.length, 0);
  const notices: string[] = [];
  await h.commands.get("background-config").handler("", {
    cwd: h.dir,
    ui: { notify: (s: string) => notices.push(s) },
  });
  assert.match(notices[0], /"valid": false/);
  assert.doesNotMatch(notices[0], /PRIVATE/);
  // Inspection/cancellation of historical jobs stays available under invalid policy.
  const historical = {
    id: "11111111-2222-4333-8444-555555555555",
    name: "historical",
    createdAt: 1000,
    deadline: 172801000,
    cycleDeadline: 3601000,
    cycleMs: 3600000,
    status: "active",
    recurring: false,
    maxWakes: 1,
    wakes: 0,
    evaluations: 0,
    calls: 0,
    inFlight: false,
    awaitingSettlement: false,
    state: null,
    evidence: null,
    coverage: [],
    gap: false,
    interrupted: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
  };
  h.entries.push({
    id: "entry",
    type: "custom",
    customType: "background:receipt-v1",
    data: historical,
  });
  await h.hook("session_before_tree");
  await h.hook("session_tree");
  assert.equal(
    value(await h.call({ action: "get", id: historical.id })).status,
    "invalidated",
  );
  assert.equal(
    (await h.call({ action: "cancel", id: historical.id })).details
      .backgroundError,
    false,
  );
});

test("actual event provider holds one wake until idle; immutable controls, stable widget and lifecycle restoration", async (t) => {
  const h = await harness(t);
  const observed: any[] = [];
  for (const type of ["registered", "attention", "terminated", "notification"])
    h.pi.events.on(`background:${type}`, (e) => observed.push(e));
  const started = await h.call(input);
  assert.equal(started.details.backgroundError, false, JSON.stringify(started));
  const id = value(started).id;
  assert.equal(started.details.action, "start");
  assert.equal(started.details.receipt.eventCount, 1);
  assert.equal(started.details.receipt.id, id);
  const mounted = h.component;
  await h.hook("agent_start");
  await pause();
  assert.equal(h.messages.length, 0);
  assert.equal(h.component, mounted);
  const pending = value(await h.call({ action: "get", id }));
  assert.equal(pending.attention.disposition, "pending");
  assert.match(h.component.render(200)[0], /condition met · follow-up queued/);
  await h.idle();
  await pause();
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.messages[0].options, {
    deliverAs: "followUp",
    triggerTurn: true,
  });
  assert.equal(h.component, undefined);
  const sent = value(await h.call({ action: "get", id }));
  assert.equal(sent.lastAttention.disposition, "handed_to_pi");
  assert.equal(sent.lastAttention.admitted, false);
  await h.hook("message_start", {
    message: { role: "custom", ...h.messages[0].message },
  });
  await h.idle();
  assert.equal(
    value(await h.call({ action: "get", id })).lastAttention.admitted,
    true,
  );
  const reject = await h.call({ action: "get", id, max_wakes: 5 });
  assert.equal(reject.details.backgroundError, true);
  const listed = value(await h.call({ action: "list" }));
  assert.equal(listed.eventProviders[0].provider, "sessions");
  await h.hook("session_before_tree");
  await h.hook("session_tree");
  assert.equal(value(await h.call({ action: "get", id })).status, "finished");
  assert.equal(h.messages.length, 1);
  assert.deepEqual(
    observed.map((e) => e.type),
    ["registered", "attention", "terminated", "notification", "notification"],
  );
  assert.ok(
    observed.every(
      (e) =>
        e.id === id &&
        Object.keys(e).sort().join() === "id,notification,status,type",
    ),
  );
  assert.doesNotMatch(JSON.stringify(observed), /safe name|Inspect|evidence/);
});

test("accepted polling registrations warn in model content without extending clocks", async (t) => {
  const h = await harness(t, "json");
  for (const [interval, cycle, events, warn] of [
    [30000, 30000, [], true],
    [60000, 30000, input.events, true],
    [30000, 600000, [], false],
  ] as const) {
    const result = await h.call({
      ...input,
      interval_ms: interval,
      cycle_timeout_ms: cycle,
      lifetime_ms: 900000,
      events,
      source: "return {decision: 'wait', evidence: {status: 'pending'}};",
    });
    assert.equal(result.details.backgroundError, false);
    const r = value(result);
    assert.equal(r.intervalMs, interval);
    assert.equal(r.cycleDeadline - r.createdAt, cycle);
    assert.equal(r.deadline - r.createdAt, 900000);
    const text = result.content[0].text;
    assert.equal(text.startsWith("Warning:"), warn);
    if (warn) {
      assert.match(text, /Only the initial polling evaluation/);
      assert.match(text, /lifetime_ms does not extend the cycle/);
      assert.equal(
        text.includes("Events may still trigger"),
        events.length > 0,
      );
      assert.ok(text.indexOf("Warning:") < text.indexOf("BEGIN UNTRUSTED"));
    }
    await h.call({ action: "cancel", id: r.id });
  }
});

test("action details select one job and distinguish cancellation from a no-op", async (t) => {
  const h = await harness(t);
  const first = value(await h.call(input));
  const second = value(await h.call({ ...input, name: "other job" }));
  const selected = await h.call({ action: "get", id: second.id });
  assert.equal(selected.details.receipt.id, second.id);
  assert.deepEqual(selected.details.receipts, []);
  const cancelled = await h.call({ action: "cancel", id: first.id });
  assert.equal(cancelled.details.cancelChanged, true);
  assert.equal(cancelled.details.receipt.status, "cancelled");
  const again = await h.call({ action: "cancel", id: first.id });
  assert.equal(again.details.cancelChanged, false);
  const listed = await h.call({ action: "list" });
  assert.equal(listed.details.receipts.length, 2);
  assert.equal(listed.details.receipt, undefined);
  assert.equal(h.messages.length, 0);
});

test("cancellation/navigation suppress pending attention and stale callbacks; headless/RPC use supported UI paths", async (t) => {
  for (const mode of ["rpc", "json"]) {
    const h = await harness(t, mode);
    const id = value(await h.call(input)).id;
    if (mode === "rpc")
      assert.ok(h.mounts.some((m) => Array.isArray(m.content)));
    else assert.equal(h.mounts.length, 0);
    await h.hook("agent_start");
    await pause();
    await h.hook("session_before_tree");
    await h.idle();
    await pause();
    assert.equal(h.messages.length, 0);
    assert.equal(
      value(await h.call({ action: "get", id })).attention.disposition,
      "suppressed",
    );
  }
});

test("successful Script receipts survive in-memory reload without replay", async (t) => {
  for (const decision of ["wake", "wait"]) {
    const h = await harness(t, "json");
    const started = value(
      await h.call({
        action: "start",
        name: "reload",
        message: "Inspect",
        providers: [],
        interval_ms: 1000,
        cycle_timeout_ms: 1000,
        lifetime_ms: 10000,
        max_wakes: 1,
        source: `return {decision: '${decision}', evidence: {checked: true}};`,
      }),
    );
    let latest: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      latest = value(await h.call({ action: "get", id: started.id }));
      if (latest.status === "finished" && !latest.inFlight) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(latest.status, "finished");
    assert.equal(
      latest.attention.reason,
      decision === "wake" ? "condition" : "timeout",
    );
    const saved = h.entries
      .filter((e: any) => e.data.id === started.id)
      .at(-1).data;
    assert.equal(Object.hasOwn(saved.accounting, "code"), false);
    assert.ok(parseReceipt(saved));
    await h.idle();
    for (let attempt = 0; !h.messages.length && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(h.messages.length, 1);
    await h.hook("message_start", {
      message: { role: "custom", ...h.messages[0].message },
    });
    await h.idle();
    const before = value(await h.call({ action: "get", id: started.id }));
    assert.equal(before.wakes, 1);
    await h.hook("session_shutdown");
    await h.hook("session_start");
    const after = value(await h.call({ action: "get", id: started.id }));
    assert.deepEqual(after, before);
    await h.idle();
    await pause();
    assert.equal(h.messages.length, 1);
  }
});

test("receipt-only recovery is bounded and malformed receipts cannot resume execution", async (t) => {
  const h = await harness(t);
  const r = value(await h.call(input));
  assert.ok(parseReceipt(r));
  const { eventCount: _eventCount, ...legacy } = r;
  assert.ok(parseReceipt(legacy));
  for (const extra of [
    { intervalMs: 0 },
    { delayMs: 1000 },
    { eventCount: 5 },
    { intervalMs: 1000, delayMs: 1000 },
  ])
    assert.equal(parseReceipt({ ...r, ...extra }), undefined);
  assert.equal(parseReceipt({ ...r, maxWakes: Infinity }), undefined);
  assert.equal(parseReceipt({ ...r, state: "x".repeat(5000) }), undefined);
  let reads = 0;
  const receipts = restore({
    getLeafId: () => "5000",
    getEntry: (id: string) => {
      reads++;
      return {
        type: "custom",
        customType: "irrelevant",
        data: {},
        id,
        parentId: String(Number(id) - 1),
      } as any;
    },
  });
  assert.equal(reads, 4096);
  assert.deepEqual(receipts, []);
  await h.hook("session_before_tree");
  await h.hook("session_tree");
  assert.equal(
    value(await h.call({ action: "get", id: r.id })).status,
    "invalidated",
  );
  await h.hook("agent_start");
  await h.idle();
  await pause();
  assert.equal(h.messages.length, 0);
});

test("widget and tool renderers are width bounded and never expose scripts, evidence, or controls", async (t) => {
  const h = await harness(t);
  const r = value(await h.call(input));
  r.name = "\x1b]0;hostile\x07name\nline";
  r.evidence = "SECRET evidence";
  for (let width = 0; width < 100; width++) {
    const lines = widgetLines([r], Date.now(), width, theme);
    assert.equal(lines.length, 1);
    assert.ok(visibleWidth(lines[0]) <= width);
    assert.doesNotMatch(lines[0], /\n|\x07|SECRET|hostile/);
  }
  for (const partial of [false, true])
    for (const error of [false, true]) {
      const rendered = renderers.renderResult!(
        {
          content: [],
          details: {
            backgroundError: error,
            action: "list",
            receipts: [r],
          },
        } as any,
        { expanded: true, isPartial: partial } as any,
        theme,
        { isError: error } as any,
      );
      assert.ok(rendered.render(12).every((s) => visibleWidth(s) <= 12));
      assert.doesNotMatch(rendered.render(200).join("\n"), /SECRET|hostile/);
    }
  const text = notificationContent(
    { ...r, lastAttention: { reason: "timeout" } } as any,
    "Inspect",
    r.createdAt + 100,
  );
  assert.match(text, /timeout/);
  assert.match(text, /evidenceAgeMs/);
  assert.match(text, /Recurrence disabled/);
});
