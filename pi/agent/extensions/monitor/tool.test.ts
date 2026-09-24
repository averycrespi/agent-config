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
  assert.match(text({ action: "list", receipts }, true), /CI check · polling/);
  assert.doesNotMatch(text({ action: "list", receipts }), /CI check/);
});

test("start describes timer, recurrence, event and compound registrations without claiming completion", () => {
  for (const [patch, expected] of [
    [{}, "polling every 3s"],
    [{ intervalMs: undefined, delayMs: 5000 }, "scheduled · in 5s"],
    [
      { intervalMs: undefined, delayMs: 5000, recurring: true, maxWakes: 2 },
      "every 5s after settlement",
    ],
    [{ intervalMs: undefined, eventCount: 1 }, "watching events"],
    [{ eventCount: 1 }, "polling every 3s + events"],
  ] as const) {
    const line = text({ action: "start", receipt: display(receipt(patch)) });
    assert.ok(line.includes(expected), line);
    assert.match(line, /CI check.*timeout 18s/);
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
        assert.match(text(details, expanded), /Warning:/);
        const component = render(details, expanded);
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

test("get shows selected job state, counters and honest terminal reasons", () => {
  assert.match(
    text({ action: "get", receipt: display(receipt()) }),
    /CI check · polling · 0 wakes · 4 evaluations/,
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
    "CI check · cancelled",
  );
  assert.equal(
    text({ action: "cancel", receipt: display(r), cancelChanged: false }),
    "CI check · already cancelled",
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
    /effects uncertain · follow-up already handed off/,
  );
  r.lastAttention.disposition = "handoff_unknown";
  assert.match(
    text({ action: "cancel", receipt: display(r) }),
    /handoff uncertain/,
  );
});

test("widgets label polling clocks, preserve name and distinguish deadline from expiry", () => {
  assert.equal(
    widgetLines([receipt()], now, 120, theme)[0],
    "monitor · CI check · polling · next check 3s · timeout 12s",
  );
  assert.match(
    widgetLines([receipt({ inFlight: true })], now, 120, theme)[0],
    /checking · timeout 12s/,
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
  assert.match(narrow, /CI check · polling/);
  assert.doesNotMatch(narrow, /monitor|wake 3s/);
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
  assert.match(long, /polling/);
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
    /continue in 3s.*wakes 0\/2/,
  );
  assert.match(
    widgetLines(
      [receipt({ intervalMs: undefined, eventCount: 1, nextAt: undefined })],
      now,
      150,
      theme,
    )[0],
    /watching events · timeout 12s/,
  );
  const waiting = receipt({
    awaitingSettlement: true,
    recurring: true,
    maxWakes: 2,
    wakes: 1,
  });
  const line = widgetLines([waiting], now, 150, theme)[0];
  assert.match(line, /awaiting settlement · wakes 1\/2 · expires 50s/);
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
        `${expected} · follow-up queued`,
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
  assert.deepEqual(colors, ["error"]);
  assert.match(rendered.render(200)[0], /evaluation failed/);
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
      assert.match(
        rendered,
        new RegExp(`monitor · ${action} · job-id · request failed`),
      );
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
