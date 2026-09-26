import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "./test-support.ts";
import type { Receipt } from "./contract.ts";
import {
  parameters,
  pollingWarning,
  renderers,
  summary,
  widgetLines,
  type DisplayDetails,
} from "./tool.ts";

const now = 10000;
function receipt(patch: Partial<Receipt> = {}): Receipt {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    name: "CI check",
    createdAt: 0,
    deadline: 60000,
    cycleDeadline: 22000,
    cycleMs: 18000,
    intervalMs: 3000,
    eventCount: 0,
    nextAt: 13000,
    status: "active",
    recurring: false,
    maxWakes: 1,
    wakes: 0,
    evaluations: 4,
    calls: 0,
    inFlight: false,
    awaitingSettlement: false,
    state: null,
    evidence: null,
    coverage: [],
    gap: false,
    interrupted: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
    ...patch,
  };
}
function render(
  details: DisplayDetails,
  expanded = false,
  args: any = {},
  options: any = {},
) {
  return renderers.renderResult!(
    { content: [], details },
    { expanded, isPartial: false, ...options },
    theme,
    { args, ...options } as any,
  );
}
const text = (details: DisplayDetails, expanded = false) =>
  render(details, expanded).render(250).join("\n");
const display = (r: Receipt) => summary(r);

test("list counts distinguish active jobs, retained receipts and pending attention", () => {
  assert.equal(text({ action: "list", receipts: [] }), "no jobs");
  const receipts = [
    display(receipt()),
    display(receipt({ status: "finished" })),
    display(receipt({ status: "cancelled" })),
  ];
  assert.equal(text({ action: "list", receipts }), "1 active · 3 retained");
  assert.match(
    text({ action: "list", receipts: receipts.slice(1) }),
    /^no active jobs · 2 retained$/,
  );
  assert.match(text({ action: "list", receipts }, true), /polling · CI check/);
  assert.doesNotMatch(text({ action: "list", receipts }), /CI check/);
});

test("start describes timer, recurrence, event and compound registrations without claiming completion", () => {
  for (const [patch, expected] of [
    [{}, "polling every 3s"],
    [{ intervalMs: undefined, delayMs: 5000 }, "scheduled in 5s"],
    [
      { intervalMs: undefined, delayMs: 5000, recurring: true, maxWakes: 2 },
      "every 5s after settlement",
    ],
    [{ intervalMs: undefined, eventCount: 1 }, "watching events"],
    [{ eventCount: 1 }, "polling every 3s + events"],
  ] as const) {
    const line = text({ action: "start", receipt: display(receipt(patch)) });
    assert.ok(line.includes(expected), line);
    assert.match(line, /timeout 18s/);
    assert.doesNotMatch(line, /finished|success/);
  }
});

test("clock schema describes settlement delay, observation expiry and outer ceiling", () => {
  const fields = JSON.parse(
    JSON.stringify(
      parameters({
        maxCycleTimeoutMs: 3600000,
        maxLifetimeMs: 172800000,
        valid: true,
      }),
    ),
  ).properties as Record<string, { description: string; maximum: number }>;
  assert.equal(fields.cycle_timeout_ms.maximum, 3600000);
  assert.equal(fields.interval_ms.maximum, 3600000);
  assert.equal(fields.lifetime_ms.maximum, 172800000);
  assert.match(
    fields.interval_ms.description!,
    /after each evaluation settles/,
  );
  assert.match(fields.cycle_timeout_ms.description!, /NOT a per-call timeout/);
  assert.match(
    fields.cycle_timeout_ms.description!,
    /One-shot expiry ends observation/,
  );
  assert.match(
    fields.lifetime_ms.description!,
    /Does not override earlier cycle expiry/,
  );
});

