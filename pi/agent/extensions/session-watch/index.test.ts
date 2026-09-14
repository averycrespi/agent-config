import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Bridge } from "./transport.ts";
import { harness, temporaryRoot, pause, value, theme } from "./test-support.ts";
import { widgetLines, renderers } from "./tool.ts";

for (const mode of ["tui", "rpc", "json"])
  test(`lifecycle and widget cleanup in ${mode}; receipts remain inspectable`, async (t) => {
    const temp = temporaryRoot(),
      h = harness(temp.root, mode),
      peer = new Bridge(temp.root, randomUUID());
    const keepalive = setInterval(() => {}, 1000);
    t.after(async () => {
      await h.hook("session_shutdown");
      peer.close();
      clearInterval(keepalive);
      temp.remove();
    });
    await peer.start();
    await h.hook("session_start");
    const start = async (name: string) =>
      value(
        await h.call({
          action: "start",
          target: peer.target.incarnation,
          name,
          events: ["agent_settled"],
          timeout_ms: 5000,
          message: "PRIVATE caller instruction",
        }),
      );
    const a = await start("api-worker"),
      b = await start("\x1b[2Jwide\nworker\u202e");
    assert.equal(h.messages.length, 0);
    if (mode === "tui") {
      const component = h.component;
      assert.equal(
        h.mounts.filter((m) => typeof m.content === "function").length,
        1,
      );
      assert.equal(component.render(100).length, 2);
      assert.match(
        component.render(100)[0],
        /^watcher active · api-worker · agent_settled · 5s left/,
      );
      assert.doesNotMatch(
        component.render(100).join(""),
        /PRIVATE|\n|\u202e|\x1b\[2J/,
      );
      for (let width = 0; width < 100; width++)
        assert.ok(
          component
            .render(width)
            .every((line: string) => visibleWidth(line) <= width),
        );
      await pause(1050);
      assert.equal(h.component, component);
      assert.ok(h.paints >= 2);
      assert.equal(
        h.mounts.filter((m) => typeof m.content === "function").length,
        1,
      );
    } else if (mode === "rpc")
      assert.ok(
        h.mounts.some(
          (m) => Array.isArray(m.content) && m.content.length === 2,
        ),
      );
    else assert.equal(h.mounts.length, 0);
    await h.call({ action: "cancel", id: a.id });
    assert.equal(
      value(await h.call({ action: "get", id: b.id })).receipt.state,
      "active",
    );
    const beforeTree = h.entries.length;
    await h.hook("session_before_tree");
    assert.equal(
      h.entries.length,
      beforeTree,
      "no history writes during prepared navigation",
    );
    peer.publish("agent_settled", {});
    await pause();
    assert.equal(h.messages.length, 0);
    await h.hook("session_tree");
    const restored = value(await h.call({ action: "get", id: b.id })).receipt;
    assert.equal(restored.state, "invalidated");
    assert.equal(restored.notification, "suppressed");
    assert.equal(h.component, undefined);
  });

test("tool validates inapplicable fields, inactive/unsafe contexts and does not leak raw errors", async (t) => {
  const temp = temporaryRoot(),
    h = harness(temp.root);
  t.after(async () => {
    await h.hook("session_shutdown");
    temp.remove();
  });
  await h.hook("session_start");
  for (const params of [
    { action: "list", message: "PRIVATE" },
    { action: "cancel", id: "../PRIVATE" },
    { action: "start" },
  ]) {
    const result = await h.call(params);
    assert.equal(result.details.watchError, true);
    assert.doesNotMatch(result.content[0].text, /PRIVATE/);
  }
  const unsafe = harness(`${temp.root}/PRIVATE-missing/path`);
  await unsafe.hook("session_start");
  const result = await unsafe.call({ action: "list" });
  assert.equal(result.details.watchError, true);
  assert.doesNotMatch(result.content[0].text, /PRIVATE/);
  await unsafe.hook("session_shutdown");
});

test("host handoff options wake idle or queue active parents, unknown admission never retries", async (t) => {
  const temp = temporaryRoot(),
    h = harness(temp.root),
    peer = new Bridge(temp.root, randomUUID());
  const keepalive = setInterval(() => {}, 1000);
  t.after(async () => {
    await h.hook("session_shutdown");
    peer.close();
    clearInterval(keepalive);
    temp.remove();
  });
  await peer.start();
  await h.hook("session_start");
  h.failHandoff();
  const a = value(
    await h.call({
      action: "start",
      target: peer.target.incarnation,
      events: ["agent_settled"],
      timeout_ms: 1000,
      message: "Inspect evidence",
    }),
  );
  peer.publish("agent_settled", {});
  await pause(50);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.messages[0].options, {
    deliverAs: "followUp",
    triggerTurn: true,
  });
  assert.equal(
    value(await h.call({ action: "get", id: a.id })).receipt.notification,
    "handoff_unknown",
  );
  await h.hook("session_shutdown");
  await h.hook("session_start");
  await pause();
  assert.equal(h.messages.length, 1);
  assert.equal(
    value(await h.call({ action: "get", id: a.id })).receipt.notification,
    "handoff_unknown",
  );
  assert.equal(h.component, undefined);
});

test("renderers preserve components and contextual errors, exclude instructions, and show countdown boundaries", () => {
  const r: any = {
    id: randomUUID(),
    name: "api-worker",
    events: ["ask-user:input_requested"],
    state: "active",
    deadline: 60001,
  };
  assert.match(widgetLines([r], 0, 100, theme)[0], /1m 1s left/);
  assert.match(widgetLines([r], 60002, 100, theme)[0], /0s left/);
  assert.deepEqual(widgetLines([{ ...r, state: "match" }], 0, 100, theme), []);
  const call = renderers.renderCall({ action: "start\n\x1b[2J" }, theme, {});
  assert.doesNotMatch(call.render(50).join(""), /\n|\x1b\[2J/);
  assert.equal(
    renderers.renderCall({ action: "get" }, theme, { lastComponent: call }),
    call,
  );
  for (const state of [
    { isError: true },
    { semantic: true },
    { partial: true },
    {},
  ]) {
    const result = renderers.renderResult(
      {
        details: {
          watchError: state.semantic,
          status: "registered",
          receipts: [],
          message: "PRIVATE",
        },
      },
      { expanded: true, isPartial: state.partial },
      theme,
      { isError: state.isError, args: { action: "start" } },
    );
    const lines = result.render(100);
    assert.match(lines[0], /session_watch start/);
    assert.doesNotMatch(lines.join(""), /PRIVATE/);
    if (state.isError || state.semantic)
      assert.match(lines[0], /invalid request/);
  }
});
