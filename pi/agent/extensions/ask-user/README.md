# ask-user

Pi extension that provides an `ask_user` tool for interactive multiple-choice decisions.

## Tools

### `ask_user`

Ask the user a multiple-choice question and return their answer. Use when multiple valid approaches exist with meaningfully different trade-offs. Keep the prompt brief and scannable; do not paste long design sections or walls of text into `context`. Do not use for trivial confirmations.

**Parameters:**

| Parameter     | Type    | Required | Description                                                              |
| ------------- | ------- | -------- | ------------------------------------------------------------------------ |
| `question`    | string  | yes      | The question to ask; keep it focused and concise                         |
| `context`     | string  | no       | Brief framing shown above the options; summarize, don't paste long text  |
| `options`     | array   | yes      | 2–5 choices, each with a `label` (required) and `description` (optional) |
| `recommended` | integer | no       | 0-indexed option to mark as "(Recommended)"                              |

An "Other (type your own)" option is always appended automatically — do not include one in `options`.

**Returns** one of:

- `"User selected: 2. Option Name"` — chosen option with its 1-based index
- `"User wrote: <text>"` — free-text answer via the Other path
- `"User cancelled — no option selected."` — user pressed Escape or the tool call was aborted

The `details` object always contains `cancelled`; successful answers also include `answerLabel`, `answerIndex`, and `isCustom` for structured access by other extensions.

## UI behavior

Renders a custom TUI widget at the bottom of the terminal:

- Options are numbered (1, 2, 3…) and navigated with ↑↓ arrows
- Enter selects the highlighted option
- Selecting "Type something." opens an inline editor; Escape returns to the list without cancelling
- Escape from the option list cancels the prompt
- The recommended option is labelled "(Recommended)"
- Option descriptions appear below their label in muted text
- Context (if provided) appears between the question and the options
- While the prompt is open, the extension emits balanced `herdr:blocked` events so an installed Herdr integration reports the agent as blocked; the event is harmless when no listener is installed

In non-interactive mode (`!ctx.hasUI`) the tool returns an error immediately.

## Configuration

No user-facing configuration.

## Logging

This extension does not write retained logs or diagnostic files.

## Prior art

- [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion/) — Pi extension for structured single-select, multi-select, multi-question, and free-text user questions inspired by Claude Code's AskUserQuestion tool.
- [edlsh/pi-ask-user](https://github.com/edlsh/pi-ask-user) — searchable single/multi-select options, freeform responses, and a bundled skill that prompts agents to seek input on architectural trade-offs
- [mitsuhiko/agent-stuff answer.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/answer.ts) — extracts embedded questions from assistant responses using an LLM, then presents a sequential multi-line editor UI for answering each one
- [jayshah5696/pi-agent-extensions ask-user](https://github.com/jayshah5696/pi-agent-extensions/tree/main/extensions/ask-user) — supports free-form text, single-select, and multi-select question formats, plus a non-interactive print mode for asynchronous answering
- Claude Code's `AskUserQuestion` tool — built-in interactive question tool in the Claude Code CLI
