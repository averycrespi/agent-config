import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  ELAPSED_THRESHOLD_MS,
  TruncatedText,
  clearPartialTimer,
  countNonEmptyLines,
  firstLine,
  formatDuration,
  getRelativeLabel,
  getResultText,
  headNonEmptyLines,
  partialElapsed,
  plural,
  singleLineCommand,
  startPartialTimer,
  tailNonEmptyLines,
  toolCall,
  outcomeLine,
  outcomeSections,
} from "./render.ts";

test("summary fields have muted separators without rewriting prose or empty outcomes", () => {
  const theme: any = { fg: (c: string, s: string) => `<${c}>${s}</${c}>` };
  assert.equal(
    outcomeSections(theme, ["2 done", "", "6.9k tokens"]),
    "<muted>2 done</muted><dim> · </dim><muted>6.9k tokens</muted>",
  );
  assert.equal(
    outcomeSections(theme, ["effects unknown; no replay"], "warning"),
    "<warning>effects unknown; no replay</warning>",
  );
  assert.equal(
    outcomeSections(theme, ["\x1b[2Jline\nnext"]),
    "<muted>line next</muted>",
  );
  assert.equal(outcomeSections(theme, []), "");
});

const plainTheme: any = {
  fg: (_: string, text: string) => {
    assert.doesNotMatch(text, /[\p{Cc}\p{Cf}]/u);
    return text;
  },
  bold: (text: string) => text,
};

test("tool call and outcome omit absent sections and sanitize before styling", () => {
  assert.equal(
    toolCall(plainTheme, "mailbox", "list", "project"),
    "mailbox list project",
  );
  assert.equal(
    toolCall(plainTheme, "web_fetch", "", "example.com"),
    "web_fetch example.com",
  );
  assert.equal(
    toolCall(
      plainTheme,
      "script",
      "run",
      "Demo\n\x1b[31mjob",
      "providers: web",
    ),
    "script run Demo job (providers: web)",
  );
  assert.equal(outcomeLine(plainTheme, "done\n\x1b[31mnow"), "done now");
  assert.equal(outcomeLine(plainTheme, ""), "");
});

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine("  hello\nworld"), "hello");
});

test("firstLine skips leading blank lines", () => {
  assert.equal(firstLine("\n\n   \nfirst real\nsecond"), "first real");
});

test("firstLine returns empty string when there is no non-empty line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("\n\n   \n"), "");
});

test("getResultText extracts text from AgentToolResult content", () => {
  const result = {
    content: [{ type: "text", text: "ok" } as const],
  } as unknown as AgentToolResult<unknown>;
  assert.equal(getResultText(result), "ok");
});

test("getResultText returns empty string when no text content present", () => {
  const result = {
    content: [
      { type: "image", image: "" } as unknown as { type: "text"; text: string },
    ],
  } as unknown as AgentToolResult<unknown>;
  assert.equal(getResultText(result), "");
});

test("getResultText picks the first text block when multiple are present", () => {
  const result = {
    content: [
      { type: "text", text: "first" } as const,
      { type: "text", text: "second" } as const,
    ],
  } as unknown as AgentToolResult<unknown>;
  assert.equal(getResultText(result), "first");
});

test("getRelativeLabel returns 'file' for non-string or empty paths", () => {
  assert.equal(getRelativeLabel("/base", undefined), "file");
  assert.equal(getRelativeLabel("/base", ""), "file");
  assert.equal(getRelativeLabel("/base", 42), "file");
});

test("getRelativeLabel strips a leading @ before resolving", () => {
  assert.equal(getRelativeLabel("/base", "@sub/file.ts"), "sub/file.ts");
});

test("getRelativeLabel returns '.' when the path resolves to cwd", () => {
  assert.equal(getRelativeLabel("/base", "/base"), ".");
});

test("getRelativeLabel falls back to absolute path when target escapes cwd", () => {
  assert.equal(getRelativeLabel("/base", "/etc/hosts"), "/etc/hosts");
});

test("countNonEmptyLines counts only lines with non-whitespace content", () => {
  assert.equal(countNonEmptyLines("a\n\n b \n\t\nc"), 3);
  assert.equal(countNonEmptyLines(""), 0);
  assert.equal(countNonEmptyLines("\n\n\n"), 0);
});

