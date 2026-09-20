import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import askUser from "./index.ts";

const params = {
  question: "Which path?",
  options: [{ label: "A" }, { label: "B" }],
  recommended: 0,
};
const theme = { fg: (_: string, text: string) => text };

function setup(mode: string | undefined) {
  const previous = process.env.PI_ASK_USER_MODE;
  if (mode === undefined) delete process.env.PI_ASK_USER_MODE;
  else process.env.PI_ASK_USER_MODE = mode;
  const events = createEventBus();
  const observed: unknown[] = [];
  for (const name of [
    "ask-user:input_requested",
    "ask-user:input_resolved",
    "herdr:blocked",
  ])
    events.on(name, (data) => observed.push({ name, data }));
  let tool: any;
  try {
    askUser({
      registerTool: (def: any) => {
        tool = def;
      },
      events,
    } as any);
  } finally {
    if (previous === undefined) delete process.env.PI_ASK_USER_MODE;
    else process.env.PI_ASK_USER_MODE = previous;
  }
  return { tool, observed };
}

for (const mode of ["tui", "rpc", "print", "json"]) {
  test(`parent mode returns a non-answer immediately with no UI or events in ${mode}`, async () => {
    const { tool, observed } = setup("parent");
    const result = await tool.execute("call", params, undefined, undefined, {
      mode,
      hasUI: mode === "tui" || mode === "rpc",
      get ui() {
        return assert.fail("must not access UI");
      },
    });
    assert.deepEqual(result.details, {
      status: "decision_required",
      mode: "parent",
      requestId: result.details.requestId,
      cancelled: false,
      answerSupplied: false,
      approvalSupplied: false,
    });
    assert.match(result.details.requestId, /^[0-9a-f-]{36}$/);
    assert.match(result.content[0].text, /No answer or approval was supplied/);
    assert.match(result.content[0].text, /evidence.*blocked work/);
    assert.match(result.content[0].text, /Checkpoint and yield/);
    assert.match(result.content[0].text, /Do not retry.*or bypass/);
    assert.deepEqual(observed, []);
    for (const expanded of [false, true]) {
      const component = tool.renderResult(
        result,
        { expanded, isPartial: false },
        theme,
        {},
      );
      assert.match(component.render(100).join(""), /Decision required/);
      assert.doesNotMatch(
        component.render(100).join(""),
        /Cancelled|✓|User selected/,
      );
      assert.ok(
        component.render(12).every((line: string) => visibleWidth(line) <= 12),
      );
    }
  });
}

test("parent requests have distinct identities and validate before returning a decision", async () => {
  const { tool, observed } = setup("parent");
  const ctx = {
    get ui() {
      return assert.fail("no UI");
    },
  };
  const call = (p = params, signal?: AbortSignal) =>
    tool.execute("same-call-id", p, signal, undefined, ctx);
  const first = await call();
  const second = await call();
  assert.notEqual(first.details.requestId, second.details.requestId);
  const invalid = await call({ ...params, recommended: 2 });
  assert.match(invalid.content[0].text, /Error: recommended/);
  assert.notEqual(invalid.details.status, "decision_required");
  const controller = new AbortController();
  controller.abort();
  const aborted = await call(params, controller.signal);
  assert.equal(aborted.details.cancelled, true);
  assert.notEqual(aborted.details.status, "decision_required");
  assert.deepEqual(observed, []);
});

for (const mode of [
  "",
  "interactive",
  "PARENT",
  " parent",
  "private\x1b[31mvalue",
]) {
  test(`invalid configured mode ${JSON.stringify(mode)} fails without UI or signals`, async () => {
    const { tool, observed } = setup(mode);
    await assert.rejects(
      tool.execute("call", params, undefined, undefined, {
        get hasUI() {
          return assert.fail("configuration must be checked first");
        },
      }),
      (error: Error) => {
        assert.match(error.message, /Invalid PI_ASK_USER_MODE/);
        assert.doesNotMatch(error.message, /private|\x1b/);
        return true;
      },
    );
    assert.deepEqual(observed, []);
  });
}

test("unset mode preserves interactive selection, cancellation, and headless rejection", async () => {
  const { tool, observed } = setup(undefined);
  const execute = (ctx: any) =>
    tool.execute("call", params, undefined, undefined, ctx);
  for (const key of ["\r", "\x1b"]) {
    const result = await execute({
      hasUI: true,
      ui: {
        custom(factory: any) {
          return new Promise((resolve) => {
            const component = factory(
              { requestRender() {} },
              theme,
              {},
              resolve,
            );
            component.handleInput(key);
          });
        },
      },
    });
    if (key === "\r") {
      assert.equal(result.content[0].text, "User selected: 1. A");
      assert.equal(result.details.answerIndex, 1);
    } else assert.equal(result.details.cancelled, true);
    assert.equal(result.details.status, undefined);
  }
  assert.equal(observed.length, 8);
  const headless = await execute({ hasUI: false });
  assert.match(headless.content[0].text, /requires interactive mode/);
  assert.equal(observed.length, 8);
});
