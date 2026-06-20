# ask-user Design

`ask-user` gives agents one narrow escape hatch for interactive human choice: a multiple-choice question with an automatic free-text fallback. The extension is intentionally UI-only and does not persist state.

## Architecture

- `index.ts` registers the `ask_user` tool, owns the TypeBox parameter schema, renders the custom TUI widget, returns structured result details, and defines compact tool-call/result renderers.
- `validate.ts` contains pure cross-field validation that TypeBox cannot express: normalized label uniqueness, reserved `Other` label rejection, and recommended-index bounds.
- `*.test.ts` files cover validation and tool behavior without needing a full interactive terminal.

There is no config module, state store, command surface, or retained logging path.

## Tool contract

`ask_user` is for decisions where multiple valid paths have material trade-offs. The tool should not become a generic confirmation, long-form survey, or hidden planning surface.

Important contract details:

- Agents provide one focused `question`.
- Optional `context` must stay brief and scannable.
- Agents provide 2–5 options.
- The extension appends `Type something.` automatically; callers must not provide their own `Other` option.
- `recommended` is a 0-indexed input option, not including the automatic free-text row.
- Non-interactive sessions return an error immediately instead of trying to print a prompt for later.

The text response is optimized for the model transcript. The `details` object is the structured surface for programmatic consumers and always includes `cancelled`; successful responses also include `answerLabel`, `answerIndex`, and `isCustom`.

## UI lifecycle

The custom UI has two modes:

1. Option-list mode: Up/Down changes the highlighted option, Enter selects it, Escape cancels.
2. Free-text mode: selecting the automatic `Type something.` row opens an inline editor; Enter submits non-empty text, while Escape returns to option-list mode without cancelling.

The UI registers an abort listener for the tool signal and removes it on completion. Width-dependent rendered lines are cached and invalidated on input or explicit invalidate calls to avoid unnecessary recomputation.

## Validation invariants

Keep validation split between schema and pure helper:

- TypeBox should enforce basic shape, required fields, min/max counts, and string lengths.
- `validateAskParams()` should enforce semantic rules that depend on normalized option labels or relationships between fields.

Do not rely on prompt guidance alone for reserved labels or duplicate options; invalid tool calls must return readable error text that the agent can recover from.

## Boundaries and non-goals

- No retained state, logs, or configuration.
- No background/asynchronous answering in v1.
- No multi-select or multi-question form flow.
- No use in headless mode.
- No arbitrary Markdown rendering in the prompt body; keep displayed text simple and bounded by wrapping/truncation helpers.

## Change guidance

When changing this extension, preserve the narrow decision-making scope. If adding new question types, keep validation pure and separately testable, and ensure cancellation/abort behavior is explicit. Avoid adding persistence unless there is a clear user-facing reason and matching README documentation.
