import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { widgetLines } from "../background/index.ts";
import { renderExecutionResult } from "../background/render.ts";
import type { Execution } from "../background/api.ts";
import { notificationRenderer } from "./notification.ts";
import { renderers as script } from "../script/tool.ts";
import { renderWorkflowResult } from "../workflows/display.ts";
import { renderers as monitor } from "../monitor/tool.ts";
import { renderMailboxResult } from "../mailbox/render.ts";
import { mailboxLine } from "../mailbox/widget.ts";
import { wrapUntrustedContent } from "./untrusted.ts";

function recordingTheme() {
  const styles: [string, string][] = [];
  const theme = {
    fg: (color: string, text: string) => {
      styles.push([color, text]);
      return text;
    },
    bg: (_: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
  return {
    theme,
    styles,
    has: (color: string, text: string) =>
      styles.some(([c, t]) => c === color && t === text),
  };
}
const execution = (status: Execution["status"]): Execution => ({
  id: "id",
  owner: "script",
  label: "Example",
  anchor: "anchor",
  createdAt: 0,
  deadlineMs: 60000,
  status,
  endedAt: status === "running" ? undefined : 5000,
  cancelRequested: false,
  dismissed: false,
  effectsMayPersist: false,
  outcomeUnknown: false,
  notification: { id: "wake", intent: true, handoff: "none", consumed: false },
});

test("all execution adapters share primary state colors across results, widgets and wakes", () => {
  for (const owner of ["script", "subagents", "workflow"]) {
    for (const [status, word, color] of [
      ["running", "running", "accent"],
      ["success", "succeeded", "success"],
      ["failed", "failed", "error"],
      ["timeout", "timed out", "warning"],
      ["cancelled", "canceled", "warning"],
      ["interrupted", "interrupted", "warning"],
    ] as const) {
      const r = { ...execution(status), owner };
      const before = JSON.stringify(r);
      for (const surface of ["result", "widget", "wake"]) {
        if (surface === "wake" && status === "running") continue;
        const s = recordingTheme();
        const row =
          surface === "result"
            ? renderExecutionResult(
                owner,
                [r],
                { content: [], details: undefined },
                {},
                s.theme,
                { args: { action: "inspect" } },
              ).render(200)[0]
            : surface === "widget"
              ? widgetLines([r], 200, s.theme, 6000)[0]
              : notificationRenderer("background")(
                  {
                    role: "custom",
                    customType: "background",
                    content: "evidence",
                    display: true,
                    timestamp: 0,
                    details: {
                      display: { version: 1, owner, status, name: "Example" },
                    },
                  },
                  { expanded: false, outputPad: 0 },
                  s.theme,
                )!.render(200)[0];
        assert.ok(s.has(color, word), `${owner} ${surface}: ${word}`);
        assert.doesNotMatch(row, /…/);
      }
      assert.equal(JSON.stringify(r), before);
    }
  }
});

test("primary queue stays normal while delivery waits are muted and cancellation remains warning", () => {
  const queued = {
    ...execution("running"),
    activity: { started: 1, completed: 0, failed: 0, queued: 1 },
  };
  for (const r of [queued, { ...queued, cancelRequested: true }]) {
    const s = recordingTheme();
    widgetLines([r], 200, s.theme, 6000);
    assert.ok(
      s.has(
        r.cancelRequested ? "warning" : "text",
        r.cancelRequested ? "cancellation requested" : "queued",
      ),
    );
  }
  for (const hold of [undefined, "draft", "input", "dialog"] as const) {
    const s = recordingTheme();
    widgetLines([execution("success")], 200, s.theme, 6000, hold);
    assert.ok(s.has("success", "succeeded"));
    assert.ok(
      s.has("muted", hold ? `waiting for ${hold}` : "delivery pending"),
    );
  }
  const s = recordingTheme();
  const r = execution("success");
  r.notification.handoff = "handed_to_pi";
  widgetLines([r], 200, s.theme, 6000, undefined, new Set(["wake"]));
  assert.ok(s.has("muted", "queued for agent"));
});

test("foreground facts and compact explanations are muted; expanded values stay normal", () => {
  for (const action of ["run", "describe", "list", "validate"]) {
    const s = recordingTheme();
    script.renderResult!(
      {
        content: [],
        details: {
          action,
          calls: 0,
          entries: [
            { name: "example", valid: false, diagnostic: "invalid definition" },
          ],
        },
      },
      { expanded: true, isPartial: false },
      s.theme,
      { args: { action } } as any,
    ).render(200);
    assert.ok(
      s.styles.some(
        ([c, t]) => c === "muted" && /completed|saved script|validated/.test(t),
      ),
      action,
    );
    assert.ok(
      !s.styles.some(([c]) =>
        ["accent", "success", "error", "warning"].includes(c),
      ),
      action,
    );
  }
  const s = recordingTheme();
  script.renderResult!(
    {
      content: [],
      details: {
        status: "failed",
        code: "provider_error",
        traces: [
          {
            id: "1",
            tool: "example.lookup",
            state: "succeeded",
            durationMs: 20,
          },
        ],
      },
    },
    { expanded: true, isPartial: false },
    s.theme,
    { args: { action: "run" } } as any,
  ).render(200);
  assert.ok(s.has("error", "failed"));
  assert.ok(s.has("muted", "succeeded"));
  assert.deepEqual(
    s.styles.filter(([c]) => c === "error").map(([, t]) => t),
    ["failed"],
  );
  const w = recordingTheme();
  renderWorkflowResult(
    {
      content: [],
      details: {
        action: "list",
        inventory: {
          entries: [
            {
              name: "example",
              valid: false,
              diagnostic: "missing run function",
            },
          ],
        },
      },
    },
    { expanded: true },
    w.theme,
    { state: {} },
  ).render(200);
  assert.ok(w.has("text", "invalid"));
  assert.ok(w.has("text", "missing run function"));
  assert.ok(!w.styles.some(([c]) => c === "error" || c === "success"));
});

test("compact supporting IDs and registration facts are muted without muting primary states", () => {
  const s = recordingTheme();
  renderExecutionResult(
    "script",
    [execution("running")],
    { content: [], details: undefined },
    {},
    s.theme,
    { args: { action: "run" } },
  ).render(200);
  assert.ok(s.has("accent", "running"));
  assert.ok(s.has("muted", "id"));
  const m = recordingTheme();
  monitor.renderResult!(
    {
      content: [],
      details: { action: "start", receipt: { delayMs: 5000, cycleMs: 30000 } },
    },
    { expanded: false, isPartial: false },
    m.theme,
    { args: { action: "start" } } as any,
  ).render(200);
  assert.ok(m.has("muted", "scheduled in 5s"));
  assert.ok(m.has("muted", "timeout 30s"));
});

test("mailbox summaries are muted facts and input waits do not change delivery status", () => {
  for (const [args, value, expected] of [
    [
      { action: "ack", mailbox: "example", ids: ["id"] },
      { mailbox: "example", acknowledged: 1 },
      "acked 1 message",
    ],
    [
      { action: "list", mailbox: "example" },
      { mailbox: "example", pending: 0, messages: [], nextCursor: null },
      "no unacked messages",
    ],
  ] as const) {
    const s = recordingTheme();
    renderMailboxResult(
      {
        content: [
          {
            type: "text",
            text: wrapUntrustedContent("MAILBOX RESULT", JSON.stringify(value)),
          },
        ],
        details: {},
      },
      { expanded: false, isPartial: false },
      s.theme,
      { args },
    ).render(200);
    assert.ok(s.has("muted", expected));
    assert.ok(!s.styles.some(([c]) => c === "success" || c === "accent"));
  }
  const s = recordingTheme();
  const status = {
    pending: 3,
    limited: 0,
    uncertain: 0,
    unavailable: false,
    wakeAt: 0,
    hold: "idle" as const,
  };
  const before = JSON.stringify(status);
  assert.equal(
    mailboxLine(status, 1, 100, s.theme, 0, "input"),
    "mailbox 3 unacked · waiting for input",
  );
  assert.ok(s.has("muted", "waiting for input"));
  assert.ok(s.has("text", "3 unacked"));
  assert.equal(JSON.stringify(status), before);
});