test("polling warning is bounded, prominent, event-aware and display-safe", () => {
  for (const intervalMs of [30000, 60000]) {
    for (const eventCount of [0, 1]) {
      const r = display(
        receipt({
          intervalMs,
          cycleMs: 30000,
          eventCount,
          name: "\u001b]0;hostile\u0007CI\ncheck",
          evidence: "SECRET",
        }),
      );
      const warning = pollingWarning(r)!;
      assert.ok(warning.length < 600);
      assert.match(warning, /at or beyond that deadline/);
      assert.equal(
        warning.includes("Events may still trigger"),
        eventCount > 0,
      );
      for (const expanded of [false, true]) {
        const details = { action: "start", receipt: r };
        assert.match(
          text(details, expanded),
          expanded ? /Warning:/ : /registered; no repeat poll/,
        );
        const component = render(details, expanded);
        if (!expanded) {
          assert.equal(component.render(48).length, 1);
          assert.match(component.render(48)[0], /no repeat poll/);
        }
        for (let width = 0; width < 100; width++)
          for (const line of component.render(width)) {
            assert.ok(visibleWidth(line) <= width);
            assert.doesNotMatch(line, /hostile|SECRET|\u0007|\n/);
          }
      }
      assert.doesNotMatch(text({ action: "get", receipt: r }), /Warning:/);
    }
  }
  for (const patch of [{ intervalMs: undefined }, { intervalMs: 1000 }])
    assert.equal(pollingWarning(display(receipt(patch))), undefined);
});

test("get uses a short title identity and muted section separators without repeating the name", () => {
  const r = receipt({ status: "finished", wakes: 1, evaluations: 2 });
  assert.equal(
    renderers.renderCall!({ action: "get", id: r.id }, theme, {} as any).render(
      120,
    )[0],
    "monitor get 11111111",
  );
  assert.equal(
    text({ action: "get", receipt: display(r) }),
    "finished · 1 wake · 2 evaluations",
  );
  assert.match(
    text({ action: "get", receipt: display(r) }, true),
    /CI check.*11111111-2222/,
  );
  const marked = {
    ...theme,
    fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
  };
  const row = renderers.renderResult!(
    { content: [], details: { action: "get", receipt: display(r) } },
    { expanded: false, isPartial: false },
    marked as any,
    {} as any,
  ).render(1000)[0];
  assert.match(row, /<dim> · <\/dim>/);
  assert.match(row, /<muted>2 evaluations<\/muted>/);
});

test("get shows selected job state, counters and honest terminal reasons", () => {
  assert.match(
    text({ action: "get", receipt: display(receipt()) }),
    /polling · 0 wakes · 4 evaluations/,
  );
  const failed = receipt({
    status: "finished",
    failureCode: "script_error",
    lastAttention: {
      id: "wake",
      reason: "evaluation_failure",
      at: now,
      disposition: "handed_to_pi",
      admitted: true,
    },
  });
  assert.match(
    text({ action: "get", receipt: display(failed) }),
    /evaluation failed · script_error/,
  );
  assert.match(
    text({
      action: "get",
      receipt: display(
        receipt({ status: "finished", failureCode: "wake_limit" }),
      ),
    }),
    /wake limit reached/,
  );
  assert.match(
    text({
      action: "get",
      receipt: display(
        receipt({
          awaitingSettlement: true,
          recurring: true,
          wakes: 1,
          maxWakes: 2,
        }),
      ),
    }),
    /awaiting settlement.*wakes 1\/2/,
  );
});

test("cancel distinguishes changed versus terminal jobs and preserves effect/handoff caveats", () => {
  const r = receipt({ status: "cancelled" });
  assert.equal(
    text({ action: "cancel", receipt: display(r), cancelChanged: true }),
    "cancelled",
  );
  assert.equal(
    text({ action: "cancel", receipt: display(r), cancelChanged: false }),
    "already cancelled",
  );
  assert.match(
    text({
      action: "cancel",
      receipt: display(receipt({ status: "finished" })),
      cancelChanged: false,
    }),
    /already finished/,
  );
  r.outcomeUnknown = true;
  r.lastAttention = {
    id: "wake",
    reason: "condition",
    at: now,
    disposition: "handed_to_pi",
    admitted: true,
  };
  assert.match(
    text({ action: "cancel", receipt: display(r), cancelChanged: true }),
    /effects unknown; no replay/,
  );
  assert.match(
    text({ action: "cancel", receipt: display(r), cancelChanged: true }, true),
    /follow-up already handed off/,
  );
  r.lastAttention.disposition = "handoff_unknown";
  assert.match(
    text({ action: "cancel", receipt: display(r) }),
    /unknown; no replay/,
  );
  assert.match(
    text({ action: "cancel", receipt: display(r) }, true),
    /handoff uncertain/,
  );
});

