import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { notificationRenderer } from "./notification.ts";

const colors: string[] = [];
const backgrounds: string[] = [];
const theme: any = {
  fg: (color: string, text: string) => {
    colors.push(color);
    return text;
  },
  bg: (color: string, text: string) => {
    backgrounds.push(color);
    return text;
  },
  bold: (text: string) => text,
};
const id = "11111111-2222-4333-8444-555555555555";
function message(source: string, status: unknown, extra = {}) {
  return {
    customType:
      source === "background"
        ? "background:execution-outcome-v1"
        : "monitor-wake",
    content:
      'Continue authorized work.\nBEGIN UNTRUSTED EVIDENCE\n{"result":42}\nEND UNTRUSTED EVIDENCE\nFull result: /retained/result.json',
    details: {
      [source === "background" ? "executionId" : "jobId"]: id,
      display: {
        version: 1,
        owner: "script",
        name: "Build 世界 👩‍💻",
        status,
        ...extra,
      },
    },
  } as any;
}
for (const source of ["background", "monitor"] as const) {
  test(`${source}: one-line truthful outcomes, theme background and unchanged expanded evidence`, () => {
    const statuses =
      source === "background"
        ? {
            success: "succeeded",
            failed: "failed",
            timeout: "timed out",
            cancelled: "canceled",
            interrupted: "interrupted",
          }
        : {
            condition: "condition met",
            timeout: "timed out",
            evaluation_failure: "evaluation failed",
            coverage_failure: "coverage lost",
            budget_exhausted: "budget exhausted",
          };
    for (const [status, expected] of Object.entries(statuses)) {
      const m = message(source, status);
      const original = JSON.stringify(m);
      const renderer = notificationRenderer(source);
      const compact = renderer(m, { expanded: false } as any, theme)!;
      colors.length = 0;
      backgrounds.length = 0;
      const normal = compact.render(100);
      assert.equal(normal.length, 1);
      assert.match(
        normal[0],
        new RegExp(
          `^${source === "background" ? "script" : "monitor"} ${expected}`,
        ),
      );
      assert.match(normal[0], /Build 世界/);
      assert.doesNotMatch(normal[0], /·/);
      assert.doesNotMatch(normal[0], /11111111|Continue|result.json|UNTRUSTED/);
      assert.deepEqual(backgrounds, ["customMessageBg"]);
      if (source === "monitor")
        assert.equal(colors.includes("success"), status === "condition");
      for (let width = 0; width <= 100; width++) {
        const rows = compact.render(width);
        assert.equal(rows.length, 1);
        assert.ok(visibleWidth(rows[0]) <= width, `${status} ${width}`);
      }
      const expanded = renderer(m, { expanded: true, outputPad: 1 }, theme)!;
      const text = expanded.render(100).join("\n");
      for (const value of [
        id,
        "Build 世界",
        "Continue authorized work",
        "BEGIN UNTRUSTED EVIDENCE",
        "/retained/result.json",
      ])
        assert.ok(text.includes(value), value);
      for (const width of [0, 1, 12, 32, 48, 80])
        assert.ok(
          expanded.render(width).every((s) => visibleWidth(s) <= width),
        );
      compact.invalidate();
      assert.deepEqual(compact.render(100), normal);
      assert.equal(JSON.stringify(m), original);
    }
  });
  test(`${source}: warnings displace identity at supported narrow widths`, () => {
    for (const outcomeUnknown of [false, true])
      for (const effectsMayPersist of [false, true])
        for (const interrupted of [false, true])
          for (const gap of [false, true]) {
            const m = message(source, "timeout", {
              outcomeUnknown,
              effectsMayPersist,
              interrupted,
              gap,
            });
            const rows = notificationRenderer(source)(
              m,
              { expanded: false } as any,
              theme,
            )!.render(48);
            assert.equal(rows.length, 1);
            assert.ok(visibleWidth(rows[0]) <= 48);
            if (outcomeUnknown) assert.match(rows[0], /unknown/);
            else assert.doesNotMatch(rows[0], /effects/);
            if (interrupted) assert.match(rows[0], /interrupted/);
            if (gap) assert.match(rows[0], /gap/);
          }
  });
  test(`${source}: malformed metadata, hostile labels and bounded expansion`, () => {
    const renderer = notificationRenderer(source);
    for (const details of [
      undefined,
      null,
      5,
      [],
      {},
      { display: { version: 2, status: "success" } },
      { display: { version: 1, status: "__proto__", name: {} } },
      {
        display: {
          get version() {
            throw Error("must not invoke");
          },
        },
      },
    ]) {
      const m = { ...message(source, "success"), details };
      assert.match(
        renderer(m, { expanded: false } as any, theme)!.render(80)[0],
        /status unavailable/,
      );
      assert.match(
        renderer(m, { expanded: true } as any, theme)!
          .render(100)
          .join("\n"),
        /Continue authorized work/,
      );
    }
    for (const invalid of [
      { name: {} },
      { owner: 42 },
      { total: -1 },
      { total: NaN },
      { total: 1.5 },
      { mode: "guessed timer" },
      { outcomeUnknown: "true" },
      { effectsMayPersist: 1 },
      {
        get gap() {
          throw Error("must not invoke");
        },
      },
    ]) {
      const m = message(
        source,
        source === "background" ? "success" : "condition",
      );
      Object.defineProperties(
        m.details.display,
        Object.getOwnPropertyDescriptors(invalid),
      );
      assert.match(
        renderer(m, { expanded: false } as any, theme)!.render(100)[0],
        /status unavailable/,
      );
    }
    const hostile = message(source, "timeout", {
      name: "safe\x1b]52;c;secret\x07\n名字\r\x1b[2J\u202eevil",
    });
    hostile.content =
      "text\x1b]8;;https://example.com\x07link\x1b]8;;\x07\n\x1b[31mred\x1b[0m\x00\x9b2J\u202e";
    for (const expanded of [false, true]) {
      const rows = renderer(hostile, { expanded } as any, theme)!.render(32);
      assert.ok(rows.every((s) => visibleWidth(s) <= 32));
      assert.doesNotMatch(
        rows.join("").replace(/\x1b\[[0-9;]*m/g, ""),
        /[\p{Cc}\p{Cf}]|secret|example.com/u,
      );
    }
    const large = message(source, "timeout");
    large.content = "evidence\n".repeat(100_000);
    const before = large.content;
    const rows = renderer(large, { expanded: true } as any, theme)!.render(32);
    assert.ok(rows.length < 2010);
    assert.match(rows.join("\n"), /Display truncated/);
    assert.equal(large.content, before);
  });
}
test("Monitor dispatch metadata is not mutation evidence in either display mode", () => {
  for (const [status, mode, state, color] of [
    ["condition", "observation", "condition met", "success"],
    ["condition", "timer", "timer elapsed", "success"],
    ["timeout", "observation", "timed out", "warning"],
    ["evaluation_failure", "observation", "evaluation failed", "error"],
    ["coverage_failure", "observation", "coverage lost", "error"],
  ]) {
    const m = message("monitor", status, { mode, effectsMayPersist: true });
    const before = JSON.stringify(m);
    const styled: [string, string][] = [];
    const renderer = notificationRenderer("monitor");
    const localTheme = {
      ...theme,
      fg: (token: string, value: string) => {
        styled.push([token, value]);
        return value;
      },
    };
    const line = renderer(m, { expanded: false } as any, localTheme)!.render(
      100,
    )[0];
    assert.ok(line.startsWith(`monitor ${state} Build`), line);
    assert.doesNotMatch(line, /effects|attention/);
    assert.ok(
      styled.some(([token, value]) => token === color && value === state),
    );
    assert.doesNotMatch(
      renderer(m, { expanded: true } as any, localTheme)!
        .render(100)
        .join("\n"),
      /Warnings: effects may persist/,
    );
    assert.equal(JSON.stringify(m), before);
  }
});

test("producer metadata alone selects timer and singular/batch labels", () => {
  for (const [total, source] of [
    [1, "subagent"],
    [2, "subagents"],
  ] as const) {
    const m = message("background", "success", { owner: "subagents", total });
    assert.match(
      notificationRenderer("background")(
        m,
        { expanded: false } as any,
        theme,
      )!.render(100)[0],
      new RegExp(`^${source} succeeded`),
    );
  }
  for (const mode of [undefined, "timer", "observation"]) {
    const m = message("monitor", "condition", { mode });
    m.content = "timer elapsed";
    const line = notificationRenderer("monitor")(
      m,
      { expanded: false } as any,
      theme,
    )!.render(100)[0];
    assert.match(line, mode === "timer" ? /timer elapsed/ : /condition met/);
  }
});
