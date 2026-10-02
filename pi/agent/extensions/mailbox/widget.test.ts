import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { mailboxLine } from "./widget.ts";
import { mailboxNotification } from "./notification.ts";
import type { DeliveryStatus } from "./delivery.ts";
const base: DeliveryStatus = {
  pending: 0,
  limited: 0,
  uncertain: 0,
  hold: null,
  unavailable: false,
};
const theme = {
  fg: (_: string, s: string) => s,
  bold: (s: string) => s,
  bg: (_: string, s: string) => s,
} as Theme;
test("widget exact states, countdown ceiling, holds, totals and independent warnings", () => {
  assert.equal(mailboxLine(base, 0, 100, theme), "mailbox listening · empty");
  assert.equal(
    mailboxLine({ ...base, pending: 3, wakeAt: 3500 }, 0, 100, theme),
    "mailbox pending · 3 unacked · wake in 4s",
  );
  for (const hold of ["idle", "draft", "dialog"] as const)
    assert.match(
      mailboxLine({ ...base, pending: 3, wakeAt: 0, hold }, 1, 100, theme),
      hold === "idle" ? /wake pending/ : new RegExp(`wake held: ${hold}`),
    );
  assert.match(
    mailboxLine({ ...base, pending: 3, redeliveryAt: 240000 }, 0, 100, theme),
    /redelivery in 4m/,
  );
  assert.equal(
    mailboxLine({ ...base, unavailable: true }, 0, 100, theme),
    "mailbox unavailable · /mailbox",
  );
  const colors: [string, string][] = [];
  mailboxLine({ ...base, pending: 5, limited: 2, wakeAt: 3000 }, 0, 100, {
    ...theme,
    fg: (color, text) => {
      colors.push([color, text]);
      return text;
    },
  } as Theme);
  assert.ok(colors.some(([c, t]) => c === "warning" && t === "2 at limit"));
  assert.ok(colors.some(([c, t]) => c === "text" && t === "5 unacked"));
  for (const width of [0, 1, 12, 32, 48, 80])
    assert.ok(
      visibleWidth(
        mailboxLine(
          { ...base, pending: 5, limited: 2, wakeAt: 3000 },
          0,
          width,
          theme,
        ),
      ) <= width,
    );
  assert.match(
    mailboxLine(
      { ...base, pending: 5, limited: 2, wakeAt: 3000 },
      0,
      36,
      theme,
    ),
    /2 at limit/,
  );
});
test("queued admission is visible independently of inbox counts and redelivery", () => {
  for (const pending of [0, 3]) {
    const s = { ...base, pending, redeliveryAt: 240000 };
    for (const width of [0, 1, 32, 48, 100]) {
      const line = mailboxLine(s, 0, width, theme, 1);
      assert.ok(visibleWidth(line) <= width);
      if (width >= 48) assert.match(line, /queued for agent/);
      assert.doesNotMatch(line, /redelivery in/);
    }
    assert.match(
      mailboxLine(s, 0, 100, theme, 1),
      /mailbox pending · queued for agent/,
    );
    assert.doesNotMatch(mailboxLine(s, 0, 100, theme, 0), /queued for agent/);
  }
  const warning = mailboxLine(
    { ...base, pending: 3, uncertain: 1, wakeAt: 0, hold: "draft" },
    0,
    160,
    theme,
    1,
  );
  assert.match(warning, /queued for agent/);
  assert.match(warning, /handoff uncertain/);
  assert.match(warning, /wake held: draft/);
});

test("delivery warnings stay independent and countdown values use text color", () => {
  for (const hold of ["idle", "draft", "dialog"] as const) {
    const colors: [string, string][] = [];
    const styled = {
      ...theme,
      fg: (color: string, text: string) => {
        colors.push([color, text]);
        return text;
      },
    } as Theme;
    const input = { ...base, pending: 3, wakeAt: 0, hold };
    const wake = hold === "idle" ? "wake pending" : `wake held: ${hold}`;
    assert.equal(
      mailboxLine(input, 1, 100, styled),
      `mailbox pending · 3 unacked · ${wake}`,
    );
    assert.ok(colors.some(([c, t]) => c === "warning" && t === wake));
    assert.ok(colors.some(([c, t]) => c === "warning" && t === "pending"));
    assert.ok(colors.some(([c, t]) => c === "text" && t === "3 unacked"));
    assert.ok(mailboxLine(input, 1, 36, theme).includes(wake));
    colors.length = 0;
    mailboxLine({ ...base, pending: 3, wakeAt: 3500 }, 0, 100, styled);
    assert.ok(colors.some(([c, t]) => c === "muted" && t === "wake in "));
    assert.ok(colors.some(([c, t]) => c === "text" && t === "4s"));
    colors.length = 0;
    mailboxLine({ ...base, pending: 3, redeliveryAt: 240000 }, 0, 100, styled);
    assert.ok(colors.some(([c, t]) => c === "muted" && t === "redelivery in "));
    assert.ok(colors.some(([c, t]) => c === "text" && t === "4m"));
  }
});

test("wake renderer preserves model content, hides body collapsed and sanitizes bounded expansion", () => {
  const message = {
    role: "custom" as const,
    customType: "mailbox-wake",
    content: "PRIVATE\x1b[2J\nbody\u202e",
    display: true,
    timestamp: 0,
  };
  const before = JSON.stringify(message);
  for (const expanded of [false, true]) {
    const component = mailboxNotification(
      message,
      { expanded, outputPad: 0 },
      theme,
    )!;
    for (const width of [0, 1, 12, 48, 120]) {
      const rows = component.render(width);
      assert.ok(rows.every((row) => visibleWidth(row) <= width));
      assert.ok(
        rows.every(
          (row) => !/[\x00-\x1f\u202e]/.test(stripVTControlCharacters(row)),
        ),
      );
      if (!expanded) assert.ok(!rows.join(" ").includes("PRIVATE"));
    }
  }
  assert.equal(JSON.stringify(message), before);
});