test("widgets label polling clocks, preserve name and distinguish deadline from expiry", () => {
  assert.equal(
    widgetLines([receipt()], now, 120, theme)[0],
    "monitor watching CI check · polling · next check 3s · timeout 12s",
  );
  assert.match(
    widgetLines([receipt({ inFlight: true })], now, 120, theme)[0],
    /checking CI check · polling · timeout 12s/,
  );
  assert.doesNotMatch(
    widgetLines([receipt({ inFlight: true })], now, 120, theme)[0],
    /next check/,
  );
  assert.match(
    widgetLines([receipt({ deadline: 15000 })], now, 120, theme)[0],
    /expires 5s/,
  );
  const narrow = widgetLines([receipt()], now, 40, theme)[0];
  assert.match(narrow, /^monitor watching CI check/);
  assert.doesNotMatch(narrow, /wake 3s/);
  const long = widgetLines(
    [
      receipt({
        name: "A very long job name that should never erase the state",
      }),
    ],
    now,
    45,
    theme,
  )[0];
  assert.match(long, /watching/);
  assert.ok(visibleWidth(long) <= 45);
});

test("widgets distinguish continuation, events, queued attention and settlement", () => {
  assert.match(
    widgetLines(
      [
        receipt({
          intervalMs: undefined,
          delayMs: 5000,
          recurring: true,
          maxWakes: 2,
        }),
      ],
      now,
      150,
      theme,
    )[0],
    /monitor scheduled CI check · in 3s.*wakes 0\/2/,
  );
  assert.match(
    widgetLines(
      [receipt({ intervalMs: undefined, eventCount: 1, nextAt: undefined })],
      now,
      150,
      theme,
    )[0],
    /watching CI check · events · timeout 12s/,
  );
  const waiting = receipt({
    awaitingSettlement: true,
    recurring: true,
    maxWakes: 2,
    wakes: 1,
  });
  const line = widgetLines([waiting], now, 150, theme)[0];
  assert.match(line, /awaiting settlement CI check · wakes 1\/2 · expires 50s/);
  assert.doesNotMatch(line, /next check|timeout|continue in/);
  for (const [reason, expected] of [
    ["condition", "condition met"],
    ["timeout", "timed out"],
    ["evaluation_failure", "evaluation failed"],
  ] as const) {
    const r = receipt({
      status: "finished",
      attention: {
        id: "wake",
        reason,
        at: now,
        disposition: "pending",
        admitted: false,
      },
    });
    assert.ok(
      widgetLines([r], now, 150, theme)[0].includes(
        `${expected} CI check · follow-up queued`,
      ),
    );
    assert.deepEqual(
      widgetLines(
        [{ ...r, attention: { ...r.attention!, disposition: "suppressed" } }],
        now,
        150,
        theme,
      ),
      [],
    );
  }
});

test("uncertain control errors retain both failed request and no-replay status", () => {
  const r = display(receipt({ outcomeUnknown: true }));
  for (const semantic of [false, true]) {
    const row = render(
      { action: "cancel", receipt: r, monitorError: semantic },
      false,
      {},
      { isError: !semantic },
    ).render(48);
    assert.equal(row.length, 1);
    assert.match(row[0], /failed.*unknown.*no replay/);
  }
});

