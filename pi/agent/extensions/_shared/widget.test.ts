import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createPersistentWidget,
  fitWidgetRow,
  formatWidgetCountdown,
} from "./widget.ts";

test("persistent widgets repaint current content, remount after disposal, and use RPC arrays", () => {
  const theme: any = { fg: (_color: string, text: string) => text };
  const calls: any[] = [];
  let component: any;
  let paints = 0;
  const ctx: any = {
    hasUI: true,
    mode: "tui",
    ui: {
      theme,
      setWidget: (_key: string, content: any) => {
        calls.push(content);
        component?.dispose();
        component =
          typeof content === "function"
            ? content(
                {
                  requestRender: () => {
                    paints++;
                  },
                },
                theme,
              )
            : undefined;
      },
    },
  };
  const widget = createPersistentWidget("fixture");
  widget.update(ctx, (width) => [`first ${width}`]);
  const first = component;
  widget.update(ctx, (width) => [`second ${width}`]);
  assert.equal(calls.length, 1);
  assert.equal(paints, 1);
  assert.equal(component, first);
  assert.deepEqual(component.render(40), ["second 40"]);
  component.dispose();
  widget.update(ctx, () => ["remounted"]);
  assert.equal(calls.length, 2);
  assert.notEqual(component, first);
  widget.update(ctx);
  assert.equal(calls.at(-1), undefined);
  widget.update({ ...ctx, mode: "rpc" }, (width) => [`rpc ${width}`]);
  assert.deepEqual(calls.at(-1), ["rpc 100"]);
  const count = calls.length;
  widget.update({ ...ctx, hasUI: false }, () => ["headless"]);
  assert.equal(calls.length, count);
});

test("widget countdowns round up, clamp at zero and omit empty seconds", () => {
  for (const [ms, expected] of [
    [-1, "0s"],
    [0, "0s"],
    [1, "1s"],
    [999, "1s"],
    [1000, "1s"],
    [60000, "1m"],
    [60001, "1m 1s"],
    [72000, "1m 12s"],
  ] as const)
    assert.equal(formatWidgetCountdown(ms), expected);
});

test("rows shorten detail before dropping trailing telemetry", () => {
  const fields = ["next 12s", "18m left"];
  assert.equal(
    fitWidgetRow("monitor active", fields, 200, " · ", "Build checks"),
    "monitor active · Build checks · next 12s · 18m left",
  );
  assert.equal(
    fitWidgetRow(
      "monitor active",
      fields,
      47,
      " · ",
      "Build checks",
    ).replaceAll("\x1b[0m", ""),
    "monitor active · Build c… · next 12s · 18m left",
  );
  assert.equal(
    fitWidgetRow("loop waiting", fields, 24, " · "),
    "loop waiting · next 12s",
  );
  assert.deepEqual(fields, ["next 12s", "18m left"]);
});

test("styled wide-character detail remains one bounded line at every width", () => {
  for (let width = 0; width < 100; width++) {
    const line = fitWidgetRow(
      "\x1b[90mmonitor\x1b[39m active",
      ["next 12s", "18m left"],
      width,
      "\x1b[90m · \x1b[39m",
      "\x1b[37m宽字符继续工作\x1b[39m",
    );
    assert.ok(visibleWidth(line) <= width);
    assert.doesNotMatch(line, /\n|\x1b$/);
  }
});
