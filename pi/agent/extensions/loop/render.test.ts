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

test("loop widget gives running status visual priority over telemetry", () => {
  const theme = {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<bold>${text}</bold>`,
  };
  const lines = renderLoopWidgetLines(
    loop({ delaySeconds: 15, activeElapsedMs: 30_000 }),
    300,
    theme,
    1_000,
  );

  assert.equal(lines.length, 3);
  assert.equal(
    lines[0],
    "<accent><bold>● Loop running</bold></accent><borderMuted> · </borderMuted><text>3/10</text><muted> continuations</muted><borderMuted> · </borderMuted><text>0m/60m</text><muted> active</muted><borderMuted> · </borderMuted><text>15s</text><muted> delay</muted>",
  );
  assert.match(lines[1], /Continue making concrete progress/);
});

test("loop widget renders yielded and stopped details safely", () => {
  const yielded = renderLoopWidgetLines(
    loop({
      status: "yielded",
      runningSince: undefined,
      detail: "Need\n\u001b[31minput",
    }),
    80,
  );
  const stopped = renderLoopWidgetLines(
    loop({
      status: "stopped",
      runningSince: undefined,
      stopReason: "aborted",
      detail: "Operation aborted",
    }),
    80,
  );

  assert.match(yielded[0], /Loop yielded · waiting for user input/);
  assert.match(yielded[1], /Need input/);
  assert.doesNotMatch(yielded.join("\n"), /\u001b/);
  assert.match(stopped[0], /Loop stopped · aborted/);
  assert.match(stopped[1], /Continue making concrete progress/);
  assert.doesNotMatch(stopped[1], /Operation aborted/);
});

test("loop widget truncates every line to narrow widths", () => {
  const theme = {
    fg: (_color: string, text: string) => `\u001b[31m${text}\u001b[0m`,
    bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
  };
  const lines = renderLoopWidgetLines(
    loop({ message: "宽字符继续工作" }),
    12,
    theme,
  );

  assert.ok(lines.every((line) => visibleWidth(line) <= 12));
  assert.ok(lines.every((line) => !line.endsWith("\u001b")));
});