test("widget reserves uncertainty before optional names, queued status and clocks", () => {
  const r = receipt({
    name: "OPTIONAL".repeat(20),
    outcomeUnknown: true,
    interrupted: true,
    gap: true,
    attention: {
      id: "wake",
      reason: "evaluation_failure",
      at: now,
      disposition: "pending",
      admitted: false,
    },
    lastAttention: {
      id: "old",
      reason: "condition",
      at: now,
      disposition: "handoff_unknown",
      admitted: false,
    },
  });
  const line = widgetLines([r], now, 64, theme)[0];
  assert.match(line, /^monitor evaluation failed/);
  assert.match(line, /unknown\/interrupted\/gap\/handoff\?/);
  assert.doesNotMatch(line, /queued|timeout/);
  assert.ok(visibleWidth(line) <= 64);
  r.interrupted = false;
  r.gap = false;
  r.lastAttention = undefined;
  assert.match(widgetLines([r], now, 48, theme)[0], /unknown/);
});

test("widget state styling, adjacent identity and routine effect suppression", () => {
  const cases: [Partial<Receipt>, string, string][] = [
    [{ eventCount: 1, effectsMayPersist: true }, "watching", "accent"],
    [{ inFlight: true }, "checking", "accent"],
    [{ delayMs: 5000 }, "scheduled", "accent"],
    [{ awaitingSettlement: true }, "awaiting settlement", "warning"],
  ];
  for (const reason of [
    "condition",
    "timeout",
    "evaluation_failure",
    "coverage_failure",
  ] as const) {
    cases.push([
      {
        attention: {
          id: "wake",
          reason,
          at: now,
          disposition: "pending",
          admitted: false,
        },
      },
      {
        condition: "condition met",
        timeout: "timed out",
        evaluation_failure: "evaluation failed",
        coverage_failure: "coverage lost",
      }[reason],
      reason.includes("failure")
        ? "error"
        : reason === "condition"
          ? "success"
          : "warning",
    ]);
  }
  cases.push([
    {
      delayMs: 5000,
      attention: {
        id: "wake",
        reason: "condition",
        at: now,
        disposition: "pending",
        admitted: false,
      },
    },
    "timer elapsed",
    "success",
  ]);
  for (const [patch, state, color] of cases) {
    const styled: [string, string][] = [];
    const r = receipt(patch);
    const before = JSON.stringify(r);
    const line = widgetLines([r], now, 150, {
      ...theme,
      fg: (token: string, value: string) => {
        styled.push([token, value]);
        return value;
      },
    } as any)[0];
    assert.ok(line.startsWith(`monitor ${state} CI check`), line);
    assert.ok(
      styled.some(([token, value]) => token === color && value === state),
    );
    assert.ok(
      styled.some(([token, value]) => token === "muted" && value === "monitor"),
    );
    assert.doesNotMatch(line, /effects may persist|watching events/);
    assert.equal(JSON.stringify(r), before);
  }
  const line = widgetLines(
    [receipt({ outcomeUnknown: true })],
    now,
    150,
    theme,
  )[0];
  assert.match(
    line,
    /^monitor watching CI check · polling · next check 3s · timeout 12s · effects uncertain$/,
  );
});

test("widget mechanism is muted, secondary to timing and warnings, and absent during attention", () => {
  const r = receipt({ eventCount: 1 });
  const styled: [string, string][] = [];
  const localTheme = {
    ...theme,
    fg: (token: string, value: string) => {
      styled.push([token, value]);
      return value;
    },
  } as any;
  assert.equal(
    widgetLines([r], now, 120, localTheme)[0],
    "monitor watching CI check · polling + events · next check 3s · timeout 12s",
  );
  assert.ok(
    styled.some(
      ([token, value]) => token === "muted" && value === "polling + events",
    ),
  );
  assert.equal(
    widgetLines([r], now, 55, theme)[0],
    "monitor watching CI check · next check 3s · timeout 12s",
  );
  const warning = widgetLines(
    [{ ...r, outcomeUnknown: true }],
    now,
    76,
    theme,
  )[0];
  assert.match(warning, /next check 3s · timeout 12s · effects uncertain/);
  assert.doesNotMatch(warning, /polling|events/);
  for (const patch of [
    { intervalMs: undefined, eventCount: undefined },
    { awaitingSettlement: true },
    { delayMs: 5000 },
    {
      attention: {
        id: "wake",
        reason: "condition" as const,
        at: now,
        disposition: "pending" as const,
        admitted: false,
      },
    },
  ])
    assert.doesNotMatch(
      widgetLines([{ ...r, ...patch }], now, 120, theme)[0],
      /polling|events/,
    );
});

