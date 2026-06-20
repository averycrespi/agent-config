# todo Design

`todo` gives the agent a lightweight, branch-restored task list for tactical work tracking. It is intentionally session-scoped and low ceremony: one tool, one clear command, one compact widget, and no external storage.

## Architecture

- `index.ts` wires the store to Pi lifecycle events, branch restoration, the sticky widget, and `/todo-clear`.
- `state.ts` owns the in-memory TODO store, state cloning, ID allocation, status validation, notes normalization, and text formatting.
- `tools.ts` registers the `todo` agent tool, validates action-specific parameters, persists successful mutations, and renders compact tool output.
- `render.ts` owns pure widget rendering, status glyphs, colors, truncation, and overflow behavior.
- Tests cover state transitions, persistence/restoration behavior, tool validation, and rendering.

There is no settings module, retained log, file store, or cross-session database.

## State model

The state shape is deliberately small:

- `items`: ordered TODO items with stable numeric IDs;
- `nextTodoId`: the next ID to assign.

Item statuses are exactly `todo`, `in_progress`, `done`, and `blocked`. Do not add synonyms such as `pending` or `not_started`; the tool prompt guidance depends on the exact status set.

IDs are stable. Removing an item must not renumber later items. `replaceState()` recalculates `nextTodoId` defensively so restored state cannot reuse an existing ID.

The store returns cloned items/state and notifies subscribers with snapshots to prevent accidental external mutation.

## Persistence and restoration

TODO state is persisted into the Pi session branch:

- successful mutating tool actions append a compact custom `todo-state` entry;
- tool results include the same `{ items, nextTodoId }` state in `details`;
- `/todo-clear` appends a custom `todo-state` entry because commands do not produce tool results.

`restoreStore()` scans the active branch in order and keeps the latest valid snapshot from either `todo` tool results or custom entries. On `session_start` and `session_tree`, the store is replaced with the restored state or cleared if none exists.

This makes TODOs branch-scoped. Navigating the session tree can legitimately restore a different list.

## Tool behavior

`todo` is the agent control surface. It supports:

- `list`: read state without appending a snapshot;
- `set`: replace the list and reassign IDs starting at 1;
- `add`: append a new item;
- `update`: patch text/status/notes for an existing ID;
- `remove`: delete an existing ID without renumbering;
- `clear`: empty the list and reset `nextTodoId`.

Failed mutations return text errors with current state details and do not append snapshots. Successful mutations always return the full formatted list and current state details, so the agent can rely on the returned IDs rather than guessing.

Action-specific validation belongs in `tools.ts`; generic status/state invariants belong in `state.ts`.

## Widget rendering

The widget appears only when at least one item exists. It is placed above the editor and shows at most the first five items with status glyphs and optional notes. Hidden items are summarized with a `+N more` line.

`render.ts` is pure and width-aware. Keep truncation there rather than in store/tool code. The widget is an overview, not the canonical state; the full state is available through the tool result or `todo list`.

## Commands

`/todo-clear` is the only command. It exists as a manual reset escape hatch and persists the clear via a custom state entry. Do not add a parallel command API for normal list editing unless there is a strong interactive need; the agent tool is the primary mutation surface.

## Boundaries and non-goals

- No filesystem or database persistence outside Pi session history.
- No due dates, dependencies, priorities, owners, or nested tasks.
- No automatic TODO creation from user prompts.
- No claim that TODO completion proves higher-level goal completion.
- No cross-branch/global task list.
- No retained logs.

## Change guidance

Keep the extension simple and branch-scoped. When changing persistence, verify restoration from both tool result details and custom entries. When changing statuses or item shape, update state parsing, schemas, render glyphs, prompt guidance, README, and tests together.
