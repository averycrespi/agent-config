# ask-user Design

`ask-user` gives agents one narrow escape hatch for interactive human choice: a multiple-choice question with an automatic free-text fallback. The default path is interactive; an environment-only parent mode returns a non-answer instead of opening UI. Neither path persists state.

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
- With mode unset, non-interactive sessions return an error immediately instead of trying to print a prompt for later.
- Capture `PI_ASK_USER_MODE` at extension load. Reject configured values other than exact `parent` before any UI access; never echo raw configuration in diagnostics.
- In parent mode, validate and honor pre-abort, then return a fresh decision-request UUID and explicit non-answer details before UI/event setup. This ID is for checkpoint/report correlation, not a pending UI handle or lifecycle event. The parent resolves through the existing child, not through this extension.

The text response is optimized for the model transcript. Interactive `details` preserve `cancelled`, `answerLabel`, `answerIndex`, and `isCustom`. The exported `DecisionRequiredDetails` discriminator must be checked before interpreting `cancelled: false` as an answer. Parent results explicitly deny supplying an answer or approval and render as a warning, never success or cancellation. No `terminate` hint is returned: the child needs a follow-up turn to investigate, checkpoint, report and yield; settlement is not delivery.

## UI lifecycle

The custom UI has two modes:

1. Option-list mode: Up/Down changes the highlighted option, Enter selects it, Escape cancels.
2. Free-text mode: selecting the automatic `Type something.` row opens an inline editor; Enter submits non-empty text, while Escape returns to option-list mode without cancelling.

`api.ts` exposes the identity/outcome-only event types documented in [API.md](API.md). The custom factory announces a fresh request UUID only when it actually begins an unaborted interaction; unsupported UI paths cannot falsely announce a wait. The encompassing `try/finally` emits a correlated resolution after settlement with a default `failed` outcome, updated only after a successful UI return. New event publication is failure-isolated and shallow-frozen, with no user content or raw errors. It does not create messages, model turns, or authorization to answer.

The UI registers an abort listener for the tool signal and removes it on completion. Immediately before opening the UI, the tool emits `herdr:blocked` with `active: true` and a fixed, non-user-controlled label. A `finally` block always emits the matching inactive event and removes the abort listener, including cancellation, abort, and rendering failures. Herdr's listener uses a counter, so balanced events must remain one pair per opened prompt. Width-dependent rendered lines are cached and invalidated on input or explicit invalidate calls to avoid unnecessary recomputation.

## Validation invariants

Keep validation split between schema and pure helper:

- TypeBox should enforce basic shape, required fields, min/max counts, and string lengths.
- `validateAskParams()` should enforce semantic rules that depend on normalized option labels or relationships between fields.

Do not rely on prompt guidance alone for reserved labels or duplicate options; invalid tool calls must return readable error text that the agent can recover from.

## Boundaries and non-goals

- No retained state, logs, settings-file configuration, decision inbox or remote answering.
- Parent mode is a coordination convention, not a security boundary; it does not grant authority or enforce child/parent model compliance.
- No background/asynchronous answering in v1.
- No multi-select or multi-question form flow.
- No interactive prompt in headless mode; parent-managed non-answers require no UI.
- No arbitrary Markdown rendering in the prompt body; keep displayed text simple and bounded by wrapping/truncation helpers.

## Change guidance

When changing this extension, preserve the narrow decision-making scope. If adding new question types, keep validation pure and separately testable, and ensure cancellation/abort behavior is explicit. Avoid adding persistence unless there is a clear user-facing reason and matching README documentation.