test("monitor expansion preserves original framed evidence without changing payloads", () => {
  const result = {
    content: [
      {
        type: "text" as const,
        text: "BEGIN UNTRUSTED MONITOR EVIDENCE\nPRIVATE_EVIDENCE\nEND UNTRUSTED MONITOR EVIDENCE",
      },
    ],
    details: { action: "get", receipt: display(receipt()) },
  };
  const before = JSON.stringify(result);
  for (const expanded of [false, true]) {
    const lines = renderers.renderResult!(
      result,
      { expanded, isPartial: false },
      theme,
      { args: { action: "get" } } as any,
    )
      .render(120)
      .join("\n");
    assert.equal(lines.includes("PRIVATE_EVIDENCE"), expanded);
    if (expanded) assert.match(lines, /BEGIN UNTRUSTED MONITOR EVIDENCE/);
  }
  assert.equal(JSON.stringify(result), before);
});

test("failed jobs use error styling without marking an inspection request failed", () => {
  const colors: string[] = [];
  const r = receipt({
    status: "finished",
    failureCode: "script_error",
    lastAttention: {
      id: "wake",
      reason: "evaluation_failure",
      at: now,
      disposition: "handed_to_pi",
      admitted: true,
    },
  });
  const rendered = renderers.renderResult!(
    { content: [], details: { action: "get", receipt: display(r) } },
    { expanded: false, isPartial: false },
    {
      ...theme,
      fg: (color: string, value: string) => {
        colors.push(color);
        return value;
      },
    } as any,
    {} as any,
  );
  assert.match(rendered.render(200)[0], /evaluation failed/);
  assert.ok(colors.includes("error"));
  assert.ok(!colors.includes("success"));
  assert.doesNotMatch(rendered.render(200)[0], /request failed/);
});

test("all tool actions are safe, bounded, reusable and contextual on failures", () => {
  const r = receipt({
    name: "\x1b]0;hostile\x07CI\ncheck",
    evidence: "SECRET evidence",
    state: "SECRET state",
  });
  for (const action of ["start", "list", "get", "cancel"]) {
    const details = { action, receipt: display(r), receipts: [display(r)] };
    for (const expanded of [false, true]) {
      const component = render(details, expanded);
      for (let width = 0; width < 100; width++) {
        for (const line of component.render(width)) {
          assert.ok(visibleWidth(line) <= width);
          assert.doesNotMatch(line, /SECRET|hostile|\x07|\n/);
        }
      }
      const reused = renderers.renderResult!(
        { content: [], details },
        { expanded, isPartial: false },
        theme,
        { lastComponent: component } as any,
      );
      assert.equal(reused, component);
    }
    for (const options of [{ isError: true }, {}]) {
      const rendered = render(
        { action, monitorError: !options.isError },
        false,
        { id: "job-id" },
        options,
      )
        .render(200)
        .join("\n");
      assert.match(rendered, /^request failed/);
    }
    assert.doesNotMatch(
      render(details, false, {}, { isPartial: true }).render(200).join("\n"),
      /inspected|SECRET/,
    );
  }
  for (let width = 0; width < 150; width++) {
    const line = widgetLines([r], now, width, theme)[0];
    assert.ok(visibleWidth(line) <= width);
    assert.doesNotMatch(line, /SECRET|hostile|\x07|\n/);
  }
});
