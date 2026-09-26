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
      hold === "idle" ? /awaiting idle/ : new RegExp(`held: ${hold}`),
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
