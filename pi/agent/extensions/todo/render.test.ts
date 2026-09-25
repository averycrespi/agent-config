import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { glyphForStatus, renderWidgetLines } from "./render.ts";
import type { TodoItem } from "./state.ts";

const fakeTheme = {
  fg(color: string, text: string) {
    const codes: Record<string, number> = {
      text: 37,
      accent: 36,
      muted: 90,
      dim: 2,
      success: 32,
      warning: 33,
      borderMuted: 90,
    };
    const code = codes[color] ?? 37;
    return `\u001b[${code}m${text}\u001b[0m`;
  },
  bold(text: string) {
    return `\u001b[1m${text}\u001b[22m`;
  },
};

test("glyphForStatus maps each todo status to the expected glyph", () => {
  assert.equal(glyphForStatus("todo"), "[ ]");
  assert.equal(glyphForStatus("in_progress"), "[~]");
  assert.equal(glyphForStatus("done"), "[✓]");
  assert.equal(glyphForStatus("blocked"), "[!]");
});

test("renderWidgetLines returns an empty list when there are no todos", () => {
  assert.deepEqual(renderWidgetLines([], 24, fakeTheme as any), []);
});

test("renderWidgetLines scales and styles the separator to the available width", () => {
  const items: TodoItem[] = [{ id: 1, text: "First", status: "todo" }];

  assert.deepEqual(renderWidgetLines(items, 10, fakeTheme as any), [
    fakeTheme.fg("borderMuted", "─".repeat(10)),
    `${fakeTheme.fg("muted", "[ ]")} ${fakeTheme.fg("text", "First")}`,
  ]);
  assert.deepEqual(renderWidgetLines(items, 16, fakeTheme as any), [
    fakeTheme.fg("borderMuted", "─".repeat(16)),
    `${fakeTheme.fg("muted", "[ ]")} ${fakeTheme.fg("text", "First")}`,
  ]);
});

test("renderWidgetLines styles each todo state and dims notes", () => {
  const items: TodoItem[] = [
    { id: 1, text: "Backlog", status: "todo", notes: "later" },
    { id: 2, text: "Doing", status: "in_progress", notes: "now" },
    { id: 3, text: "Done", status: "done", notes: "shipped" },
    { id: 4, text: "Blocked", status: "blocked", notes: "waiting" },
  ];

  assert.deepEqual(renderWidgetLines(items, 80, fakeTheme as any), [
    fakeTheme.fg("borderMuted", "─".repeat(80)),
    `${fakeTheme.fg("muted", "[ ]")} ${fakeTheme.fg("text", "Backlog")}${fakeTheme.fg("dim", " (later)")}`,
    `${fakeTheme.fg("accent", fakeTheme.bold("[~]"))} ${fakeTheme.fg("accent", "Doing")}${fakeTheme.fg("dim", " (now)")}`,
    `${fakeTheme.fg("success", "[✓]")} ${fakeTheme.fg("dim", "Done")}${fakeTheme.fg("dim", " (shipped)")}`,
    `${fakeTheme.fg("warning", fakeTheme.bold("[!]"))} ${fakeTheme.fg("text", "Blocked")}${fakeTheme.fg("dim", " (waiting)")}`,
  ]);
});

test("renderWidgetLines shows only the first five todos and appends an aligned bottom overflow summary", () => {
  const items: TodoItem[] = [
    { id: 1, text: "One", status: "todo" },
    { id: 2, text: "Two", status: "in_progress" },
    { id: 3, text: "Three", status: "done" },
    { id: 4, text: "Four", status: "blocked" },
    { id: 5, text: "Five", status: "todo" },
    { id: 6, text: "Six", status: "todo" },
    { id: 7, text: "Seven", status: "done" },
  ];

  assert.deepEqual(renderWidgetLines(items, 80, fakeTheme as any), [
    fakeTheme.fg("borderMuted", "─".repeat(80)),
    `${fakeTheme.fg("muted", "[ ]")} ${fakeTheme.fg("text", "One")}`,
    `${fakeTheme.fg("accent", fakeTheme.bold("[~]"))} ${fakeTheme.fg("accent", "Two")}`,
    `${fakeTheme.fg("success", "[✓]")} ${fakeTheme.fg("dim", "Three")}`,
    `${fakeTheme.fg("warning", fakeTheme.bold("[!]"))} ${fakeTheme.fg("text", "Four")}`,
    `${fakeTheme.fg("muted", "[ ]")} ${fakeTheme.fg("text", "Five")}`,
    fakeTheme.fg("dim", "    +2 more todos"),
  ]);
});

test("renderWidgetLines preserves item order and respects width", () => {
  const items: TodoItem[] = [
    { id: 2, text: "Second", status: "done" },
    { id: 1, text: "First", status: "todo", notes: "needs design" },
    { id: 3, text: "Third", status: "blocked", notes: "waiting on API" },
    { id: 4, text: "Fourth", status: "todo" },
    { id: 5, text: "Fifth", status: "todo" },
    { id: 6, text: "Sixth", status: "todo" },
  ];

  for (const line of renderWidgetLines(items, 12, fakeTheme as any)) {
    assert.ok(visibleWidth(line) <= 12, `line should fit width: ${line}`);
  }
});
