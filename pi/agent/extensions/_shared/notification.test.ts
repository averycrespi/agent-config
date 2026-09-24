import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { notificationRenderer } from "./notification.ts";

const colors: string[] = [];
const theme: any = {
  fg: (color: string, text: string) => {
    colors.push(color);
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
      'Continue authorized work.\nBEGIN UNTRUSTED EVIDENCE\n{"result":42}\nEND UNTRUSTED EVIDENCE\nFull result: /retained/result.json\nOutput truncated upstream; inspect retained result.',
    details: {
      [source === "background" ? "executionId" : "jobId"]: id,
      display: { version: 1, name: "Build 世界 👩‍💻", status, ...extra },
    },
  } as any;
}
for (const source of ["background", "monitor"] as const) {
  test(`${source}: ordinary and adverse outcomes remain compact, contextual, expandable and truthful`, () => {
    const statuses =
      source === "background"
        ? {
            success: "execution succeeded",
            failed: "execution failed",
            timeout: "execution timed out",
            cancelled: "execution cancelled",
            interrupted: "execution interrupted",
          }
        : {
            condition: "condition attention",
            timeout: "observation timed out",
            evaluation_failure: "evaluation failed",
            coverage_failure: "coverage lost",
            budget_exhausted: "observation budget exhausted",
          };
    const renderer = notificationRenderer(source);
    for (const [status, expected] of Object.entries(statuses)) {
      const m = message(source, status);
      const original = JSON.stringify(m);
      const compact = renderer(m, { expanded: false } as any, theme)!;
      colors.length = 0;
      const normal = compact.render(80);
      assert.equal(normal.length, 2);
      assert.match(normal[0], new RegExp(source));
      assert.match(normal[0], /Build 世界/);
      assert.match(normal[0], /11111111/);
      assert.equal(normal[1], expected);
      assert.doesNotMatch(
        normal.join("\n"),
        /Continue|result.json|UNTRUSTED|\{"result"/,
      );
      if (source === "monitor") assert.ok(!colors.includes("success"));
      for (let width = 0; width <= 100; width++) {
        const lines = compact.render(width);
        assert.ok(lines.length <= 3);
        assert.ok(
          lines.every((line) => visibleWidth(line) <= width),
          `${status} ${width}`,
        );
        if (width >= 32) assert.equal(lines[1], expected);
      }
      const expanded = renderer(m, { expanded: true, outputPad: 1 }, theme)!;
      const full = expanded.render(100).join("\n");
      for (const text of [
        id,
        "Build 世界",
        "Continue authorized work",
        "BEGIN UNTRUSTED EVIDENCE",
        "/retained/result.json",
        "Output truncated upstream",
      ])
        assert.ok(full.includes(text), text);
      for (const width of [0, 1, 2, 12, 32, 80])
        assert.ok(
          expanded.render(width).every((line) => visibleWidth(line) <= width),
        );
      compact.invalidate();
      assert.deepEqual(compact.render(80), normal);
      assert.deepEqual(
        renderer(m, { expanded: false } as any, theme)!.render(80),
        normal,
      );
      assert.equal(JSON.stringify(m), original);
    }
  });
  test(`${source}: warnings, malformed/historical metadata and hostile text are safe`, () => {
    const renderer = notificationRenderer(source);
    const adverse = message(source, "timeout", {
      outcomeUnknown: true,
      interrupted: true,
      gap: true,
    });
    const compact = renderer(
      adverse,
      { expanded: false } as any,
      theme,
    )!.render(32);
    assert.equal(compact.length, 3);
    assert.equal(compact[2], "effects unknown/interrupted/gap");
    for (const outcomeUnknown of [false, true])
      for (const effectsMayPersist of [false, true])
        for (const interrupted of [false, true])
          for (const gap of [false, true]) {
            const flags = message(source, "timeout", {
              outcomeUnknown,
              effectsMayPersist,
              interrupted,
              gap,
            });
            const rows = renderer(
              flags,
              { expanded: false, outputPad: 1 },
              theme,
            )!.render(32);
            assert.ok(rows.length <= 3);
            const warning = rows[2] ?? "";
            assert.ok(visibleWidth(warning) <= 32);
            if (outcomeUnknown) assert.match(warning, /effects unknown/);
            else if (effectsMayPersist)
              assert.match(warning, /effects (may persist|possible)/);
            if (interrupted) assert.match(warning, /interrupted/);
            if (gap) assert.match(warning, /gap/);
          }
    assert.match(
      renderer(adverse, { expanded: true } as any, theme)!
        .render(120)
        .join("\n"),
      /coverage gap/,
    );
    for (const details of [
      undefined,
      null,
      5,
      [],
      {},
      { display: { version: 2, status: "success" } },
      { display: { version: 1, status: "__proto__", name: {} } },
      { display: { version: 1, status: "toString" } },
      {
        display: {
          get version() {
            throw Error("never invoke");
          },
        },
      },
    ]) {
      const m = { ...message(source, "success"), details };
      const rows = renderer(m, { expanded: false } as any, theme)!.render(80);
      assert.equal(rows.length, 2);
      assert.match(rows.join("\n"), /status unavailable/);
      assert.match(
        renderer(m, { expanded: true } as any, theme)!
          .render(100)
          .join("\n"),
        /Continue authorized work/,
      );
    }
    const hostile = message(source, "timeout", {
      name: "safe\x1b]52;c;secret\x07\n名字\r\x1b[2J\u202eevil",
    });
    hostile.content =
      "text\x1b]8;;https://example.com\x07link\x1b]8;;\x07\n\x1b[31mred\x1b[0m\x00\x9b2J\u202e";
    for (const expanded of [false, true]) {
      const rows = renderer(hostile, { expanded } as any, theme)!.render(32);
      assert.ok(rows.every((line) => visibleWidth(line) <= 32));
      assert.doesNotMatch(
        rows.join("").replace(/\x1b\[[0-9;]*m/g, ""),
        /[\p{Cc}\p{Cf}]|secret|example.com/u,
      );
    }
    const mixed = {
      ...message(source, "timeout"),
      content: [
        { type: "image", data: "PRIVATE" },
        { type: "text", text: "safe evidence" },
      ],
    } as any;
    const mixedText = renderer(mixed, { expanded: true } as any, theme)!
      .render(80)
      .join("\n");
    assert.match(mixedText, /safe evidence/);
    assert.doesNotMatch(mixedText, /PRIVATE/);
  });
  test(`${source}: oversized expanded display is bounded and explicitly disclosed without changing content`, () => {
    const m = message(source, "timeout");
    m.content = "evidence\n".repeat(100_000);
    const before = m.content;
    const rows = notificationRenderer(source)(
      m,
      { expanded: true } as any,
      theme,
    )!.render(32);
    assert.ok(rows.length < 2010);
    assert.match(rows.join("\n"), /Display truncated/);
    assert.ok(rows.every((line) => visibleWidth(line) <= 32));
    assert.equal(m.content, before);
  });
}
