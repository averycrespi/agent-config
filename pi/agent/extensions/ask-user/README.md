# ask-user

Ask focused interactive multiple-choice questions. Managed workers instead use the [shared durable mailbox protocol](../../skills/spin-out/references/decisions.md); ordinary standalone interaction remains unchanged.

## Tool

`ask_user` accepts one brief `question`, optional `context`, 2–5 `options` with a label and optional description, and optional zero-based `recommended` index. An Other/free-text option is appended automatically. Do not provide one or use the tool for trivial confirmations.

Results are `User selected: <1-based index>. <label>`, `User wrote: <text>`, or `User cancelled — no option selected.` Details contain `cancelled` and, for answers, `answerLabel`, `answerIndex` and `isCustom`. Cancellation supplies no answer or approval.

## UI behavior

Transcript calls show the action and parenthesized option count rather than question text. Flush-left settled results show `answered (option N)`, `answered (custom response)`, cancellation or failure; an answer is never relabelled approval. Expand for question/options or the retained answer. The pending choice form remains multiline and legible; dynamic labels are sanitized before styling.

Up/Down selects an option; Enter submits; Escape cancels. The free-text editor accepts nonempty text; Escape returns to the choices without canceling. Recommended options are labelled. While the custom UI is open, balanced `herdr:blocked` events report the wait to an installed Herdr integration. Noninteractive execution returns an error; unsupported RPC custom UI does not fabricate an answer.

## Extension events

Content-free `ask-user:input_requested` and `ask-user:input_resolved` events correlate actual waits with a generated UUID and answered/cancelled/failed outcome. They are process-local observations, not question transport or authority to answer remotely. Invalid input, pre-abort, headless execution and unsupported custom UI do not announce a wait. See [API.md](API.md).

## Configuration

No settings, environment routing, parent mode or config command. Existing managed sessions require explicit manual cutover to mailbox handoffs before changing loaded behavior; do not install or reload live sessions implicitly. Managed flows no longer call ask-user, and no legacy-mode compatibility layer is provided.

## Logging

No retained logs or diagnostic files. Ordinary tool history retains question/answer contents.

## Prior art

- [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion/) — structured question forms.
- [edlsh/pi-ask-user](https://github.com/edlsh/pi-ask-user) — searchable choices and freeform answers.
- [mitsuhiko/agent-stuff answer.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/answer.ts) — conversational question extraction.
- [jayshah5696/pi-agent-extensions ask-user](https://github.com/jayshah5696/pi-agent-extensions/tree/main/extensions/ask-user) — interactive and noninteractive question formats.
- Claude Code's `AskUserQuestion` tool — interactive structured questions.
