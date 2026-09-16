import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fixture } from "../script/fixture.ts";
import {
  temporaryRoot,
  pause,
  theme,
  value,
} from "../session-watch/test-support.ts";
import background from "./index.ts";
import { restore, parseReceipt } from "./receipts.ts";
import { widgetLines, renderers, notificationContent } from "./tool.ts";

async function harness(t: any, mode = "tui") {
  const f = await fixture(t);
  await f.config({ allowedProviders: ["sessions"] });
  const temp = temporaryRoot(),
    handlers = new Map<string, any>(),
    tools = new Map<string, any>();
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
    appendEntry: (customType: string, data: any) =>
      entries.push({
        type: "custom",
        customType,
        data: JSON.parse(JSON.stringify(data)),
        id: randomUUID(),
        parentId: entries.at(-1)?.id,
      }),
    sendMessage: (message: any, options: any) => {
      messages.push({ message, options });
      busy = true;
    },
  };
  background(pi, () => temp.root);
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

test("actual event provider holds one wake until idle; immutable controls, stable widget and lifecycle restoration", async (t) => {
  const h = await harness(t);
  const observed: any[] = [];
  for (const type of ["registered", "attention", "terminated", "notification"])
    h.pi.events.on(`background:${type}`, (e) => observed.push(e));
  const started = await h.call(input);
  assert.equal(started.details.backgroundError, false, JSON.stringify(started));
  const id = value(started).id;
  const mounted = h.component;
  await h.hook("agent_start");
  await pause();
  assert.equal(h.messages.length, 0);
  assert.equal(h.component, mounted);
  const pending = value(await h.call({ action: "get", id }));
  assert.equal(pending.attention.disposition, "pending");
  assert.match(h.component.render(200)[0], /condition awaiting settlement/);
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

test("receipt-only recovery is bounded and malformed receipts cannot resume execution", async (t) => {
  const h = await harness(t);
  const r = value(await h.call(input));
  assert.ok(parseReceipt(r));
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
            status: "inspected",
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
