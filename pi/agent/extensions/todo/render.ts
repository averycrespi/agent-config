import { truncateToWidth } from "@earendil-works/pi-tui";
import type { TodoItem, TodoStatus } from "./state.ts";

const WIDGET_SEPARATOR = "─";
const WIDGET_VISIBLE_LIMIT = 5;

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type WidgetTheme = typeof plainTheme;

export function glyphForStatus(status: TodoStatus): string {
  switch (status) {
    case "todo":
      return "[ ]";
    case "in_progress":
      return "[~]";
    case "done":
      return "[✓]";
    case "blocked":
      return "[!]";
  }
}

function renderStatusMarker(status: TodoStatus, theme: WidgetTheme): string {
  const glyph = glyphForStatus(status);

  switch (status) {
    case "todo":
      return theme.fg("muted", glyph);
    case "in_progress":
      return theme.fg("accent", theme.bold(glyph));
    case "done":
      return theme.fg("success", glyph);
    case "blocked":
      return theme.fg("warning", theme.bold(glyph));
  }
}

function renderTodoText(item: TodoItem, theme: WidgetTheme): string {
  switch (item.status) {
    case "todo":
      return theme.fg("text", item.text);
    case "in_progress":
      return theme.fg("accent", item.text);
    case "done":
      return theme.fg("dim", item.text);
    case "blocked":
      return theme.fg("text", item.text);
  }
}

export function renderWidgetLines(
  items: TodoItem[],
  width: number,
  theme: WidgetTheme = plainTheme,
): string[] {
  if (items.length === 0) return [];

  const safeWidth = Math.max(0, width);
  const visibleItems = items.slice(0, WIDGET_VISIBLE_LIMIT);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  const lines = [
    theme.fg("borderMuted", WIDGET_SEPARATOR.repeat(safeWidth)),
    ...visibleItems.map((item) => {
      const notes = item.notes ? theme.fg("dim", ` (${item.notes})`) : "";
      return truncateToWidth(
        `${renderStatusMarker(item.status, theme)} ${renderTodoText(item, theme)}${notes}`,
        safeWidth,
      );
    }),
  ];

  if (hiddenCount > 0) {
    lines.push(
      truncateToWidth(
        theme.fg(
          "dim",
          `    +${hiddenCount} more todo${hiddenCount === 1 ? "" : "s"}`,
        ),
        safeWidth,
      ),
    );
  }

  return lines;
}

export function createTodoWidget(items: TodoItem[]) {
  return (_tui: unknown, theme: WidgetTheme) => ({
    render(width: number) {
      return renderWidgetLines(items, width, theme);
    },
    invalidate() {},
  });
}
