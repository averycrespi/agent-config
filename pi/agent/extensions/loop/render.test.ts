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
    continuationCount: 3,
    activeElapsedMs: 12 * 60_000,
    runningSince: 1_000,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("loop widget renders status, precise limits, and message below the editor", () => {
  const lines = renderLoopWidgetLines(loop(), 100, undefined, 1_000);

  assert.equal(lines.length, 3);
  assert.match(lines[0], /Loop running · 3\/10 continuations · 12m\/60m/);
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
      stopReason: "continuation_limit",
    }),
    80,
  );

  assert.match(yielded[0], /Loop yielded · waiting for user input/);
  assert.match(yielded[1], /Need input/);
  assert.doesNotMatch(yielded.join("\n"), /\u001b/);
  assert.match(stopped[0], /Loop stopped · continuation limit reached/);
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
