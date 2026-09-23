import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import askUser from "./index.ts";

test("standalone selection, cancellation and headless rejection remain interactive", async () => {
  const observed: unknown[] = [];
  const events = createEventBus();
  for (const name of [
    "ask-user:input_requested",
    "ask-user:input_resolved",
    "herdr:blocked",
  ])
    events.on(name, (data) => observed.push({ name, data }));
  let tool: any;
  askUser({
    events,
    registerTool: (def: any) => {
      tool = def;
    },
  } as any);
  const params = {
    question: "Which path?",
    options: [{ label: "A" }, { label: "B" }],
    recommended: 0,
  };
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
              { fg: (_: string, text: string) => text },
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
