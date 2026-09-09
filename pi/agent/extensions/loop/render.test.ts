import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderLoopWidgetLines } from "./render.ts";
import type { LoopState } from "./state.ts";

function loop(overrides: Partial<LoopState> = {}): LoopState {
  return {
    id: "loop-1",
    generation: 1,
    status: "running",
    message: "Continue making concrete progress",
    limits: { maxContinuations: 10, maxActiveMinutes: 60 },
    delaySeconds: 0,
    continuationCount: 3,
    activeElapsedMs: 12 * 60_000,
    runningSince: 1_000,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: () => {
    throw new Error("Widgets must not use bold");
  },
};

test("running loop uses one quiet row without its message or separator", () => {
  assert.deepEqual(
    renderLoopWidgetLines(loop({ delaySeconds: 15 }), 200, undefined, 1000),
    ["loop running · 3/10 continuations · 12m/60m active · delay 15s"],
  );
  assert.deepEqual(renderLoopWidgetLines(undefined, 80), []);
  assert.equal(
    renderLoopWidgetLines(loop(), 1000, theme, 1000)[0],
    "<muted>loop</muted> <accent>running</accent><dim> · </dim><text>3/10</text><muted> continuations</muted><dim> · </dim><text>12m/60m</text><muted> active</muted>",
  );
});

test("waiting countdown precedes telemetry and stays accent, not warning", () => {
  assert.deepEqual(
    renderLoopWidgetLines(
      loop({ delaySeconds: 15 }),
      200,
      undefined,
      1000,
      13000,
    ),
    ["loop waiting · next 12s · 3/10 continuations · 12m/60m active"],
  );
  assert.match(
    renderLoopWidgetLines(loop(), 1000, theme, 1000, 13000)[0],
    /<accent>waiting<\/accent>/,
  );
  assert.equal(
    renderLoopWidgetLines(loop(), 25, undefined, 1000, 13000)[0],
    "loop waiting · next 12s",
  );
});

test("yielded and stopped loops show safe inline reasons, never the message", () => {
  const yielded = loop({
    status: "yielded",
    runningSince: undefined,
    detail: "Need\n\u001b[31minput",
  });
  assert.deepEqual(renderLoopWidgetLines(yielded, 80), [
    "loop yielded · waiting for user · Need input",
  ]);
  assert.match(
    renderLoopWidgetLines(yielded, 1000, theme)[0],
    /<warning>yielded<\/warning>/,
  );
  const stopped = loop({
    status: "stopped",
    runningSince: undefined,
    stopReason: "user_stop",
    detail: "Enough\nfor now",
  });
  assert.deepEqual(renderLoopWidgetLines(stopped, 80), [
    "loop stopped · stopped by user · Enough for now",
  ]);
  assert.match(
    renderLoopWidgetLines(stopped, 1000, theme)[0],
    /<muted>stopped<\/muted>/,
  );
  assert.match(
    renderLoopWidgetLines(
      { ...stopped, stopReason: "provider_error" },
      1000,
      theme,
    )[0],
    /<error>stopped<\/error>/,
  );
});

test("every lifecycle stays one ANSI-safe line at narrow widths", () => {
  const ansiTheme = {
    fg: (_color: string, text: string) => `\u001b[31m${text}\u001b[39m`,
    bold: theme.bold,
  };
  for (const status of ["running", "yielded", "stopped"] as const)
    for (const width of [0, 1, 7, 12, 40, 80]) {
      const lines = renderLoopWidgetLines(
        loop({ status, detail: "宽字符\n\u001b]52;c;evil\u0007继续工作" }),
        width,
        ansiTheme,
        1000,
      );
      assert.equal(lines.length, 1);
      assert.ok(visibleWidth(lines[0]) <= width);
      assert.doesNotMatch(lines[0], /\n|\u0007|\u001b\]|Continue making/);
    }
});