test("plural uses singular for count=1 and defaults plural to singular+s", () => {
  assert.equal(plural(1, "match"), "1 match");
  assert.equal(plural(2, "line"), "2 lines");
});

test("plural uses the provided plural form for non-1 counts", () => {
  assert.equal(plural(3, "match", "matches"), "3 matches");
  assert.equal(plural(0, "match", "matches"), "0 matches");
});

test("singleLineCommand returns the command unchanged when no newlines", () => {
  assert.equal(singleLineCommand("echo hi"), "echo hi");
});

test("singleLineCommand truncates at the first newline and appends '...'", () => {
  assert.equal(singleLineCommand("echo hi  \nmore"), "echo hi ...");
});

test("singleLineCommand returns empty string for non-string or empty input", () => {
  assert.equal(singleLineCommand(undefined), "");
  assert.equal(singleLineCommand(""), "");
  assert.equal(singleLineCommand(42), "");
});

test("headNonEmptyLines returns up to N non-empty lines preserving original lines", () => {
  assert.deepEqual(headNonEmptyLines("a\n\n b\nc\nd", 2), ["a", " b"]);
});

test("headNonEmptyLines returns all non-empty lines when fewer than requested", () => {
  assert.deepEqual(headNonEmptyLines("a\n\nb", 10), ["a", "b"]);
});

test("tailNonEmptyLines returns the last N non-empty lines in original order", () => {
  assert.deepEqual(tailNonEmptyLines("a\nb\n\nc\nd\n\n", 2), ["c", "d"]);
});

test("tailNonEmptyLines returns all non-empty lines when fewer than requested", () => {
  assert.deepEqual(tailNonEmptyLines("a\n\nb", 10), ["a", "b"]);
});

test("formatDuration formats sub-minute in seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(500), "0s");
  assert.equal(formatDuration(5_000), "5s");
  assert.equal(formatDuration(59_999), "59s");
});

test("formatDuration zero-pads seconds past a minute", () => {
  assert.equal(formatDuration(60_000), "1m 00s");
  assert.equal(formatDuration(63_000), "1m 03s");
  assert.equal(formatDuration(10 * 60_000 + 42_000), "10m 42s");
});

test("formatDuration clamps negative values to 0", () => {
  assert.equal(formatDuration(-1_000), "0s");
});

test("startPartialTimer sets a ticker once and is a no-op on repeat calls", () => {
  const context = {
    state: {} as Record<string, unknown>,
    invalidate: () => {},
  };
  startPartialTimer(context);
  const handle = context.state.renderTimer;
  assert.ok(handle, "timer should be set after first call");
  startPartialTimer(context);
  assert.equal(context.state.renderTimer, handle);
  clearPartialTimer(context);
});

test("clearPartialTimer clears and unsets the timer; safe when nothing is set", () => {
  const context = {
    state: {} as Record<string, unknown>,
    invalidate: () => {},
  };
  clearPartialTimer(context); // no-op
  assert.equal(context.state.renderTimer, undefined);

  startPartialTimer(context);
  assert.ok(context.state.renderTimer);
  clearPartialTimer(context);
  assert.equal(context.state.renderTimer, undefined);
});

test("TruncatedText keeps truncated styled lines background-safe", () => {
  const component = new TruncatedText([
    "\x1b[38;5;246mabcdefghijklmnopqrstuvwxyz0123456789\x1b[39m",
  ]);

  const [line] = component.render(18);

  assert.equal(visibleWidth(line), 18);
  assert.match(line, /\.\.\./);
  assert.doesNotMatch(line, /\x1b\[0m/);
});

test("partialElapsed records startedAt and returns '' before threshold", () => {
  const context = {
    state: {} as Record<string, unknown>,
    invalidate: () => {},
  };
  const result = partialElapsed(context);
  assert.equal(result, "");
  assert.equal(typeof context.state.startedAt, "number");
  assert.ok(context.state.renderTimer, "ticker should be started");
  clearPartialTimer(context);
});

test("partialElapsed returns ' (<dur>)' once elapsed exceeds threshold", () => {
  const context = {
    state: {} as Record<string, unknown>,
    invalidate: () => {},
  };
  context.state.startedAt = Date.now() - (ELAPSED_THRESHOLD_MS + 1_500);
  const result = partialElapsed(context);
  assert.match(result, /^ \(\d+s\)$/);
  clearPartialTimer(context);
});
