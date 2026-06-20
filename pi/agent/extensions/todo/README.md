# todo

Session-scoped Pi extension that adds a lightweight `todo` tool plus a compact sticky widget above the editor.

## What it does

- registers one agent-facing `todo` tool with `list`, `set`, `add`, `update`, `remove`, and `clear`
- persists TODO state in the Pi session so reload, resume, and branch navigation restore the current list
- provides `/todo-clear` as a manual reset command, and persists that clear across reloads too
- shows the ordered list in a compact widget when at least one item exists
- renders tool calls/results compactly in the TUI, including one-line error summaries while preserving full tool result details for the agent
- renders status-specific glyphs for `todo`, `in_progress`, `done`, and `blocked`
- caps the widget to the first five items and shows a `+N more` overflow line when needed

## Tool usage

### `todo`

Create, replace, update, remove, clear, or list the active TODO list.

| Parameter | Type                                                          | Required                         | Description                                                                  |
| --------- | ------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `action`  | `"list" \| "set" \| "add" \| "update" \| "remove" \| "clear"` | yes                              | Operation to perform                                                         |
| `items`   | array                                                         | for `set`                        | Replacement items, each with `text`, optional `status`, and optional `notes` |
| `id`      | integer                                                       | for `update` / `remove`          | Existing TODO id                                                             |
| `text`    | string                                                        | for `add`; optional for `update` | Task text                                                                    |
| `status`  | `"todo" \| "in_progress" \| "done" \| "blocked"`              | no                               | Task status                                                                  |
| `notes`   | string                                                        | no                               | Optional task notes; set to an empty string on `update` to clear notes       |

Examples:

```json
{ "action": "add", "text": "Write tests", "status": "in_progress" }
{ "action": "update", "id": 1, "status": "done" }
{ "action": "clear" }
```

### `/todo-clear`

Clears all TODO items in the current session and persists the empty snapshot.

## State and restoration

TODO IDs stay stable once assigned. If an item is removed, later items keep their existing IDs instead of being renumbered.

The list is restored from the current Pi session branch on reload, resume, and branch navigation. Navigating to a different branch in the session tree can restore a different TODO list. `/todo-clear` persists the empty list for the current branch.

## Configuration

No user-facing configuration.

## Logging

This extension does not write retained logs or diagnostic files.

## Prior art

This extension adapts Moonpi's lightweight TODO UX into this repo's standalone Pi extension model.

Primary reference:

- Moonpi repository: [galatolofederico/moonpi](https://github.com/galatolofederico/moonpi)

Additional related work:

- [@agnishc/edb-todo](https://pi.dev/packages/@agnishc/edb-todo) — Pi extension with `todo_write`/`todo_read`, live widget, branch reconstruction, and system-prompt injection to reduce goal drift.
- [tintinweb/pi-tasks](https://github.com/tintinweb/pi-tasks) — Claude Code-style task tracking and coordination for Pi with persistent widgets, dependencies, and subagent task execution.

The goal here is narrower than Moonpi: keep the low-friction TODO surface without reintroducing Moonpi's broader mode system.
